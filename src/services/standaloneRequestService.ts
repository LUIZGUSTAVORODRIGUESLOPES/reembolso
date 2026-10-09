import { supabase } from '@/lib/supabase/client'
import { StandaloneRequest, StandaloneRequestStatus } from '@/types/database'

class StandaloneRequestService {
  private get client(): any {
    return supabase as any
  }

  private isValidUuid(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  }

  private mapRow(row: any): StandaloneRequest {
    return {
      id: row.id,
      user_id: row.user_id,
      description: row.description || '',
      category: row.category || 'Equipamento',
      expense_date: row.expense_date,
      amount: Number(row.amount ?? 0),
      notes: row.notes || '',
      merchant_name: row.merchant_name || '',
      cnpj: row.cnpj || '',
      receipt_url: row.receipt_url || '',
      receipt_file_name: row.receipt_file_name || '',
      receipt_storage_path: row.receipt_storage_path || null,
      ocr_raw_text: row.ocr_raw_text || null,
      status: (row.status || 'em_triagem') as StandaloneRequestStatus,
      report_sent_at: row.report_sent_at || null,
      report_sent_to: row.report_sent_to || null,
      report_sent_by_id: row.report_sent_by_id || null,
      report_sent_by_name: row.report_sent_by_name || null,
      settlement_date: row.settlement_date || null,
      settlement_amount:
        row.settlement_amount !== null && row.settlement_amount !== undefined
          ? Number(row.settlement_amount)
          : null,
      settlement_deposit_total:
        row.settlement_deposit_total !== null && row.settlement_deposit_total !== undefined
          ? Number(row.settlement_deposit_total)
          : null,
      settlement_batch_id: row.settlement_batch_id || null,
      settlement_batch_count: row.settlement_batch_count ?? null,
      settled_by_id: row.settled_by_id || null,
      settled_by_name: row.settled_by_name || null,
      settled_at: row.settled_at || null,
      reopened_at: row.reopened_at || null,
      reopened_by_id: row.reopened_by_id || null,
      reopened_by_name: row.reopened_by_name || null,
      reopen_reason: row.reopen_reason || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      user_profile: row.user_profile || null,
    }
  }

  public async listRequests(): Promise<StandaloneRequest[]> {
    let requestsRaw: any[] | null = null

    try {
      const { data, error } = await this.client
        .from('standalone_requests')
        .select('*, user_profile:profiles(*)')
        .order('expense_date', { ascending: false })

      if (!error && data) {
        requestsRaw = data
      }
    } catch {
      // fallback
    }

    if (!requestsRaw) {
      const { data: fallback, error } = await this.client
        .from('standalone_requests')
        .select('*')
        .order('expense_date', { ascending: false })

      if (error) {
        console.error('Error fetching standalone requests:', error)
        throw error
      }
      requestsRaw = fallback || []
    }

    // Enrich with profiles if missing
    const missingProfileUserIds = Array.from(
      new Set(
        (requestsRaw || [])
          .filter((r: any) => r.user_id && !r.user_profile)
          .map((r: any) => r.user_id),
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
          requestsRaw = (requestsRaw || []).map((r: any) => {
            if (!r.user_profile && r.user_id && profMap.has(r.user_id)) {
              return { ...r, user_profile: profMap.get(r.user_id) }
            }
            return r
          })
        }
      } catch {
        // non-blocking
      }
    }

    return (requestsRaw || []).map((r) => this.mapRow(r))
  }

  public async getRequest(id: string): Promise<StandaloneRequest | null> {
    const { data, error } = await this.client
      .from('standalone_requests')
      .select('*, user_profile:profiles(*)')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('Error fetching request:', error)
      throw error
    }
    return data ? this.mapRow(data) : null
  }

  public async createRequest(params: {
    description: string
    category: string
    expense_date: string
    amount: number
    notes?: string
    merchant_name?: string
    cnpj?: string
    receipt_url: string
    receipt_file_name: string
    receipt_storage_path?: string
    ocr_raw_text?: string
  }): Promise<StandaloneRequest> {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData?.user?.id
    if (!userId) {
      throw new Error('Você precisa estar autenticado para criar uma solicitação avulsa.')
    }

    const payload: Record<string, unknown> = {
      user_id: userId,
      description: params.description.trim(),
      category: params.category.trim() || 'Equipamento',
      expense_date: params.expense_date,
      amount: Number(params.amount) || 0,
      notes: params.notes?.trim() || '',
      merchant_name: params.merchant_name?.trim() || '',
      cnpj: params.cnpj?.trim() || '',
      receipt_url: params.receipt_url,
      receipt_file_name: params.receipt_file_name,
      receipt_storage_path: params.receipt_storage_path || null,
      ocr_raw_text: params.ocr_raw_text || null,
      status: 'em_triagem',
    }

    const { data, error } = await this.client
      .from('standalone_requests')
      .insert(payload)
      .select()
      .single()

    if (error) {
      console.error('Error creating standalone request:', error)
      throw error
    }

    return this.mapRow(data)
  }

  public async updateRequest(
    id: string,
    updates: Partial<Omit<StandaloneRequest, 'id' | 'created_at' | 'user_id'>>,
  ): Promise<StandaloneRequest | null> {
    const payload: Record<string, unknown> = { ...updates }

    const { data, error } = await this.client
      .from('standalone_requests')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating standalone request:', error)
      throw error
    }

    return data ? this.mapRow(data) : null
  }

  /**
   * Marcação de empacotamento via envio de e-mail.
   * Transiciona status para 'empacotada' e grava metadados de envio.
   */
  public async markReportEmailSent(
    id: string,
    sentTo: string,
    user?: { id: string; name: string } | null,
  ): Promise<StandaloneRequest | null> {
    const updates: Record<string, unknown> = {
      status: 'empacotada',
      report_sent_at: new Date().toISOString(),
      report_sent_to: sentTo.trim(),
    }
    if (user?.id && this.isValidUuid(user.id)) {
      updates.report_sent_by_id = user.id
    }
    if (user?.name) {
      updates.report_sent_by_name = user.name
    }

    return this.updateRequest(id, updates as any)
  }

  /**
   * Reabertura de solicitação empacotada voltando para 'em_triagem'.
   * Exige motivo com no mínimo 10 caracteres (governança v0.0.26).
   */
  public async reopenRequest(params: {
    requestId: string
    reason: string
    user?: { id: string; name: string } | null
  }): Promise<StandaloneRequest | null> {
    const { requestId, reason, user } = params
    const trimmedReason = (reason || '').trim()

    if (!trimmedReason || trimmedReason.length < 10) {
      throw new Error('O motivo da reabertura deve conter no mínimo 10 caracteres explicativos.')
    }

    const current = await this.getRequest(requestId)
    if (!current) {
      throw new Error('Solicitação avulsa não encontrada.')
    }

    if (current.status === 'quitada') {
      throw new Error(
        'Solicitações com status "quitada" não podem ser reabertas. A quitação é definitiva e blindada.',
      )
    }

    if (current.status !== 'empacotada') {
      throw new Error(
        `Apenas solicitações com status "empacotada" podem ser reabertas. O status atual é "${current.status}".`,
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

    return this.updateRequest(requestId, updates as any)
  }

  /**
   * Quitação individual de uma solicitação avulsa empacotada.
   */
  public async settleSingleRequest(params: {
    requestId: string
    depositDate: string
    depositAmount: number
    user?: { id: string; name: string } | null
  }): Promise<StandaloneRequest | null> {
    const { requestId, depositDate, depositAmount, user } = params
    const current = await this.getRequest(requestId)
    if (!current) throw new Error('Solicitação avulsa não encontrada.')

    if (current.status !== 'empacotada') {
      throw new Error('A solicitação precisa estar empacotada para poder ser quitada.')
    }

    const updates: Record<string, unknown> = {
      status: 'quitada',
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

    return this.updateRequest(requestId, updates as any)
  }

  /**
   * Quitação conjunta em lote de múltiplas solicitações empacotadas.
   */
  public async settleBatchRequests(params: {
    requestIds: string[]
    depositDate: string
    depositTotal: number
    requestsAmounts: Record<string, number>
    user?: { id: string; name: string } | null
  }): Promise<StandaloneRequest[]> {
    const { requestIds, depositDate, depositTotal, requestsAmounts, user } = params
    if (!requestIds.length) return []

    const batchId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : '00000000-0000-0000-0000-000000000000'

    const nowIso = new Date().toISOString()
    const updatedList: StandaloneRequest[] = []

    for (const reqId of requestIds) {
      const amount = requestsAmounts[reqId] ?? 0
      const updates: Record<string, unknown> = {
        status: 'quitada',
        settlement_date: depositDate,
        settlement_amount: amount,
        settlement_deposit_total: depositTotal,
        settlement_batch_id: batchId,
        settlement_batch_count: requestIds.length,
        settled_at: nowIso,
      }
      if (user?.id && this.isValidUuid(user.id)) {
        updates.settled_by_id = user.id
      }
      if (user?.name) {
        updates.settled_by_name = user.name
      }

      const res = await this.updateRequest(reqId, updates as any)
      if (res) {
        updatedList.push(res)
      }
    }

    return updatedList
  }

  /**
   * Exclui solicitação avulsa (apenas permitida em status 'em_triagem').
   * Preserva arquivo físico no Storage para permitir Desfazer de 10s.
   */
  public async deleteRequest(id: string): Promise<boolean> {
    const current = await this.getRequest(id)
    if (!current) return true

    if (current.status !== 'em_triagem') {
      throw new Error('Não é permitido excluir uma solicitação já empacotada ou quitada.')
    }

    const { error } = await this.client.from('standalone_requests').delete().eq('id', id)
    if (error) {
      console.error('Error deleting standalone request:', error)
      throw error
    }

    return true
  }

  /**
   * Restaura uma solicitação avulsa anteriormente excluída (fluxo Desfazer).
   */
  public async restoreRequest(req: StandaloneRequest): Promise<StandaloneRequest> {
    const payload: Record<string, unknown> = {
      id: req.id && this.isValidUuid(req.id) ? req.id : undefined,
      user_id: req.user_id,
      description: req.description,
      category: req.category,
      expense_date: req.expense_date,
      amount: req.amount,
      notes: req.notes || '',
      merchant_name: req.merchant_name || '',
      cnpj: req.cnpj || '',
      receipt_url: req.receipt_url,
      receipt_file_name: req.receipt_file_name,
      receipt_storage_path: req.receipt_storage_path || null,
      ocr_raw_text: req.ocr_raw_text || null,
      status: req.status || 'em_triagem',
    }

    const { data, error } = await this.client
      .from('standalone_requests')
      .insert(payload)
      .select()
      .single()

    if (error) {
      console.error('Error restoring standalone request:', error)
      throw error
    }

    return this.mapRow(data)
  }

  /**
   * Upload de comprovante físico para bucket 'comprovantes' no Supabase Storage.
   */
  public async uploadReceiptFile(file: File): Promise<{ storagePath: string; publicUrl: string }> {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData?.user?.id || 'anon'

    const cleanName = file.name.replace(/[^\w\s.\-_]/gi, '_').replace(/\.\.+/g, '')
    const storagePath = `avulsas/${userId}/${Date.now()}_${cleanName}`

    const { error: uploadError } = await supabase.storage
      .from('comprovantes')
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      })

    if (uploadError) {
      console.error('Falha no upload do comprovante para o Storage:', uploadError)
      throw uploadError
    }

    const { data: urlData } = supabase.storage.from('comprovantes').getPublicUrl(storagePath)

    return {
      storagePath,
      publicUrl: urlData.publicUrl,
    }
  }
}

export const standaloneRequestService = new StandaloneRequestService()
