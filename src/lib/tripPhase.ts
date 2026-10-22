import { Trip, TripStatus } from '@/types/database'

export type TripPhase = 'todas' | 'em_aberto' | 'fechadas' | 'empacotadas' | 'quitadas'

/**
 * Determina a fase operacional da viagem:
 * 1. 'quitadas' — status 'reembolsada' (já quitada via fluxo financeiro/depósito)
 * 2. 'empacotadas' (Enviadas) — relatório com envio válido registrado (report_sent_at preenchido sem reabertura posterior)
 * 3. 'fechadas' (Fechada) — status 'auditada' (100% conferida, relatório ainda NÃO enviado) OU 'fechada' sem relatório despachado
 * 4. 'em_aberto' — ainda em trabalho ativo (status 'em_triagem' ou 'com_pendencias' e sem relatório despachado)
 */
/**
 * Retorna o status efetivo da viagem aplicando a regra de defesa de integridade:
 * Se `report_sent_at` estiver preenchido e o status no banco for 'em_triagem' ou 'com_pendencias',
 * e não houver reabertura posterior, a viagem já foi despachada por e-mail e seu status efetivo de negócio é 'fechada'.
 * Viagens 'reembolsada' ou 'auditada' preservam seus status.
 */
export function getEffectiveTripStatus(
  trip:
    | {
        status?: TripStatus | string | null
        report_sent_at?: string | null
        reopened_at?: string | null
      }
    | null
    | undefined,
): TripStatus {
  if (!trip || !trip.status) return 'em_triagem'

  const currentStatus = trip.status as TripStatus

  const isReopened =
    Boolean(trip.reopened_at) && (!trip.report_sent_at || trip.reopened_at >= trip.report_sent_at)

  // Se já foi enviado relatório e está em triagem ou com pendências, promove defensivamente para fechada
  if (
    Boolean(trip.report_sent_at) &&
    (currentStatus === 'em_triagem' || currentStatus === 'com_pendencias') &&
    !isReopened
  ) {
    return 'fechada'
  }

  return currentStatus
}

export interface TripPhaseInput {
  status: Trip['status']
  report_sent_at?: Trip['report_sent_at']
  reopened_at?: Trip['reopened_at']
  expenses?: Array<{
    is_verified?: boolean | null
    audit_status?: string | null
    audit_manual_checked?: boolean | null
  }> | null
  hasPendingExpenses?: boolean
  isFullyChecked?: boolean
}

/**
 * Determina se uma lista de despesas possui pendências de conferência.
 * Critério rigoroso:
 * Uma despesa é considerada conferida se audit_manual_checked === true
 * e audit_status !== 'pendente' e is_verified !== false.
 */
export function hasPendingExpensesCheck(
  expenses?: Array<{
    is_verified?: boolean | null
    audit_status?: string | null
    audit_manual_checked?: boolean | null
  }> | null,
): boolean {
  if (!expenses || expenses.length === 0) {
    // Sem despesas ou não carregadas ainda
    return false
  }
  return expenses.some(
    (exp) =>
      exp.audit_manual_checked !== true ||
      exp.audit_status === 'pendente' ||
      exp.is_verified === false,
  )
}

export function getTripPhase(
  trip: TripPhaseInput,
): 'em_aberto' | 'fechadas' | 'empacotadas' | 'quitadas' {
  const effectiveStatus = getEffectiveTripStatus(trip)

  if (effectiveStatus === 'reembolsada') {
    return 'quitadas'
  }

  // Verificação de reabertura ativa:
  // Viagem com reopened_at >= report_sent_at (ou sem report_sent_at) é reaberta (trabalho ativo)
  const isReopened =
    Boolean(trip.reopened_at) &&
    (!trip.report_sent_at || (trip.reopened_at ?? '') >= (trip.report_sent_at ?? ''))

  // Se a viagem possui envio válido registrado (report_sent_at presente e SEM reabertura posterior),
  // ela é classificada como 'empacotadas' (Enviada).
  const hasValidReportSent = Boolean(trip.report_sent_at) && !isReopened

  if (hasValidReportSent) {
    return 'empacotadas'
  }

  // BARREIRA LÓGICA (Gatekeeping):
  // Se houver informação sobre as despesas e elas NÃO estiverem 100% conferidas
  // (ou se hasPendingExpenses for explicitamente true),
  // a viagem DEVE retornar estritamente a fase 'em_aberto' (Triagem).
  const hasPending =
    trip.hasPendingExpenses !== undefined
      ? trip.hasPendingExpenses
      : trip.isFullyChecked !== undefined
        ? !trip.isFullyChecked
        : trip.expenses && trip.expenses.length > 0
          ? hasPendingExpensesCheck(trip.expenses)
          : false

  if (hasPending) {
    return 'em_aberto'
  }

  // Viagens com 100% dos recibos conferidos cujo relatório ainda NÃO foi enviado:
  // Status 'auditada' ou 'fechada' sem envio válido registrado entram na fase 'fechadas' ("Fechada").
  // Dessa forma, o usuário vê claramente que a conferência terminou e pode revisar ou enviar.
  if (effectiveStatus === 'auditada' || effectiveStatus === 'fechada') {
    return 'fechadas'
  }

  return 'em_aberto'
}

export interface PhaseCounts {
  todas: number
  em_aberto: number
  fechadas: number
  empacotadas: number
  quitadas: number
}

export function countTripsByPhase(trips: TripPhaseInput[]): PhaseCounts {
  const counts: PhaseCounts = {
    todas: trips.length,
    em_aberto: 0,
    fechadas: 0,
    empacotadas: 0,
    quitadas: 0,
  }

  for (const t of trips) {
    const phase = getTripPhase(t)
    counts[phase] += 1
  }

  return counts
}
