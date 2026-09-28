import { ExpenseCategory, TransportType, TripStatus } from '@/types/database'

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0)
}

export function formatDateBR(dateString: string): string {
  if (!dateString) return '-'
  try {
    const parts = dateString.split('-')
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`
    }
    return new Date(dateString).toLocaleDateString('pt-BR')
  } catch {
    return dateString
  }
}

export function formatDateRangeBR(start: string, end: string): string {
  if (!start) return '-'
  if (!end || start === end) return formatDateBR(start)
  const [sYear, sMonth, sDay] = start.split('-')
  const [eYear, eMonth, eDay] = end.split('-')

  if (sYear === eYear && sMonth === eMonth) {
    const monthNames = [
      'Jan',
      'Fev',
      'Mar',
      'Abr',
      'Mai',
      'Jun',
      'Jul',
      'Ago',
      'Set',
      'Out',
      'Nov',
      'Dez',
    ]
    const m = monthNames[parseInt(sMonth, 10) - 1] || sMonth
    return `${sDay} a ${eDay} de ${m} de ${sYear}`
  }

  return `${formatDateBR(start)} a ${formatDateBR(end)}`
}

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  transporte: 'Transporte',
  alimentacao: 'Alimentação',
  hospedagem: 'Hospedagem',
  pedagio: 'Pedágio',
  combustivel: 'Combustível',
  uber_taxi: 'Uber / Táxi',
  estacionamento: 'Estacionamento',
  outros: 'Outros',
}

export const CATEGORY_COLORS: Record<
  ExpenseCategory,
  { bg: string; text: string; border: string }
> = {
  transporte: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  alimentacao: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  hospedagem: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  pedagio: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  combustivel: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  uber_taxi: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  estacionamento: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  outros: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
}

export const TRIP_STATUS_CONFIG: Record<
  TripStatus,
  { label: string; badgeClass: string; pulse?: boolean }
> = {
  em_triagem: {
    label: 'Em Triagem',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    pulse: true,
  },
  com_pendencias: {
    label: 'Com Pendências',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  auditada: {
    label: 'Auditada',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  fechada: {
    label: 'Fechada',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
  },
  reembolsada: {
    label: 'Reembolsada',
    badgeClass: 'bg-emerald-600 text-white border-emerald-700',
  },
}

export const TRANSPORT_LABELS: Record<TransportType, string> = {
  aéreo: 'Aéreo',
  carro_proprio: 'Carro Próprio',
  carro_alugado: 'Carro Alugado',
  outros: 'Outros',
}
