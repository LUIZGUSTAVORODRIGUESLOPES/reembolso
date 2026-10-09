import React, { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2,
  DollarSign,
  Calendar,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Layers,
  ArrowRight,
  ShieldCheck,
  Info,
} from 'lucide-react'
import { Trip } from '@/types/database'
import { storageService } from '@/services/storageService'
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateRangeBR,
  TRIP_STATUS_CONFIG,
  getEffectiveTripStatus,
} from '@/lib/formatters'
import { useToast } from '@/hooks/use-toast'

interface SettleTripModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentTrip: Trip
  onSuccess: (updatedTrip: Trip) => void
  user?: { id: string; name: string } | null
  expenses?: Array<{
    is_verified?: boolean | null
    audit_status?: string | null
    audit_manual_checked?: boolean | null
  }> | null
}

export function SettleTripModal({
  open,
  onOpenChange,
  currentTrip,
  onSuccess,
  user,
  expenses,
}: SettleTripModalProps) {
  const { toast } = useToast()

  // Central question: "Foi reembolsado mais de uma viagem na mesma data?"
  const [isMultipleTrips, setIsMultipleTrips] = useState<boolean>(false)

  // Single trip settlement state
  const [singleDepositDate, setSingleDepositDate] = useState<string>(
    new Date().toISOString().split('T')[0],
  )
  const [singleDepositAmount, setSingleDepositAmount] = useState<string>(
    currentTrip.total_amount ? String(currentTrip.total_amount) : '0',
  )

  // Multiple trips settlement state
  const [batchDepositDate, setBatchDepositDate] = useState<string>(
    new Date().toISOString().split('T')[0],
  )
  const [batchDepositTotalStr, setBatchDepositTotalStr] = useState<string>('')
  const [allEligibleTrips, setAllEligibleTrips] = useState<Trip[]>([])
  const [selectedTripIds, setSelectedTripIds] = useState<string[]>([currentTrip.id])
  const [loadingEligibleTrips, setLoadingEligibleTrips] = useState<boolean>(false)

  // Confirmation/saving state
  const [submitting, setSubmitting] = useState(false)

  // Estado de carregamento das despesas da viagem atual (inicializa com expenses || [])
  const [tripExpensesList, setTripExpensesList] = useState<
    Array<{
      is_verified?: boolean | null
      audit_status?: string | null
      audit_manual_checked?: boolean | null
    }>
  >(expenses || [])
  const [loadingCurrentExpenses, setLoadingCurrentExpenses] = useState(false)

  // Recarregar despesas quando o modal abrir ou props expenses mudarem
  useEffect(() => {
    if (open) {
      if (expenses && expenses.length > 0) {
        setTripExpensesList(expenses)
      } else {
        setLoadingCurrentExpenses(true)
        storageService
          .listExpenses(currentTrip.id)
          .then((res) => setTripExpensesList(res || []))
          .catch((err) =>
            console.warn('Erro ao carregar despesas para validação de quitação:', err),
          )
          .finally(() => setLoadingCurrentExpenses(false))
      }
    }
  }, [open, currentTrip.id, expenses])

  // Gatekeeping: Checagem se a viagem atual possui recibos pendentes
  const currentTripHasPending = useMemo(() => {
    if (loadingCurrentExpenses) return false
    if (!tripExpensesList || tripExpensesList.length === 0) return true
    return tripExpensesList.some(
      (e) =>
        e.audit_manual_checked !== true || e.audit_status === 'pendente' || e.is_verified === false,
    )
  }, [tripExpensesList, loadingCurrentExpenses])

  // Reset values when modal opens or currentTrip changes
  useEffect(() => {
    if (open) {
      setIsMultipleTrips(false)
      const todayStr = new Date().toISOString().split('T')[0]
      setSingleDepositDate(todayStr)
      setSingleDepositAmount(String(currentTrip.total_amount || 0))
      setBatchDepositDate(todayStr)
      setBatchDepositTotalStr('')
      setSelectedTripIds([currentTrip.id])
      loadEligibleTrips()
    }
  }, [open, currentTrip.id, currentTrip.total_amount])

  const loadEligibleTrips = async () => {
    setLoadingEligibleTrips(true)
    try {
      const [trips, allExps] = await Promise.all([
        storageService.listTrips(),
        storageService.listExpenses().catch(() => []),
      ])

      // Mapear pendências por trip_id
      const pendingMap = new Map<string, boolean>()
      for (const e of allExps) {
        const isPending =
          e.audit_manual_checked !== true ||
          e.audit_status === 'pendente' ||
          e.is_verified === false
        if (isPending) {
          pendingMap.set(e.trip_id, true)
        }
      }

      // Viagens elegíveis: não reembolsadas
      const notReimbursed = trips.filter((t) => t.status !== 'reembolsada')
      const hasCurrent = notReimbursed.some((t) => t.id === currentTrip.id)
      if (!hasCurrent) {
        notReimbursed.unshift(currentTrip)
      }
      // Anexar flag interna de pendência para cada viagem
      const enriched = notReimbursed.map((t) => {
        const hasPending =
          pendingMap.get(t.id) ?? (t.id === currentTrip.id ? currentTripHasPending : false)
        return { ...t, _hasPendingExpenses: hasPending }
      })
      setAllEligibleTrips(enriched as any)
    } catch (err) {
      console.error('Erro ao listar viagens elegíveis para quitação:', err)
      toast({
        title: 'Erro ao carregar viagens',
        description: 'Não foi possível buscar a lista de viagens disponíveis para quitação.',
        variant: 'destructive',
      })
    } finally {
      setLoadingEligibleTrips(false)
    }
  }

  // Toggle selection of trip in batch mode
  const handleToggleTripSelection = (tripId: string, isAllowed: boolean) => {
    if (!isAllowed) return
    // A viagem atual deve obrigatoriamente estar na lista
    if (tripId === currentTrip.id) {
      return
    }
    setSelectedTripIds((prev) =>
      prev.includes(tripId) ? prev.filter((id) => id !== tripId) : [...prev, tripId],
    )
  }

  // Cálculo da soma em tempo real das viagens selecionadas
  const selectedTripsSum = useMemo(() => {
    return allEligibleTrips
      .filter((t) => selectedTripIds.includes(t.id))
      .reduce((sum, t) => sum + (t.total_amount || 0), 0)
  }, [allEligibleTrips, selectedTripIds])

  // Parse do valor total do depósito digitado pelo usuário (modo conjunto)
  const parsedBatchDepositTotal = useMemo(() => {
    const cleaned = batchDepositTotalStr.replace(/\./g, '').replace(',', '.')
    const val = parseFloat(cleaned)
    return isNaN(val) ? 0 : val
  }, [batchDepositTotalStr])

  // Diferença entre soma das viagens e o depósito informado
  const depositDiff = useMemo(() => {
    if (!parsedBatchDepositTotal) return 0
    return Number((parsedBatchDepositTotal - selectedTripsSum).toFixed(2))
  }, [parsedBatchDepositTotal, selectedTripsSum])

  const isSumMatching = useMemo(() => {
    if (!parsedBatchDepositTotal) return false
    return Math.abs(depositDiff) < 0.01
  }, [parsedBatchDepositTotal, depositDiff])

  // Submissão do depósito único (Caso NÃO)
  const handleConfirmSingleSettlement = async () => {
    if (currentTripHasPending) {
      toast({
        title: 'Bloqueio de Quitação',
        description:
          'Complete a conferência de todos os recibos pendentes na Triagem para liberar o envio.',
        variant: 'destructive',
      })
      return
    }
    const parsedAmount = parseFloat(
      String(singleDepositAmount).replace(/\./g, '').replace(',', '.'),
    )
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: 'Valor de depósito inválido',
        description: 'Informe um valor numérico positivo para o depósito.',
        variant: 'destructive',
      })
      return
    }

    if (!singleDepositDate) {
      toast({
        title: 'Data do depósito obrigatória',
        description: 'Por favor, selecione a data em que o depósito foi efetuado.',
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      const updated = await storageService.settleSingleTrip({
        tripId: currentTrip.id,
        depositDate: singleDepositDate,
        depositAmount: parsedAmount,
        user,
      })

      if (updated) {
        toast({
          title: 'Viagem quitada com sucesso! 💰',
          description: `A viagem para "${updated.destination}" foi marcada como Reembolsada no valor de ${formatCurrencyBRL(parsedAmount)}.`,
        })
        onSuccess(updated)
        onOpenChange(false)
      }
    } catch (err: any) {
      console.error('Erro ao quitar viagem:', err)
      toast({
        title: 'Erro ao quitar viagem',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Submissão do depósito conjunto (Caso SIM)
  const handleConfirmBatchSettlement = async () => {
    if (currentTripHasPending) {
      toast({
        title: 'Bloqueio de Quitação',
        description:
          'Complete a conferência de todos os recibos pendentes na Triagem para liberar o envio.',
        variant: 'destructive',
      })
      return
    }
    if (!batchDepositDate) {
      toast({
        title: 'Data do depósito obrigatória',
        description: 'Por favor, selecione a data do depósito bancário.',
        variant: 'destructive',
      })
      return
    }

    if (parsedBatchDepositTotal <= 0) {
      toast({
        title: 'Valor total do depósito obrigatório',
        description: 'Informe o valor total do depósito consolidado.',
        variant: 'destructive',
      })
      return
    }

    if (selectedTripIds.length <= 1) {
      toast({
        title: 'Selecione mais de uma viagem',
        description:
          'Para depósito conjunto, selecione duas ou mais viagens que compõem o valor total. Para apenas uma viagem, selecione a opção "Não".',
        variant: 'destructive',
      })
      return
    }

    if (!isSumMatching) {
      toast({
        title: 'A soma das viagens não bate com o valor do depósito',
        description: `Diferença de ${formatCurrencyBRL(Math.abs(depositDiff))}. Ajuste as viagens selecionadas ou o valor total do depósito antes de confirmar.`,
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      const tripsAmountsMap: Record<string, number> = {}
      for (const t of allEligibleTrips) {
        if (selectedTripIds.includes(t.id)) {
          tripsAmountsMap[t.id] = t.total_amount || 0
        }
      }

      const updatedList = await storageService.settleBatchTrips({
        tripIds: selectedTripIds,
        depositDate: batchDepositDate,
        depositTotal: parsedBatchDepositTotal,
        tripsAmounts: tripsAmountsMap,
        user,
      })

      const myUpdated = updatedList.find((t) => t.id === currentTrip.id) || updatedList[0]

      toast({
        title: 'Quitação conjunta realizada com sucesso! 🎉',
        description: `${updatedList.length} viagens foram quitadas simultaneamente com depósito total de ${formatCurrencyBRL(parsedBatchDepositTotal)}.`,
      })

      if (myUpdated) {
        onSuccess(myUpdated)
      }
      onOpenChange(false)
    } catch (err: any) {
      console.error('Erro na quitação conjunta:', err)
      toast({
        title: 'Erro ao registrar quitação conjunta',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                Quitação de Viagem (Reembolso Efetuado)
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Registre os dados oficiais do depósito bancário efetuado ao colaborador.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Resumo da viagem atual */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 text-sm">{currentTrip.destination}</span>
            <span className="font-black text-emerald-600 text-base tabular-nums">
              {formatCurrencyBRL(currentTrip.total_amount)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-slate-500 text-[11px] flex-wrap">
            <span>Período: {formatDateRangeBR(currentTrip.start_date, currentTrip.end_date)}</span>
            <span>•</span>
            <span>
              Colaborador:{' '}
              <strong className="text-slate-700">
                {currentTrip.user_profile?.full_name || 'Solicitante'}
              </strong>
            </span>
          </div>
          {currentTrip.report_sent_at && (
            <div className="flex items-center gap-1.5 text-[11px] text-blue-700 pt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>
                Relatório enviado por e-mail para{' '}
                <strong>{currentTrip.report_sent_to || 'destinatário'}</strong> em{' '}
                {new Date(currentTrip.report_sent_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
          )}
        </div>

        {/* Pergunta Central: Depósito Único ou Conjunto? */}
        <div className="space-y-3 pt-2">
          <div className="p-3.5 rounded-xl border-2 border-blue-200 bg-blue-50/40 space-y-2">
            <Label className="text-xs font-bold text-slate-900 block">
              Foi reembolsado mais de uma viagem na mesma data?
            </Label>
            <RadioGroup
              value={isMultipleTrips ? 'sim' : 'nao'}
              onValueChange={(val) => setIsMultipleTrips(val === 'sim')}
              className="flex items-center gap-6 pt-1"
            >
              <div className="flex items-center space-x-2 cursor-pointer">
                <RadioGroupItem value="nao" id="settle-nao" />
                <Label
                  htmlFor="settle-nao"
                  className="text-xs font-medium text-slate-800 cursor-pointer"
                >
                  <strong>Não</strong> (Depósito único apenas para esta viagem)
                </Label>
              </div>
              <div className="flex items-center space-x-2 cursor-pointer">
                <RadioGroupItem value="sim" id="settle-sim" />
                <Label
                  htmlFor="settle-sim"
                  className="text-xs font-medium text-slate-800 cursor-pointer"
                >
                  <strong>Sim</strong> (Depósito conjunto somando várias viagens)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* ========================================================= */}
          {/* CASO NÃO: Depósito Único */}
          {/* ========================================================= */}
          {!isMultipleTrips ? (
            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    Data do Depósito *
                  </Label>
                  <Input
                    type="date"
                    value={singleDepositDate}
                    onChange={(e) => setSingleDepositDate(e.target.value)}
                    className="text-xs h-9"
                  />
                  <span className="text-[10px] text-slate-400">
                    Data em que o comprovante bancário foi liquidado.
                  </span>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    Valor Depositado (R$) *
                  </Label>
                  <Input
                    type="text"
                    value={singleDepositAmount}
                    onChange={(e) => setSingleDepositAmount(e.target.value)}
                    placeholder="0,00"
                    className="text-xs font-bold text-emerald-700 h-9"
                  />
                  <span className="text-[10px] text-slate-400">
                    Valor total da viagem:{' '}
                    <strong>{formatCurrencyBRL(currentTrip.total_amount)}</strong>
                  </span>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-900 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  Ao confirmar a quitação, a viagem passará definitivamente para o status{' '}
                  <strong>Reembolsada</strong>. Por regras de governança e imutabilidade
                  corporativa, não será possível alterar ou excluir despesas após essa confirmação.
                </p>
              </div>

              {/* Alerta de Gatekeeping se houver comprovantes pendentes */}
              {currentTripHasPending && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Quitação Bloqueada</span>
                    <p className="mt-0.5">
                      Complete a conferência de todos os recibos pendentes na Triagem para liberar o
                      envio.
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter className="pt-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <div
                  title={
                    currentTripHasPending
                      ? 'Complete a conferência de todos os recibos pendentes na Triagem para liberar o envio.'
                      : undefined
                  }
                >
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleConfirmSingleSettlement}
                    disabled={
                      submitting ||
                      !singleDepositDate ||
                      !singleDepositAmount ||
                      currentTripHasPending
                    }
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Gravando Quitação...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Confirmar Quitação Única</span>
                      </>
                    )}
                  </Button>
                </div>
              </DialogFooter>
            </div>
          ) : (
            /* ========================================================= */
            /* CASO SIM: Depósito Conjunto */
            /* ========================================================= */
            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    Data do Depósito Total *
                  </Label>
                  <Input
                    type="date"
                    value={batchDepositDate}
                    onChange={(e) => setBatchDepositDate(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    Valor Total do Depósito Bancário (R$) *
                  </Label>
                  <Input
                    type="text"
                    value={batchDepositTotalStr}
                    onChange={(e) => setBatchDepositTotalStr(e.target.value)}
                    placeholder="Ex: 2.802,73"
                    className="text-xs font-bold text-emerald-700 h-9"
                  />
                  <span className="text-[10px] text-slate-400">
                    Insira o valor exato que consta no comprovante bancário conjunto.
                  </span>
                </div>
              </div>

              {/* Seletor de Viagens */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    Selecione as viagens que somam este depósito ({selectedTripIds.length}{' '}
                    selecionadas)
                  </Label>
                  <span className="text-[11px] text-slate-500">
                    Viagens elegíveis: <strong>auditada</strong> ou <strong>fechada</strong>
                  </span>
                </div>

                {loadingEligibleTrips ? (
                  <div className="p-6 text-center text-xs text-slate-500 border rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1 text-blue-600" />
                    Carregando viagens...
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto divide-y divide-slate-100 bg-white">
                    {allEligibleTrips.map((t) => {
                      const isCurrent = t.id === currentTrip.id
                      const isSelected = selectedTripIds.includes(t.id)
                      const effectiveStatus = getEffectiveTripStatus(t)
                      const tripHasPending =
                        Boolean((t as any)._hasPendingExpenses) ||
                        (isCurrent && currentTripHasPending)
                      const isAuditadaOuFechada =
                        (effectiveStatus === 'auditada' || effectiveStatus === 'fechada') &&
                        !tripHasPending
                      // Viagens em triagem, com pendências ou com recibos não conferidos não podem ser quitadas
                      const isAllowed = isAuditadaOuFechada
                      const statusConf = TRIP_STATUS_CONFIG[effectiveStatus]

                      return (
                        <div
                          key={t.id}
                          onClick={() => handleToggleTripSelection(t.id, isAllowed)}
                          className={`p-3 flex items-center justify-between gap-3 text-xs transition-colors ${
                            !isAllowed
                              ? 'bg-slate-50 opacity-60 cursor-not-allowed'
                              : isSelected
                                ? 'bg-blue-50/60 hover:bg-blue-50 cursor-pointer'
                                : 'hover:bg-slate-50 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Checkbox
                              checked={isSelected}
                              disabled={!isAllowed || isCurrent}
                              onCheckedChange={() => handleToggleTripSelection(t.id, isAllowed)}
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900">{t.destination}</span>
                                {isCurrent && (
                                  <Badge className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0 font-semibold border-none">
                                    Viagem Atual
                                  </Badge>
                                )}
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.2 rounded-full text-[10px] font-semibold border ${statusConf.badgeClass}`}
                                >
                                  {statusConf.label}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {formatDateRangeBR(t.start_date, t.end_date)} •{' '}
                                {t.user_profile?.full_name || 'Solicitante'}
                              </p>
                              {!isAllowed && (
                                <p className="text-[10px] text-rose-700 font-medium">
                                  ⚠️{' '}
                                  {tripHasPending
                                    ? 'Complete a conferência de todos os recibos pendentes na Triagem para liberar o envio.'
                                    : `Status (${statusConf.label}) não elegível para quitação. Conclua a auditoria antes.`}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-bold text-slate-900 tabular-nums">
                              {formatCurrencyBRL(t.total_amount)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Box de Validação de Soma em Tempo Real */}
              <div
                className={`p-4 rounded-xl border-2 transition-all ${
                  isSumMatching
                    ? 'border-emerald-300 bg-emerald-50/50'
                    : parsedBatchDepositTotal > 0
                      ? 'border-rose-300 bg-rose-50/40'
                      : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2.5 mb-2.5 border-slate-200/70">
                  <div>
                    <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500 block">
                      Soma das Viagens Selecionadas ({selectedTripIds.length})
                    </span>
                    <span className="text-lg font-black text-slate-900 tabular-nums">
                      {formatCurrencyBRL(selectedTripsSum)}
                    </span>
                  </div>

                  <div className="text-left sm:text-right">
                    <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500 block">
                      Valor do Depósito Informado
                    </span>
                    <span className="text-lg font-black text-emerald-700 tabular-nums">
                      {formatCurrencyBRL(parsedBatchDepositTotal)}
                    </span>
                  </div>
                </div>

                {/* Status da validação */}
                {parsedBatchDepositTotal <= 0 ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Info className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>
                      Digite o valor total do depósito bancário para conferir a correspondência com
                      a soma das viagens.
                    </span>
                  </div>
                ) : isSumMatching ? (
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Valores conferem perfeitamente! Depósito de{' '}
                      {formatCurrencyBRL(parsedBatchDepositTotal)} cobre as {selectedTripIds.length}{' '}
                      viagens selecionadas.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>
                        Divergência de valores detectada ({depositDiff > 0 ? 'Sobra' : 'Falta'} de{' '}
                        {formatCurrencyBRL(Math.abs(depositDiff))})
                      </span>
                    </div>
                    <p className="text-[11px] text-rose-700 leading-relaxed pl-6">
                      A soma das viagens selecionadas ({formatCurrencyBRL(selectedTripsSum)}) é{' '}
                      {depositDiff > 0 ? 'menor' : 'maior'} que o total depositado (
                      {formatCurrencyBRL(parsedBatchDepositTotal)}). Selecione as viagens corretas
                      ou corrija o valor informado.
                    </p>
                  </div>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-900 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  Todas as <strong>{selectedTripIds.length} viagens selecionadas</strong> serão
                  marcadas conjuntamente como <strong>Reembolsadas</strong> na mesma data de
                  depósito ({formatDateBR(batchDepositDate)}), com identificador comum de lote para
                  rastreabilidade contábil.
                </p>
              </div>

              {/* Alerta de Gatekeeping se a viagem atual tiver pendências */}
              {currentTripHasPending && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Quitação Bloqueada</span>
                    <p className="mt-0.5">
                      Complete a conferência de todos os recibos pendentes na Triagem para liberar o
                      envio.
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter className="pt-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <div
                  title={
                    currentTripHasPending
                      ? 'Complete a conferência de todos os recibos pendentes na Triagem para liberar o envio.'
                      : undefined
                  }
                >
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleConfirmBatchSettlement}
                    disabled={
                      submitting ||
                      !batchDepositDate ||
                      parsedBatchDepositTotal <= 0 ||
                      !isSumMatching ||
                      selectedTripIds.length <= 1 ||
                      currentTripHasPending
                    }
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Quitando Viagens...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Confirmar Quitação Conjunta ({selectedTripIds.length} viagens)</span>
                      </>
                    )}
                  </Button>
                </div>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
