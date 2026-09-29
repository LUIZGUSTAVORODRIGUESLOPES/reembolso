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
    const { data, error } = await this.client
      .from('trips')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching trips:', error)
      throw error
    }

    return (data || []).map(this.mapTripRow)
  }

  public async getTrip(id: string): Promise<Trip | null> {
    const { data, error } = await this.client.from('trips').select('*').eq('id', id).maybeSingle()

    if (error) {
      console.error('Error getting trip:', error)
      throw error
    }

    return data ? this.mapTripRow(data) : null
  }

  public async createTrip(
    tripData: Omit<Trip, 'id' | 'created_at' | 'total_amount' | 'user_id'> & {
      id?: string
      user_id?: string
      total_amount?: number
    },
  ): Promise<Trip> {
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
    if (tripData.user_id && this.isValidUuid(tripData.user_id)) {
      payload.user_id = tripData.user_id
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

  public isTripLockedForDeletion(status: TripStatus | string): boolean {
    return status === 'fechada' || status === 'reembolsada'
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
   * Delete a single expense and also remove its corresponding receipt object from Storage.
   */
  public async deleteExpense(id: string): Promise<boolean> {
    const current = await this.getExpense(id)
    if (!current) return true

    if (current.trip_id) {
      const trip = await this.getTrip(current.trip_id)
      if (trip && this.isTripLockedForDeletion(trip.status)) {
        throw new Error('Não é possível excluir despesa de uma viagem já fechada ou reembolsada.')
      }
    }

    // Attempt to identify storage file to delete
    const filePathsToDelete: string[] = []
    const pathFromUrl = this.extractStoragePath(current.file_url, current.file_name)
    if (pathFromUrl) {
      filePathsToDelete.push(pathFromUrl)
    }

    // If file_url didn't have full path, see if bucket has matching file
    if (filePathsToDelete.length === 0 && current.file_name) {
      try {
        const { data: bucketList } = await supabase.storage
          .from('comprovantes')
          .list('', { limit: 100 })
        const cleanTarget = current.file_name.toLowerCase().replace(/[^a-z0-9.-]/g, '_')
        const matched = bucketList?.find((f) => {
          const low = f.name.toLowerCase()
          return (
            low.endsWith(cleanTarget) ||
            low.includes(cleanTarget.replace('.pdf', '').replace(/\.[a-z]+$/, ''))
          )
        })
        if (matched) {
          filePathsToDelete.push(matched.name)
        }
      } catch (err) {
        console.warn('Error matching bucket file for deletion:', err)
      }
    }

    const { error } = await this.client.from('expenses').delete().eq('id', id)
    if (error) {
      console.error('Error deleting expense:', error)
      throw error
    }

    // Delete corresponding physical storage file(s)
    if (filePathsToDelete.length > 0) {
      await this.deleteStorageFiles(filePathsToDelete)
    }

    if (current.trip_id) {
      await this.recalculateTripTotal(current.trip_id)
    }

    return true
  }

  /**
   * Delete a full trip in cascade:
   * 1. Check status (reject if 'fechada' or 'reembolsada')
   * 2. Find all attached expenses
   * 3. Collect receipt files in bucket 'comprovantes' and delete them
   * 4. Delete expenses
   * 5. Delete audit_rules_log
   * 6. Delete trip
   */
  public async deleteTrip(id: string): Promise<boolean> {
    const trip = await this.getTrip(id)
    if (!trip) return true

    if (this.isTripLockedForDeletion(trip.status)) {
      throw new Error('Não é permitido excluir uma viagem já fechada ou reembolsada.')
    }

    const expenses = await this.listExpenses(id)

    // Collect all storage paths
    const pathsToDelete: string[] = []
    let bucketFilesCache: string[] | null = null

    for (const exp of expenses) {
      const extracted = this.extractStoragePath(exp.file_url, exp.file_name)
      if (extracted) {
        pathsToDelete.push(extracted)
      } else if (exp.file_name) {
        if (!bucketFilesCache) {
          try {
            const { data } = await supabase.storage.from('comprovantes').list('', { limit: 100 })
            bucketFilesCache = (data || []).map((f) => f.name)
          } catch {
            bucketFilesCache = []
          }
        }
        const cleanTarget = exp.file_name.toLowerCase().replace(/[^a-z0-9.-]/g, '_')
        const matched = bucketFilesCache.find((name) => {
          const low = name.toLowerCase()
          return (
            low.endsWith(cleanTarget) ||
            low.includes(cleanTarget.replace('.pdf', '').replace(/\.[a-z]+$/, ''))
          )
        })
        if (matched) {
          pathsToDelete.push(matched)
        }
      }
    }

    // Delete storage objects from bucket
    if (pathsToDelete.length > 0) {
      await this.deleteStorageFiles(pathsToDelete)
    }

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

    return true
  }

  public async recalculateTripTotal(tripId: string): Promise<number> {
    const expenses = await this.listExpenses(tripId)
    const sum = expenses.reduce((acc, curr) => acc + (curr.amount || 0), 0)
    const rounded = Number(sum.toFixed(2))

    await this.client.from('trips').update({ total_amount: rounded }).eq('id', tripId)

    return rounded
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
