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
