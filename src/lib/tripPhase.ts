import { Trip, TripStatus } from '@/types/database'

export type TripPhase = 'todas' | 'em_aberto' | 'empacotadas' | 'quitadas'

/**
 * Determina a fase operacional da viagem:
 * 1. 'quitadas' — status 'reembolsada' (já quitada via fluxo financeiro/depósito)
 * 2. 'empacotadas' — relatório já despachado por e-mail (report_sent_at preenchido)
 *                    OU status 'auditada' / 'fechada' (processo já concluído/fechado, aguardando quitação)
 * 3. 'em_aberto' — ainda em trabalho ativo (status 'em_triagem' ou 'com_pendencias' e sem relatório despachado)
 */
/**
 * Retorna o status efetivo da viagem aplicando a regra de defesa de integridade:
 * Se `report_sent_at` estiver preenchido e o status no banco for 'em_triagem' ou 'com_pendencias',
 * a viagem já foi despachada por e-mail e seu status efetivo de negócio é 'fechada'.
 * Viagens 'reembolsada' ou 'auditada' (ou 'fechada') preservam seus status.
 */
export function getEffectiveTripStatus(
  trip: { status?: TripStatus | string | null; report_sent_at?: string | null } | null | undefined,
): TripStatus {
  if (!trip || !trip.status) return 'em_triagem'

  const currentStatus = trip.status as TripStatus

  // Se já foi enviado relatório e está em triagem ou com pendências, promove defensivamente para fechada
  if (
    Boolean(trip.report_sent_at) &&
    (currentStatus === 'em_triagem' || currentStatus === 'com_pendencias')
  ) {
    return 'fechada'
  }

  return currentStatus
}

export function getTripPhase(
  trip: Pick<Trip, 'status' | 'report_sent_at'>,
): 'em_aberto' | 'empacotadas' | 'quitadas' {
  const effectiveStatus = getEffectiveTripStatus(trip)

  if (effectiveStatus === 'reembolsada') {
    return 'quitadas'
  }

  // Viagens empacotadas / enviadas:
  // Relatório despachado por e-mail (report_sent_at preenchido)
  // OU status 'auditada' (100% conferida, pronta para envio/quitação)
  // OU status 'fechada' (processo concluído aguardando quitação)
  if (
    Boolean(trip.report_sent_at) ||
    effectiveStatus === 'auditada' ||
    effectiveStatus === 'fechada'
  ) {
    return 'empacotadas'
  }

  return 'em_aberto'
}

export interface PhaseCounts {
  todas: number
  em_aberto: number
  empacotadas: number
  quitadas: number
}

export function countTripsByPhase(trips: Pick<Trip, 'status' | 'report_sent_at'>[]): PhaseCounts {
  const counts: PhaseCounts = {
    todas: trips.length,
    em_aberto: 0,
    empacotadas: 0,
    quitadas: 0,
  }

  for (const t of trips) {
    const phase = getTripPhase(t)
    counts[phase] += 1
  }

  return counts
}
