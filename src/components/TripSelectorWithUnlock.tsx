import React, { useState } from 'react'
import { Lock, Unlock, PlusCircle, Briefcase, ChevronDown, Check, Search } from 'lucide-react'
import { Trip } from '@/types/database'
import { formatDateBR, TRIP_STATUS_CONFIG } from '@/lib/formatters'
import { storageService } from '@/services/storageService'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface TripSelectorWithUnlockProps {
  value?: string | null
  onChange: (tripId: string) => void
  trips: Trip[]
  onUnlockClick?: (trip: Trip) => void
  allowCreateNew?: boolean
  createNewText?: string
  className?: string
  disabled?: boolean
  placeholder?: string
}

export function TripSelectorWithUnlock({
  value,
  onChange,
  trips,
  onUnlockClick,
  allowCreateNew = true,
  createNewText = '+ Criar Nova Viagem (IA)',
  className,
  disabled = false,
  placeholder = 'Vincular à viagem',
}: TripSelectorWithUnlockProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { isAdmin } = useAuth()

  const selectedTrip = trips.find((t) => t.id === value)
  const isSelectedNew = value === 'new'

  const filteredTrips = trips.filter((t) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const dest = (t.destination || '').toLowerCase()
    const date = formatDateBR(t.start_date).toLowerCase()
    return dest.includes(q) || date.includes(q)
  })

  const handleSelect = (tripId: string) => {
    onChange(tripId)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'justify-between text-xs font-normal h-8 px-2.5 bg-slate-50 hover:bg-slate-100/80 border-slate-200',
            className,
          )}
        >
          <span className="truncate flex items-center gap-1.5">
            {isSelectedNew ? (
              <span className="text-blue-700 font-semibold">{createNewText}</span>
            ) : selectedTrip ? (
              <>
                <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate text-slate-800">
                  {selectedTrip.destination} ({formatDateBR(selectedTrip.start_date)})
                </span>
                {storageService.isTripLocked(selectedTrip) && (
                  <Lock className="w-3 h-3 text-amber-600 shrink-0" />
                )}
              </>
            ) : (
              <span className="text-slate-400">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[280px] sm:w-[320px] p-0 shadow-lg border-slate-200"
      >
        {/* Campo de busca rápida */}
        <div className="flex items-center border-b border-slate-100 px-2.5 py-1.5">
          <Search className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar destino ou data..."
            className="w-full text-xs bg-transparent outline-none placeholder:text-slate-400 text-slate-800"
            autoFocus
          />
        </div>

        <div className="max-h-60 overflow-y-auto p-1 text-xs">
          {allowCreateNew && (
            <button
              type="button"
              onClick={() => handleSelect('new')}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors font-medium',
                isSelectedNew ? 'bg-blue-50 text-blue-800' : 'text-blue-700 hover:bg-blue-50/70',
              )}
            >
              <PlusCircle className="w-3.5 h-3.5 shrink-0 text-blue-600" />
              <span className="truncate flex-1">{createNewText}</span>
              {isSelectedNew && <Check className="w-3.5 h-3.5 text-blue-700 shrink-0" />}
            </button>
          )}

          {filteredTrips.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-400">
              Nenhuma viagem encontrada.
            </div>
          ) : (
            filteredTrips.map((tr) => {
              const isLocked = storageService.isTripLocked(tr)
              const isReembolsada = tr.status === 'reembolsada'
              const canUnlock = isLocked && !isReembolsada && isAdmin
              const isSelected = value === tr.id
              const statusLabel = TRIP_STATUS_CONFIG[tr.status]?.label || tr.status

              return (
                <div
                  key={tr.id}
                  className={cn(
                    'group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md transition-colors',
                    isSelected ? 'bg-slate-100' : 'hover:bg-slate-50',
                    isLocked && 'bg-slate-50/60',
                  )}
                >
                  {/* Área principal do item (clicável apenas se não estiver bloqueada) */}
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => handleSelect(tr.id)}
                    className={cn(
                      'flex items-center gap-2 flex-1 text-left min-w-0 select-none',
                      isLocked ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
                    )}
                  >
                    <Check
                      className={cn(
                        'w-3.5 h-3.5 shrink-0',
                        isSelected ? 'text-blue-600 opacity-100' : 'opacity-0',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-semibold text-slate-800 truncate">
                          {tr.destination}
                        </span>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          ({formatDateBR(tr.start_date)})
                        </span>
                      </div>
                      {isLocked && (
                        <div className="text-[10px] text-amber-700 font-medium">
                          Status: {statusLabel} (bloqueada)
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Lado direito: Botão de desbloqueio ou cadeado indicativo */}
                  {isLocked && (
                    <div className="shrink-0 flex items-center">
                      {isReembolsada ? (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="p-1 rounded text-slate-400 bg-slate-100 cursor-not-allowed flex items-center gap-1 text-[10px]">
                                <Lock className="w-3.5 h-3.5 text-slate-400" />
                                <span className="hidden sm:inline">Quitada</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs max-w-xs">
                              Viagem já reembolsada (quitada). O processo é imutável e definitivo.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : canUnlock ? (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  if (onUnlockClick) {
                                    onUnlockClick(tr)
                                  }
                                }}
                                className="h-6 px-1.5 py-0 text-[10px] bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 gap-1 font-semibold shadow-2xs"
                              >
                                <Unlock className="w-3 h-3 text-amber-700" />
                                <span>Desbloquear</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs max-w-xs">
                              Clique para desbloquear esta viagem e incluir este comprovante nela.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="p-1 text-slate-400 flex items-center gap-1 cursor-default text-[10px]">
                                <Lock className="w-3.5 h-3.5 text-slate-400" />
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 h-4 border-slate-200 text-slate-500 font-normal"
                                >
                                  Fechada
                                </Badge>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs max-w-xs">
                              Apenas administradores podem reabrir viagens fechadas.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
