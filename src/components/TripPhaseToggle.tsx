import React from 'react'
import { FolderClock, PackageCheck, CheckCircle2, LayoutGrid } from 'lucide-react'
import { TripPhase, PhaseCounts } from '@/lib/tripPhase'
import { Badge } from '@/components/ui/badge'

interface TripPhaseToggleProps {
  value: TripPhase
  onChange: (phase: TripPhase) => void
  counts?: PhaseCounts
  className?: string
  showAllOption?: boolean
  size?: 'sm' | 'default'
}

export const TripPhaseToggle: React.FC<TripPhaseToggleProps> = ({
  value,
  onChange,
  counts,
  className = '',
  showAllOption = true,
  size = 'default',
}) => {
  const items: {
    id: TripPhase
    label: string
    shortLabel: string
    description: string
    icon: React.ComponentType<{ className?: string }>
    activeColor: string
    badgeActiveColor: string
  }[] = [
    ...(showAllOption
      ? [
          {
            id: 'todas' as TripPhase,
            label: 'Todas',
            shortLabel: 'Todas',
            description: 'Todas as viagens cadastradas',
            icon: LayoutGrid,
            activeColor: 'bg-white text-slate-900 shadow-sm border-slate-300',
            badgeActiveColor: 'bg-slate-200 text-slate-800',
          },
        ]
      : []),
    {
      id: 'em_aberto',
      label: 'Em Aberto',
      shortLabel: 'Aberto',
      description: 'Em triagem ou com pendências',
      icon: FolderClock,
      activeColor: 'bg-white text-blue-900 shadow-sm border-blue-200',
      badgeActiveColor: 'bg-blue-100 text-blue-800',
    },
    {
      id: 'empacotadas',
      label: 'Enviadas',
      shortLabel: 'Enviadas',
      description: 'Relatório enviado ou auditada/fechada',
      icon: PackageCheck,
      activeColor: 'bg-white text-indigo-900 shadow-sm border-indigo-200',
      badgeActiveColor: 'bg-indigo-100 text-indigo-800',
    },
    {
      id: 'quitadas',
      label: 'Quitadas',
      shortLabel: 'Quitadas',
      description: 'Reembolso depositado / quitado',
      icon: CheckCircle2,
      activeColor: 'bg-white text-emerald-900 shadow-sm border-emerald-200',
      badgeActiveColor: 'bg-emerald-100 text-emerald-800',
    },
  ]

  const isSmall = size === 'sm'

  return (
    <div
      role="group"
      aria-label="Fase da viagem"
      className={`inline-flex items-center p-1 bg-slate-100/90 rounded-lg border border-slate-200 gap-1 overflow-x-auto max-w-full ${className}`}
    >
      {items.map((item) => {
        const isActive = value === item.id
        const count = counts ? counts[item.id] : undefined
        const Icon = item.icon

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            title={item.description}
            className={`
              inline-flex items-center gap-1.5 font-semibold transition-all rounded-md whitespace-nowrap
              ${isSmall ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs sm:text-sm'}
              ${
                isActive
                  ? `${item.activeColor} border font-bold`
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 border border-transparent'
              }
            `}
          >
            <Icon
              className={`shrink-0 ${isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${
                isActive
                  ? item.id === 'quitadas'
                    ? 'text-emerald-600'
                    : item.id === 'empacotadas'
                      ? 'text-indigo-600'
                      : item.id === 'em_aberto'
                        ? 'text-blue-600'
                        : 'text-slate-700'
                  : 'text-slate-400'
              }`}
            />
            <span>{item.label}</span>
            {typeof count === 'number' && (
              <span
                className={`
                  ml-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 py-0.2 min-w-[18px] leading-tight
                  ${
                    isActive
                      ? item.badgeActiveColor
                      : 'bg-slate-200/80 text-slate-600 group-hover:bg-slate-300'
                  }
                `}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
