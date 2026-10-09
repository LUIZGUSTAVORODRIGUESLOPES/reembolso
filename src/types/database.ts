export type TransportType = 'aéreo' | 'carro_proprio' | 'carro_alugado' | 'outros'

export type TripStatus = 'em_triagem' | 'com_pendencias' | 'auditada' | 'fechada' | 'reembolsada'

export type ExpenseCategory =
  | 'transporte'
  | 'alimentacao'
  | 'hospedagem'
  | 'pedagio'
  | 'combustivel'
  | 'uber_taxi'
  | 'estacionamento'
  | 'outros'

export type AuditStatus = 'pendente' | 'conforme' | 'justificado'

export type AuditFlag =
  | 'transporte_principal_ausente'
  | 'voo_sem_transporte_aeroporto'
  | 'sem_comprovante_hotel'
  | 'comprovante_duplicado'
  | 'falta_comprovante_aluguel'
  | 'falta_voo_retorno'
  | 'sem_categoria_definida'
  | string

export type UserRole = 'admin' | 'solicitante'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
  trips_count?: number
  alert_unsent_trip_enabled?: boolean
  alert_unsent_trip_days?: number
  alert_unsent_trip_repeat_days?: number
}

export type StandaloneRequestStatus = 'em_triagem' | 'empacotada' | 'quitada'

export interface StandaloneRequest {
  id: string
  user_id: string
  description: string
  category: string
  expense_date: string // YYYY-MM-DD
  amount: number
  notes?: string | null
  merchant_name?: string | null
  cnpj?: string | null
  receipt_url: string
  receipt_file_name: string
  receipt_storage_path?: string | null
  ocr_raw_text?: string | null
  status: StandaloneRequestStatus

  // Rastreamento de envio por e-mail (empacotamento)
  report_sent_at?: string | null
  report_sent_to?: string | null
  report_sent_by_id?: string | null
  report_sent_by_name?: string | null

  // Quitação
  settlement_date?: string | null // YYYY-MM-DD
  settlement_amount?: number | null
  settlement_deposit_total?: number | null
  settlement_batch_id?: string | null
  settlement_batch_count?: number | null
  settled_by_id?: string | null
  settled_by_name?: string | null
  settled_at?: string | null

  // Governança de reabertura
  reopened_at?: string | null
  reopened_by_id?: string | null
  reopened_by_name?: string | null
  reopen_reason?: string | null

  created_at: string
  updated_at: string
  user_profile?: Profile | null
}

export interface Trip {
  id: string
  user_id: string
  destination: string
  start_date: string // YYYY-MM-DD
  end_date: string // YYYY-MM-DD
  transport_type: TransportType
  status: TripStatus
  total_amount: number
  notes?: string
  motivo: string
  created_at: string
  user_profile?: Profile | null
  // Rastreamento de envio do relatório
  report_sent_at?: string | null
  report_sent_to?: string | null
  report_sent_by_id?: string | null
  report_sent_by_name?: string | null
  // Campos de quitação
  settlement_date?: string | null // YYYY-MM-DD
  settlement_amount?: number | null // Valor específico da viagem quitada
  settlement_deposit_total?: number | null // Valor total do depósito (se conjunto)
  settlement_batch_id?: string | null // UUID do lote se foi depósito conjunto
  settlement_batch_count?: number | null // Quantidade de viagens quitadas juntas
  settled_by_id?: string | null
  settled_by_name?: string | null
  settled_at?: string | null
  // Campos de governança de reabertura
  reopened_at?: string | null
  reopened_by_id?: string | null
  reopened_by_name?: string | null
  reopen_reason?: string | null
}

export interface Expense {
  id: string
  trip_id?: string | null
  file_url: string
  file_name: string
  issue_date: string // YYYY-MM-DD
  issue_time?: string
  category: ExpenseCategory
  merchant_name: string
  amount: number
  ocr_raw_text?: string
  is_verified: boolean
  audit_flags: AuditFlag[]
  audit_status: AuditStatus
  audit_justification?: string
  cnpj?: string
  audit_manual_checked?: boolean
  audit_manual_checked_at?: string | null
  audit_manual_checked_by_id?: string | null
  audit_manual_checked_by_name?: string | null
}

export interface AuditRulesLog {
  id: string
  trip_id: string
  rule_key: string
  status: 'pass' | 'warning' | 'justified'
  message: string
}

export interface AuditEvaluationRule {
  key: string
  title: string
  message: string
  severity: 'warning' | 'info' | 'pass'
  status: 'pass' | 'warning' | 'justified'
  justification?: string
}
