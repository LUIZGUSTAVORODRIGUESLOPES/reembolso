import { Trip } from '@/types/database'

export type TripPhase = 'todas' | 'em_aberto' | 'empacotadas' | 'quitadas'

/**
 * Determina a fase operacional da viagem:
 * 1. 'quitadas' — status 'reembolsada' (já quitada via fluxo financeiro/depósito)
 * 2. 'empacotadas' — relatório já despachado por e-mail (report_sent_at preenchido)
 *                    OU status 'auditada' / 'fechada' (processo já concluído/fechado, aguardando quitação)
 * 3. 'em_aberto' — ainda em trabalho ativo (status 'em_triagem' ou 'com_pendencias' e sem relatório despachado)
 */
export function getTripPhase(
  trip: Pick<Trip, 'status' | 'report_sent_at'>,
): 'em_aberto' | 'empacotadas' | 'quitadas' {
  if (trip.status === 'reembolsada') {
    return 'quitadas'
  }

  if (Boolean(trip.report_sent_at) || trip.status === 'auditada' || trip.status === 'fechada') {
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
