import { supabase } from '@/lib/supabase/client'
import {
  Trip,
  Expense,
  AuditRulesLog,
  ExpenseCategory,
  AuditEvaluationRule,
  TripStatus,
} from '@/types/database'

class SupabaseStorageService {
  // Helper to cast supabase query builder when types.ts has empty schema
  private get client(): any {
    return supabase as any
  }

  // Trips CRUD
  public async listTrips(): Promise<Trip[]> {
    // 1. First attempt: full join with profiles, ordenado pelo período (start_date) mais antigo primeiro
    let tripsRaw: any[] | null = null

    try {
      const { data, error } = await this.client
        .from('trips')
        .select('*, user_profile:profiles(*)')
        .order('start_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })

      if (!error && data) {
        tripsRaw = data
      } else {
        console.warn(
          'Trips join with profiles failed or returned error, attempting fallback select:',
          error,
        )
      }
    } catch (joinErr) {
      console.warn('Caught error fetching trips with profile join:', joinErr)
    }

    // 2. Fallback query if join failed or error occurred
    if (!tripsRaw) {
      const { data: fallbackData, error: fallbackError } = await this.client
        .from('trips')
        .select('*')
        .order('start_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })

      if (fallbackError) {
        console.error('Fatal error fetching trips:', fallbackError)
        throw fallbackError
      }
      tripsRaw = fallbackData || []
    }

    // 3. Keep trips intact without mutating user_id

    // 4. Enrich trips with profiles map if user_profile wasn't populated by join
    const missingProfileUserIds = Array.from(
      new Set(
        (tripsRaw || [])
          .filter((t: any) => t.user_id && !t.user_profile)
          .map((t: any) => t.user_id),
      ),
    )

    if (missingProfileUserIds.length > 0) {
      try {
        const { data: profs } = await this.client
          .from('profiles')
          .select('*')
          .in('id', missingProfileUserIds)

        if (profs && profs.length > 0) {
          const profMap = new Map(profs.map((p: any) => [p.id, p]))
          tripsRaw = (tripsRaw || []).map((t: any) => {
            if (!t.user_profile && t.user_id && profMap.has(t.user_id)) {
              return { ...t, user_profile: profMap.get(t.user_id) }
            }
            return t
          })
        }
      } catch {
        // non-blocking
      }
    }

    return (tripsRaw || []).map(this.mapTripRow)
  }

  public async getTrip(id: string): Promise<Trip | null> {
    let tripRaw: any = null

    try {
      const { data, error } = await this.client
        .from('trips')
        .select('*, user_profile:profiles(*)')
        .eq('id', id)
        .maybeSingle()

      if (!error && data) {
        tripRaw = data
      }
    } catch {
      // fallback
    }

    if (!tripRaw) {
      const { data: fallbackData, error: fallbackErr } = await this.client
        .from('trips')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (fallbackErr) throw fallbackErr
      tripRaw = fallbackData
    }

    if (!tripRaw) return null

    // If trip lacks user_profile but has user_id, enrich
    if (tripRaw.user_id && !tripRaw.user_profile) {
      try {
        const { data: prof } = await this.client
          .from('profiles')
          .select('*')
          .eq('id', tripRaw.user_id)
          .maybeSingle()
        if (prof) {
          tripRaw.user_profile = prof
        }
      } catch {
        // non-blocking
      }
    }

    return this.mapTripRow(tripRaw)
  }

  public async createTrip(
    tripData: Omit<Trip, 'id' | 'created_at' | 'total_amount' | 'user_id'> & {
      id?: string
      user_id?: string
      total_amount?: number
    },
  ): Promise<Trip> {
    // Determine user_id: explicit or current authenticated user
    let assignedUserId = tripData.user_id
    if (!assignedUserId) {
      try {
        const { data: authData } = await supabase.auth.getUser()
        if (authData?.user?.id) {
          assignedUserId = authData.user.id
        }
      } catch {
        // ignore
      }
    }

    const payload: Record<string, unknown> = {
      destination: tripData.destination,
      start_date: tripData.start_date,
      end_date: tripData.end_date,
      transport_type: tripData.transport_type,
      status: tripData.status || 'em_triagem',
      total_amount: tripData.total_amount ?? 0,
      notes: tripData.notes || '',
      motivo: tripData.motivo || '',
    }

    if (tripData.id) payload.id = tripData.id
    if (assignedUserId && this.isValidUuid(assignedUserId)) {
      payload.user_id = assignedUserId
    }

    const { data, error } = await this.client.from('trips').insert(payload).select().single()

    if (error) {
      console.error('Error creating trip:', error)
      throw error
    }

    return this.mapTripRow(data)
  }

  public async updateTrip(
    id: string,
    updates: Partial<Omit<Trip, 'id' | 'created_at'>>,
  ): Promise<Trip | null> {
    const payload: Record<string, unknown> = { ...updates }
    if (payload.user_id && !this.isValidUuid(String(payload.user_id))) {
      delete payload.user_id
    }

    const { data, error } = await this.client
      .from('trips')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating trip:', error)
      throw error
    }

    return data ? this.mapTripRow(data) : null
  }

  /**
   * Registra a marcação de envio de relatório por e-mail para a viagem.
   */
  /**
   * Registra a marcação de envio (ou reenvio) de relatório por e-mail para a viagem.
   * Sobrescreve com os novos dados de envio mantendo a viagem íntegra.
   */
  public async markReportEmailSent(
    tripId: string,
    sentTo: string,
    user?: { id: string; name: string } | null,
  ): Promise<Trip | null> {
    const updates: Record<string, unknown> = {
      report_sent_at: new Date().toISOString(),
      report_sent_to: sentTo.trim(),
    }
    if (user?.id && this.isValidUuid(user.id)) {
      updates.report_sent_by_id = user.id
    }
    if (user?.name) {
      updates.report_sent_by_name = user.name
    }

    return this.updateTrip(tripId, updates as any)
  }

  /**
   * Reabre uma viagem com status 'auditada' ou 'fechada' voltando para 'em_triagem'.
   * Fluxo de governança: exige justificativa (motivo) e registra quem reabriu e quando.
   * Viagens 'reembolsada' (já quitadas) NÃO podem ser reabertas.
   */
  public async reopenTrip(params: {
    tripId: string
    reason: string
    user?: { id: string; name: string } | null
  }): Promise<Trip | null> {
    const { tripId, reason, user } = params
    const trimmedReason = (reason || '').trim()

    if (!trimmedReason || trimmedReason.length < 10) {
      throw new Error('O motivo da reabertura deve conter no mínimo 10 caracteres explicativos.')
    }

    const currentTrip = await this.getTrip(tripId)
    if (!currentTrip) {
      throw new Error('Viagem não encontrada.')
    }

    if (currentTrip.status === 'reembolsada') {
      throw new Error(
        'Viagens com status "reembolsada" (quitadas) não podem ser reabertas. A quitação é definitiva.',
      )
    }

    if (currentTrip.status !== 'auditada' && currentTrip.status !== 'fechada') {
      throw new Error(
        `Apenas viagens com status "auditada" ou "fechada" podem ser reabertas. A viagem atual está em "${currentTrip.status}".`,
      )
    }

    const updates: Record<string, unknown> = {
      status: 'em_triagem',
      reopened_at: new Date().toISOString(),
      reopen_reason: trimmedReason,
    }

    if (user?.id && this.isValidUuid(user.id)) {
      updates.reopened_by_id = user.id
    }
    if (user?.name) {
      updates.reopened_by_name = user.name
    }

    return this.updateTrip(tripId, updates as any)
  }

  /**
   * Quita uma viagem individualmente com depósito único.
   */
  public async settleSingleTrip(params: {
    tripId: string
    depositDate: string
    depositAmount: number
    user?: { id: string; name: string } | null
  }): Promise<Trip | null> {
    const { tripId, depositDate, depositAmount, user } = params
    const updates: Record<string, unknown> = {
      status: 'reembolsada',
      settlement_date: depositDate,
      settlement_amount: depositAmount,
      settlement_deposit_total: depositAmount,
      settlement_batch_id: null,
      settlement_batch_count: 1,
      settled_at: new Date().toISOString(),
    }
    if (user?.id && this.isValidUuid(user.id)) {
      updates.settled_by_id = user.id
    }
    if (user?.name) {
      updates.settled_by_name = user.name
    }

    return this.updateTrip(tripId, updates as any)
  }

  /**
   * Quita múltiplas viagens em lote através de um depósito conjunto na mesma data.
   */
  public async settleBatchTrips(params: {
    tripIds: string[]
    depositDate: string
    depositTotal: number
    tripsAmounts: Record<string, number>
    user?: { id: string; name: string } | null
  }): Promise<Trip[]> {
    const { tripIds, depositDate, depositTotal, tripsAmounts, user } = params
    if (!tripIds.length) return []

    // Gerar um UUID de lote único para vincular as viagens do mesmo depósito
    const batchId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : '00000000-0000-0000-0000-000000000000'

    const nowIso = new Date().toISOString()
    const updatedTrips: Trip[] = []

    for (const tripId of tripIds) {
      const tripAmount = tripsAmounts[tripId] ?? 0
      const updates: Record<string, unknown> = {
        status: 'reembolsada',
        settlement_date: depositDate,
        settlement_amount: tripAmount,
        settlement_deposit_total: depositTotal,
        settlement_batch_id: batchId,
        settlement_batch_count: tripIds.length,
        settled_at: nowIso,
      }
      if (user?.id && this.isValidUuid(user.id)) {
        updates.settled_by_id = user.id
      }
      if (user?.name) {
        updates.settled_by_name = user.name
      }

      const res = await this.updateTrip(tripId, updates as any)
      if (res) {
        updatedTrips.push(res)
      }
    }

    return updatedTrips
  }

  /**
   * Verifica se a viagem está bloqueada por imutabilidade de governança
   * (status 'auditada', 'fechada' ou 'reembolsada').
   * Quando bloqueada, despesas não podem ser inseridas/alteradas/excluídas
   * e dados principais da viagem não podem ser alterados.
   */
  public isTripLocked(status?: TripStatus | string | null): boolean {
    if (!status) return false
    return status === 'auditada' || status === 'fechada' || status === 'reembolsada'
  }

  /**
   * Mantido por retrocompatibilidade: alias para isTripLocked.
   */
  public isTripLockedForDeletion(status: TripStatus | string): boolean {
    return this.isTripLocked(status)
  }

  /**
   * Converte mensagens técnicas de trigger do banco para mensagens amigáveis em pt-BR.
   */
  public formatDatabaseError(err: any): string {
    const raw = err?.message || err?.details || String(err || '')
    if (
      raw.includes('Não é permitido') ||
      raw.includes('imutável') ||
      raw.includes('bloqueados para edição')
    ) {
      return raw
    }
    if (raw.includes('trg_protect_expense') || raw.includes('trg_protect_trip')) {
      return 'Esta viagem está fechada/reembolsada e seus dados estão bloqueados para edição.'
    }
    return raw || 'Ocorreu um erro ao processar a operação no banco de dados.'
  }

  /**
   * Helper to extract the relative file path inside the 'comprovantes' bucket from a file_url or file_name.
   */
  private extractStoragePath(fileUrl?: string | null, fileName?: string | null): string | null {
    if (!fileUrl && !fileName) return null
    const url = fileUrl?.trim() || ''

    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return null
    }

    // Example public URL:
    // https://xxx.supabase.co/storage/v1/object/public/comprovantes/123_abc.pdf
    const marker = '/storage/v1/object/public/comprovantes/'
    if (url.includes(marker)) {
      const path = url.split(marker)[1]
      return path ? decodeURIComponent(path) : null
    }

    // Direct object path without slash
    if (url && !url.includes('/') && !url.startsWith('http')) {
      return url
    }

    return null
  }

  /**
   * Deletes files from the 'comprovantes' Supabase Storage bucket.
   */
  public async deleteStorageFiles(filePaths: string[]): Promise<void> {
    const cleanPaths = Array.from(new Set(filePaths.filter(Boolean)))
    if (cleanPaths.length === 0) return

    try {
      const { error } = await supabase.storage.from('comprovantes').remove(cleanPaths)
      if (error) {
        console.warn('Warning removing files from comprovantes storage:', error)
      }
    } catch (err) {
      console.warn('Failed to delete storage objects:', err)
    }
  }

  /**
   * Delete a single expense.
   * Por padrão (deletePhysicalFile = false), NÃO remove o arquivo do Supabase Storage
   * imediatamente para permitir que o usuário desfaça a exclusão (janela de desfazer).
   */
  public async deleteExpense(id: string, deletePhysicalFile = false): Promise<boolean> {
    const current = await this.getExpense(id)
    if (!current) return true

    if (current.trip_id) {
      const trip = await this.getTrip(current.trip_id)
      if (trip && this.isTripLockedForDeletion(trip.status)) {
        throw new Error('Não é possível excluir despesa de uma viagem já fechada ou reembolsada.')
      }
    }

    const { error } = await this.client.from('expenses').delete().eq('id', id)
    if (error) {
      console.error('Error deleting expense:', error)
      throw error
    }

    // Se explicitamente solicitado a exclusão definitiva do arquivo físico:
    if (deletePhysicalFile) {
      const filePathsToDelete: string[] = []
      const pathFromUrl = this.extractStoragePath(current.file_url, current.file_name)
      if (pathFromUrl) {
        filePathsToDelete.push(pathFromUrl)
      }
      if (filePathsToDelete.length > 0) {
        await this.deleteStorageFiles(filePathsToDelete)
      }
    }

    if (current.trip_id) {
      await this.recalculateTripTotal(current.trip_id)
    }

    return true
  }

  /**
   * Restaura uma despesa anteriormente excluída, mantendo todos os seus campos
   * (incluindo conferência manual, justificativas e vínculo).
   * Se a viagem de destino estiver fechada/reembolsada, o trigger do Postgres
   * recusará a inserção — a chamada deve propagar o erro para toast amigável.
   */
  public async restoreExpense(expenseData: Expense): Promise<Expense> {
    if (expenseData.trip_id) {
      const trip = await this.getTrip(expenseData.trip_id)
      if (trip && this.isTripLocked(trip.status)) {
        throw new Error(
          `A viagem de destino "${trip.destination}" está bloqueada (${trip.status}). Não é possível restaurar a despesa.`,
        )
      }
    }

    const payload: Record<string, unknown> = {
      id: expenseData.id && this.isValidUuid(expenseData.id) ? expenseData.id : undefined,
      trip_id:
        expenseData.trip_id && this.isValidUuid(expenseData.trip_id) ? expenseData.trip_id : null,
      file_url: expenseData.file_url || '',
      file_name: expenseData.file_name,
      issue_date: expenseData.issue_date,
      issue_time: expenseData.issue_time || null,
      category: expenseData.category,
      merchant_name: expenseData.merchant_name,
      amount: expenseData.amount ?? 0,
      ocr_raw_text: expenseData.ocr_raw_text || null,
      is_verified: expenseData.is_verified ?? false,
      audit_flags: expenseData.audit_flags || [],
      audit_status: expenseData.audit_status || 'pendente',
      audit_justification: expenseData.audit_justification || null,
      cnpj: expenseData.cnpj || null,
      audit_manual_checked: expenseData.audit_manual_checked ?? false,
      audit_manual_checked_at: expenseData.audit_manual_checked_at || null,
      audit_manual_checked_by_id: expenseData.audit_manual_checked_by_id || null,
      audit_manual_checked_by_name: expenseData.audit_manual_checked_by_name || null,
    }

    const { data, error } = await this.client.from('expenses').insert(payload).select().single()

    if (error) {
      console.error('Error restoring expense:', error)
      throw error
    }

    const restored = this.mapExpenseRow(data)
    if (restored.trip_id) {
      await this.recalculateTripTotal(restored.trip_id)
    }

    return restored
  }

  /**
   * Delete a full trip in cascade:
   * 1. Check status (reject if 'auditada', 'fechada' or 'reembolsada')
   * 2. Find all attached expenses (guarda em memória antes de excluir caso deletePhysicalFile seja falso)
   * 3. Delete expenses
   * 4. Delete audit_rules_log
   * 5. Delete trip
   *
   * Por padrão (deletePhysicalFiles = false), NÃO remove os arquivos do Storage
   * imediatamente para permitir o "Desfazer" da exclusão da viagem.
   */
  public async deleteTrip(id: string, deletePhysicalFiles = false): Promise<boolean> {
    const trip = await this.getTrip(id)
    if (!trip) return true

    if (this.isTripLockedForDeletion(trip.status)) {
      throw new Error('Não é permitido excluir uma viagem já fechada ou reembolsada.')
    }

    const expenses = await this.listExpenses(id)

    // Delete expenses linked to this trip
    const { error: expError } = await this.client.from('expenses').delete().eq('trip_id', id)
    if (expError) {
      console.error('Error deleting expenses of trip:', expError)
      throw expError
    }

    // Delete audit_rules_log (has cascade in DB, but explicit cleanup guarantees safety)
    await this.client.from('audit_rules_log').delete().eq('trip_id', id)

    // Delete the trip record
    const { error: tripError } = await this.client.from('trips').delete().eq('id', id)
    if (tripError) {
      console.error('Error deleting trip:', tripError)
      throw tripError
    }

    // Se exclusão definitiva dos arquivos foi explicitamente requisitada:
    if (deletePhysicalFiles) {
      const pathsToDelete: string[] = []
      for (const exp of expenses) {
        const extracted = this.extractStoragePath(exp.file_url, exp.file_name)
        if (extracted) pathsToDelete.push(extracted)
      }
      if (pathsToDelete.length > 0) {
        await this.deleteStorageFiles(pathsToDelete)
      }
    }

    return true
  }

  /**
   * Restaura uma viagem completa anteriormente excluída, incluindo suas despesas associadas.
   */
  public async restoreTripWithExpenses(trip: Trip, expenses: Expense[]): Promise<Trip> {
    const tripPayload: Record<string, unknown> = {
      id: trip.id,
      destination: trip.destination,
      start_date: trip.start_date,
      end_date: trip.end_date,
      transport_type: trip.transport_type,
      status: trip.status || 'em_triagem',
      total_amount: trip.total_amount ?? 0,
      notes: trip.notes || '',
      motivo: trip.motivo || '',
    }
    if (trip.user_id && this.isValidUuid(trip.user_id)) {
      tripPayload.user_id = trip.user_id
    }

    const { data: insertedTrip, error: tripError } = await this.client
      .from('trips')
      .insert(tripPayload)
      .select()
      .single()

    if (tripError) {
      console.error('Error restoring trip:', tripError)
      throw tripError
    }

    // Restaura cada despesa associada
    if (expenses.length > 0) {
      const expPayloads = expenses.map((exp) => ({
        id: exp.id,
        trip_id: trip.id,
        file_url: exp.file_url || '',
        file_name: exp.file_name,
        issue_date: exp.issue_date,
        issue_time: exp.issue_time || null,
        category: exp.category,
        merchant_name: exp.merchant_name,
        amount: exp.amount ?? 0,
        ocr_raw_text: exp.ocr_raw_text || null,
        is_verified: exp.is_verified ?? false,
        audit_flags: exp.audit_flags || [],
        audit_status: exp.audit_status || 'pendente',
        audit_justification: exp.audit_justification || null,
        cnpj: exp.cnpj || null,
        audit_manual_checked: exp.audit_manual_checked ?? false,
        audit_manual_checked_at: exp.audit_manual_checked_at || null,
        audit_manual_checked_by_id: exp.audit_manual_checked_by_id || null,
        audit_manual_checked_by_name: exp.audit_manual_checked_by_name || null,
      }))

      const { error: expsError } = await this.client.from('expenses').insert(expPayloads)
      if (expsError) {
        console.error('Error restoring expenses of trip:', expsError)
        // Mesmo com erro em despesas, o trip foi restaurado
      }
    }

    await this.recalculateTripTotal(trip.id)
    return this.mapTripRow(insertedTrip)
  }

  public async recalculateTripTotal(tripId: string): Promise<number> {
    // O banco já recalcula automaticamente via trigger após INSERT/UPDATE/DELETE.
    // Lemos o valor atualizado persistido no banco para garantir sincronia.
    const trip = await this.getTrip(tripId)
    if (trip) {
      return trip.total_amount
    }
    const expenses = await this.listExpenses(tripId)
    const sum = expenses.reduce((acc, curr) => acc + (curr.amount || 0), 0)
    return Number(sum.toFixed(2))
  }

  // Expenses CRUD
  public async listExpenses(tripId?: string): Promise<Expense[]> {
    let query = this.client.from('expenses').select('*')

    if (tripId) {
      query = query.eq('trip_id', tripId).order('issue_date', { ascending: false })
    } else {
      query = query.order('created_at', { ascending: true })
    }

    const { data, error } = await query

    if (error) {
      console.error('Error listing expenses:', error)
      throw error
    }

    return (data || []).map(this.mapExpenseRow)
  }

  public async getExpense(id: string): Promise<Expense | null> {
    const { data, error } = await this.client
      .from('expenses')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('Error getting expense:', error)
      throw error
    }

    return data ? this.mapExpenseRow(data) : null
  }

  public async createExpense(expenseData: Omit<Expense, 'id'> & { id?: string }): Promise<Expense> {
    const payload: Record<string, unknown> = {
      trip_id:
        expenseData.trip_id && this.isValidUuid(expenseData.trip_id) ? expenseData.trip_id : null,
      file_url: expenseData.file_url || '',
      file_name: expenseData.file_name,
      issue_date: expenseData.issue_date,
      issue_time: expenseData.issue_time || null,
      category: expenseData.category,
      merchant_name: expenseData.merchant_name,
      amount: expenseData.amount ?? 0,
      ocr_raw_text: expenseData.ocr_raw_text || null,
      is_verified: expenseData.is_verified ?? false,
      audit_flags: expenseData.audit_flags || [],
      audit_status: expenseData.audit_status || 'pendente',
      audit_justification: expenseData.audit_justification || null,
      cnpj: expenseData.cnpj || null,
      audit_manual_checked: expenseData.audit_manual_checked ?? false,
      audit_manual_checked_at: expenseData.audit_manual_checked_at || null,
      audit_manual_checked_by_id: expenseData.audit_manual_checked_by_id || null,
      audit_manual_checked_by_name: expenseData.audit_manual_checked_by_name || null,
    }

    if (expenseData.id && this.isValidUuid(expenseData.id)) {
      payload.id = expenseData.id
    }

    const { data, error } = await this.client.from('expenses').insert(payload).select().single()

    if (error) {
      console.error('Error creating expense:', error)
      throw error
    }

    const created = this.mapExpenseRow(data)
    if (created.trip_id) {
      await this.recalculateTripTotal(created.trip_id)
    }

    return created
  }

  public async setExpenseManualAudit(
    expenseId: string,
    checked: boolean,
    user: { id: string; name: string },
  ): Promise<Expense | null> {
    const expense = await this.getExpense(expenseId)
    if (!expense) throw new Error('Despesa não encontrada.')

    if (expense.trip_id) {
      const trip = await this.getTrip(expense.trip_id)
      if (trip && this.isTripLockedForDeletion(trip.status)) {
        throw new Error('Viagem fechada ou reembolsada não permite alteração de auditoria.')
      }
    }

    const updates: Partial<Expense> = checked
      ? {
          audit_manual_checked: true,
          audit_manual_checked_at: new Date().toISOString(),
          audit_manual_checked_by_id: user.id,
          audit_manual_checked_by_name: user.name,
          audit_status: 'conforme',
        }
      : {
          audit_manual_checked: false,
          audit_manual_checked_at: null,
          audit_manual_checked_by_id: null,
          audit_manual_checked_by_name: null,
          // When reverting manual check: if it was previously marked conforme manually, return to pendente
          audit_status: 'pendente',
        }

    return await this.updateExpense(expenseId, updates)
  }

  public async updateExpense(
    id: string,
    updates: Partial<Omit<Expense, 'id'>>,
  ): Promise<Expense | null> {
    // Look up previous trip_id to recalculate if changed
    const current = await this.getExpense(id)
    const oldTripId = current?.trip_id

    const payload: Record<string, unknown> = { ...updates }
    if ('trip_id' in payload) {
      if (!payload.trip_id || !this.isValidUuid(String(payload.trip_id))) {
        payload.trip_id = null
      }
    }

    const { data, error } = await this.client
      .from('expenses')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating expense:', error)
      throw error
    }

    const updated = data ? this.mapExpenseRow(data) : null

    if (oldTripId) {
      await this.recalculateTripTotal(oldTripId)
    }
    if (updated?.trip_id && updated.trip_id !== oldTripId) {
      await this.recalculateTripTotal(updated.trip_id)
    }

    return updated
  }

  // Duplicate Check: same issue_date + exact amount + merchant_name/CNPJ
  public async findDuplicate(expense: {
    issue_date: string
    amount: number
    merchant_name: string
    cnpj?: string
    excludeId?: string
  }): Promise<Expense | null> {
    const all = await this.listExpenses()
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()

    const targetMerchant = normalize(expense.merchant_name)
    const targetCnpj = expense.cnpj ? expense.cnpj.replace(/\D/g, '') : null

    for (const item of all) {
      if (expense.excludeId && item.id === expense.excludeId) continue

      const sameDate = item.issue_date === expense.issue_date
      const sameAmount = Math.abs(item.amount - expense.amount) < 0.01

      if (sameDate && sameAmount) {
        if (targetCnpj && item.cnpj) {
          const itemCnpj = item.cnpj.replace(/\D/g, '')
          if (itemCnpj === targetCnpj) return item
        }
        const itemMerchant = normalize(item.merchant_name)
        if (itemMerchant.includes(targetMerchant) || targetMerchant.includes(itemMerchant)) {
          return item
        }
      }
    }
    return null
  }

  // Audit Rules Engine
  public async evaluateTripAudit(tripId: string): Promise<AuditEvaluationRule[]> {
    const trip = await this.getTrip(tripId)
    if (!trip) return []

    const expenses = await this.listExpenses(tripId)
    const logs = await this.listAuditLogs(tripId)

    const rules: AuditEvaluationRule[] = []

    // Regra: Transporte Principal da Viagem (Comprovante de Passagem Aérea / Aluguel de Carro)
    const transportType = trip.transport_type
    const transportLog = logs.find((l) => l.rule_key === 'transporte_principal_ausente')

    if (transportType === 'aéreo') {
      const flightKeywords = [
        'latam',
        'gol linhas',
        'gol',
        'azul linhas',
        'azul',
        'passagem',
        'bilhete',
        'aereo',
        'aéreo',
        'voo',
        'boarding',
        'aeroporto',
        'airline',
        'flight',
        'e-ticket',
        'eticket',
        'localizador',
        'trecho',
      ]

      const hasFlightExpense = expenses.some((e) => {
        const merchant = (e.merchant_name || '').toLowerCase()
        const text = (e.ocr_raw_text || '').toLowerCase()
        const isTransportCategory = e.category === 'transporte'

        const matchesKeyword = flightKeywords.some((k) => merchant.includes(k) || text.includes(k))

        // Se a categoria for transporte e bater com palavra-chave, ou tiver menção explícita de passagem/voo
        return (
          (isTransportCategory && matchesKeyword) ||
          merchant.includes('linhas aéreas') ||
          merchant.includes('airline')
        )
      })

      if (!hasFlightExpense) {
        rules.push({
          key: 'transporte_principal_ausente',
          title: 'Transporte Principal da Viagem',
          message:
            'Viagem aérea sem comprovante de passagem aérea anexado. Adicione o bilhete/e-ticket de embarque ou justifique.',
          severity: 'warning',
          status: transportLog?.status === 'justified' ? 'justified' : 'warning',
          justification: transportLog?.message,
        })
      } else {
        rules.push({
          key: 'transporte_principal_ausente',
          title: 'Transporte Principal da Viagem',
          message: 'Comprovante de passagem aérea / bilhete de embarque identificado com sucesso.',
          severity: 'pass',
          status: 'pass',
        })
      }
    } else if (transportType === 'carro_alugado') {
      const rentalKeywords = [
        'localiza',
        'movida',
        'unidas',
        'aluguel',
        'locadora',
        'rent a car',
        'locacao',
        'locação',
        'hertz',
        'avis',
      ]
      const hasRentalExpense = expenses.some((e) => {
        const merchant = (e.merchant_name || '').toLowerCase()
        const text = (e.ocr_raw_text || '').toLowerCase()
        const isTransportCategory = e.category === 'transporte'
        return (
          isTransportCategory &&
          rentalKeywords.some((k) => merchant.includes(k) || text.includes(k))
        )
      })

      if (!hasRentalExpense) {
        rules.push({
          key: 'transporte_principal_ausente',
          title: 'Transporte Principal da Viagem',
          message:
            'Viagem com carro alugado — não há contrato/fatura de locação de veículo anexada. Adicione o comprovante ou justifique.',
          severity: 'warning',
          status: transportLog?.status === 'justified' ? 'justified' : 'warning',
          justification: transportLog?.message,
        })
      } else {
        rules.push({
          key: 'transporte_principal_ausente',
          title: 'Transporte Principal da Viagem',
          message: 'Comprovante de aluguel de veículo identificado com sucesso.',
          severity: 'pass',
          status: 'pass',
        })
      }
    } else {
      // carro_proprio ou outros: sem exigência de passagem ou locação, fica Conforme/neutro
      rules.push({
        key: 'transporte_principal_ausente',
        title: 'Transporte Principal da Viagem',
        message:
          transportType === 'carro_proprio'
            ? 'Transporte realizado em veículo próprio (sem exigência de passagem/locação).'
            : 'Transporte principal não requer comprovante obrigatório de bilhete/locadora.',
        severity: 'pass',
        status: 'pass',
      })
    }

    // Regra 1: Viagem Aérea sem transporte terrestre (uber/táxi/estacionamento) nas datas
    if (trip.transport_type === 'aéreo') {
      const groundExpenses = expenses.filter((e) =>
        ['uber_taxi', 'estacionamento', 'transporte'].includes(e.category),
      )
      const existingLog = logs.find((l) => l.rule_key === 'voo_sem_transporte_aeroporto')

      if (groundExpenses.length === 0) {
        rules.push({
          key: 'voo_sem_transporte_aeroporto',
          title: 'Transporte Terrestre para Aeroporto',
          message:
            'Viagem aérea detectada — não há comprovante de transporte terrestre (Uber/Táxi/Estacionamento) registrado no período. Adicione o comprovante ou justifique.',
          severity: 'warning',
          status: existingLog?.status === 'justified' ? 'justified' : 'warning',
          justification: existingLog?.message,
        })
      } else {
        rules.push({
          key: 'voo_sem_transporte_aeroporto',
          title: 'Transporte Terrestre para Aeroporto',
          message: `${groundExpenses.length} comprovante(s) de transporte terrestre/Uber identificado(s) com sucesso.`,
          severity: 'pass',
          status: 'pass',
        })
      }
    }

    // Regra 2: Viagem >= 2 dias sem comprovante de hospedagem
    const tripDays = calculateDaysBetween(trip.start_date, trip.end_date)
    if (tripDays >= 2) {
      const lodgingExpenses = expenses.filter((e) => e.category === 'hospedagem')
      const existingLog = logs.find((l) => l.rule_key === 'sem_comprovante_hotel')

      if (lodgingExpenses.length === 0) {
        rules.push({
          key: 'sem_comprovante_hotel',
          title: 'Comprovante de Hospedagem',
          message: `Viagem com duração de ${tripDays} dias — não há despesa de hospedagem registrada. Adicione o comprovante de hotel/pousada ou justifique.`,
          severity: 'warning',
          status: existingLog?.status === 'justified' ? 'justified' : 'warning',
          justification: existingLog?.message,
        })
      } else {
        rules.push({
          key: 'sem_comprovante_hotel',
          title: 'Comprovante de Hospedagem',
          message: `Comprovante de hospedagem anexado (${lodgingExpenses.length} comprovante(s) registrado(s)).`,
          severity: 'pass',
          status: 'pass',
        })
      }
    }

    // Regra 3: Consistência de despesas com carro alugado
    if (trip.transport_type === 'carro_alugado') {
      const hasFuel = expenses.some((e) => e.category === 'combustivel')
      const hasRentalInvoice = expenses.some(
        (e) =>
          e.category === 'transporte' &&
          (e.merchant_name.toLowerCase().includes('localiza') ||
            e.merchant_name.toLowerCase().includes('movida') ||
            e.merchant_name.toLowerCase().includes('aluguel') ||
            e.merchant_name.toLowerCase().includes('rent')),
      )
      const existingLog = logs.find((l) => l.rule_key === 'falta_comprovante_aluguel')

      if (hasFuel && !hasRentalInvoice) {
        rules.push({
          key: 'falta_comprovante_aluguel',
          title: 'Fatura de Aluguel de Veículo',
          message:
            'Foram anexados comprovantes de combustível/estacionamento, mas não há fatura da locadora de veículos vinculada. Adicione o contrato/recibo ou justifique.',
          severity: 'warning',
          status: existingLog?.status === 'justified' ? 'justified' : 'warning',
          justification: existingLog?.message,
        })
      } else if (hasRentalInvoice) {
        rules.push({
          key: 'falta_comprovante_aluguel',
          title: 'Fatura de Aluguel de Veículo',
          message: 'Comprovante de locação de veículo identificado.',
          severity: 'pass',
          status: 'pass',
        })
      }
    }

    // Regra 4: Detecção de duplicidade interna na viagem
    const duplicates = expenses.filter(
      (e) => e.audit_flags && e.audit_flags.includes('comprovante_duplicado'),
    )
    if (duplicates.length > 0) {
      rules.push({
        key: 'comprovante_duplicado',
        title: 'Comprovante(s) Marcado(s) como Duplicata',
        message: `${duplicates.length} comprovante(s) possui(em) alerta de duplicidade. Revise e descarte ou justifique a inclusão.`,
        severity: 'warning',
        status: 'warning',
      })
    } else {
      rules.push({
        key: 'comprovante_duplicado',
        title: 'Verificação Anti-Duplicidade',
        message: 'Nenhum comprovante duplicado detectado para esta viagem.',
        severity: 'pass',
        status: 'pass',
      })
    }

    // Regra 5: Alimentação para viagens de dia todo
    const foodExpenses = expenses.filter((e) => e.category === 'alimentacao')
    if (foodExpenses.length === 0) {
      const existingLog = logs.find((l) => l.rule_key === 'sem_alimentacao')
      rules.push({
        key: 'sem_alimentacao',
        title: 'Despesas de Alimentação',
        message:
          'Nenhum comprovante de refeição/alimentação registrado no período. Caso tenha sido fornecido pela empresa/evento, favor justificar.',
        severity: 'info',
        status: existingLog?.status === 'justified' ? 'justified' : 'warning',
        justification: existingLog?.message,
      })
    } else {
      rules.push({
        key: 'sem_alimentacao',
        title: 'Despesas de Alimentação',
        message: `${foodExpenses.length} comprovante(s) de refeição identificado(s).`,
        severity: 'pass',
        status: 'pass',
      })
    }

    return rules
  }

  // Audit Logs CRUD
  public async listAuditLogs(tripId: string): Promise<AuditRulesLog[]> {
    const { data, error } = await this.client
      .from('audit_rules_log')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error listing audit logs:', error)
      throw error
    }

    return (data || []).map((row: any) => ({
      id: String(row.id),
      trip_id: String(row.trip_id),
      rule_key: String(row.rule_key),
      status: row.status as 'pass' | 'warning' | 'justified',
      message: String(row.message || ''),
    }))
  }

  public async saveAuditLog(log: {
    trip_id: string
    rule_key: string
    status: 'pass' | 'warning' | 'justified'
    message: string
  }): Promise<AuditRulesLog> {
    // Check if an entry exists for this trip + rule_key
    const { data: existing } = await this.client
      .from('audit_rules_log')
      .select('*')
      .eq('trip_id', log.trip_id)
      .eq('rule_key', log.rule_key)
      .maybeSingle()

    if (existing) {
      const { data, error } = await this.client
        .from('audit_rules_log')
        .update({
          status: log.status,
          message: log.message,
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        console.error('Error updating audit log:', error)
        throw error
      }

      return {
        id: String(data.id),
        trip_id: String(data.trip_id),
        rule_key: String(data.rule_key),
        status: data.status,
        message: String(data.message || ''),
      }
    } else {
      const { data, error } = await this.client
        .from('audit_rules_log')
        .insert({
          trip_id: log.trip_id,
          rule_key: log.rule_key,
          status: log.status,
          message: log.message,
        })
        .select()
        .single()

      if (error) {
        console.error('Error inserting audit log:', error)
        throw error
      }

      return {
        id: String(data.id),
        trip_id: String(data.trip_id),
        rule_key: String(data.rule_key),
        status: data.status,
        message: String(data.message || ''),
      }
    }
  }

  // Supabase Storage upload for receipts
  public async uploadReceiptFile(file: File): Promise<string> {
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase()
    const filePath = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${cleanFileName}`

    const { data, error } = await supabase.storage.from('comprovantes').upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

    if (error) {
      console.warn('Storage upload error, using object path fallback:', error)
      throw error
    }

    const { data: publicUrlData } = supabase.storage.from('comprovantes').getPublicUrl(data.path)

    return publicUrlData.publicUrl
  }

  // Dashboard Metrics
  public async getDashboardMetrics() {
    const trips = await this.listTrips()

    // Total a reembolsar: soma de todas as viagens em aberto (em_triagem, com_pendencias, auditada)
    const openTrips = trips.filter((t) =>
      ['em_triagem', 'com_pendencias', 'auditada'].includes(t.status),
    )
    const totalToRefund = openTrips.reduce((acc, t) => acc + (t.total_amount || 0), 0)

    // Viagens em aberto
    const openTripsCount = openTrips.length

    // Alertas de auditoria ativos
    let activeAlertsCount = 0
    for (const trip of openTrips) {
      const evaluation = await this.evaluateTripAudit(trip.id)
      const warnings = evaluation.filter((r) => r.status === 'warning')
      activeAlertsCount += warnings.length
    }

    // Total reembolsado no mês atual (baseado em status reembolsada ou fechada)
    const currentMonth = new Date().getMonth()
    const currentYear = new Date().getFullYear()

    const reimbursedTrips = trips.filter((t) => {
      if (t.status !== 'reembolsada' && t.status !== 'fechada') return false
      // Regra da virada do mês: data de início determina o mês financeiro
      const tripDate = new Date(t.start_date + 'T00:00:00')
      return tripDate.getMonth() === currentMonth && tripDate.getFullYear() === currentYear
    })

    const totalReimbursedThisMonth = reimbursedTrips.reduce(
      (acc, t) => acc + (t.total_amount || 0),
      0,
    )

    return {
      totalToRefund: Number(totalToRefund.toFixed(2)),
      openTripsCount,
      activeAlertsCount,
      totalReimbursedThisMonth: Number(totalReimbursedThisMonth.toFixed(2)),
    }
  }

  // Helpers
  private isValidUuid(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)
  }

  private mapTripRow(row: any): Trip {
    let user_profile = null
    if (row.user_profile) {
      user_profile = {
        id: row.user_profile.id,
        email: row.user_profile.email,
        full_name: row.user_profile.full_name,
        role: row.user_profile.role,
        is_active: row.user_profile.is_active ?? true,
        created_at: row.user_profile.created_at,
        updated_at: row.user_profile.updated_at,
        alert_unsent_trip_enabled: row.user_profile.alert_unsent_trip_enabled ?? true,
        alert_unsent_trip_days: row.user_profile.alert_unsent_trip_days ?? 5,
      }
    }

    return {
      id: String(row.id),
      user_id: row.user_id ? String(row.user_id) : '',
      destination: String(row.destination || ''),
      start_date: String(row.start_date || ''),
      end_date: String(row.end_date || ''),
      transport_type: row.transport_type,
      status: row.status,
      total_amount: Number(row.total_amount || 0),
      notes: row.notes || '',
      motivo: String(row.motivo || ''),
      created_at: String(row.created_at || ''),
      user_profile,
      report_sent_at: row.report_sent_at || null,
      report_sent_to: row.report_sent_to || null,
      report_sent_by_id: row.report_sent_by_id || null,
      report_sent_by_name: row.report_sent_by_name || null,
      reopened_at: row.reopened_at || null,
      reopened_by_id: row.reopened_by_id || null,
      reopened_by_name: row.reopened_by_name || null,
      reopen_reason: row.reopen_reason || null,
      settlement_date: row.settlement_date || null,
      settlement_amount: row.settlement_amount != null ? Number(row.settlement_amount) : null,
      settlement_deposit_total:
        row.settlement_deposit_total != null ? Number(row.settlement_deposit_total) : null,
      settlement_batch_id: row.settlement_batch_id || null,
      settlement_batch_count:
        row.settlement_batch_count != null ? Number(row.settlement_batch_count) : null,
      settled_by_id: row.settled_by_id || null,
      settled_by_name: row.settled_by_name || null,
      settled_at: row.settled_at || null,
    }
  }

  private mapExpenseRow(row: any): Expense {
    return {
      id: String(row.id),
      trip_id: row.trip_id ? String(row.trip_id) : null,
      file_url: String(row.file_url || ''),
      file_name: String(row.file_name || ''),
      issue_date: String(row.issue_date || ''),
      issue_time: row.issue_time || '',
      category: row.category as ExpenseCategory,
      merchant_name: String(row.merchant_name || ''),
      amount: Number(row.amount || 0),
      ocr_raw_text: row.ocr_raw_text || '',
      is_verified: Boolean(row.is_verified),
      audit_flags: Array.isArray(row.audit_flags) ? row.audit_flags : [],
      audit_status: row.audit_status || 'pendente',
      audit_justification: row.audit_justification || '',
      cnpj: row.cnpj || '',
      audit_manual_checked: Boolean(row.audit_manual_checked),
      audit_manual_checked_at: row.audit_manual_checked_at || null,
      audit_manual_checked_by_id: row.audit_manual_checked_by_id || null,
      audit_manual_checked_by_name: row.audit_manual_checked_by_name || null,
    }
  }
}

function calculateDaysBetween(start: string, end: string): number {
  if (!start || !end) return 1
  const d1 = new Date(start + 'T00:00:00')
  const d2 = new Date(end + 'T00:00:00')
  const diffTime = Math.abs(d2.getTime() - d1.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
  return diffDays || 1
}

export const storageService = new SupabaseStorageService()
