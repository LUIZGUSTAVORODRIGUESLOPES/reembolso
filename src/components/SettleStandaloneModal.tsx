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
  ShieldCheck,
  Info,
} from 'lucide-react'
import { StandaloneRequest } from '@/types/database'
import { standaloneRequestService } from '@/services/standaloneRequestService'
import { formatCurrencyBRL, formatDateBR } from '@/lib/formatters'
import { useToast } from '@/hooks/use-toast'

interface SettleStandaloneModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRequest: StandaloneRequest
  onSuccess: (updated: StandaloneRequest) => void
  user?: { id: string; name: string } | null
}

export function SettleStandaloneModal({
  open,
  onOpenChange,
  currentRequest,
  onSuccess,
  user,
}: SettleStandaloneModalProps) {
  const { toast } = useToast()

  // Pergunta central: "Foi reembolsado mais de uma solicitação na mesma data?"
  const [isMultipleRequests, setIsMultipleRequests] = useState<boolean>(false)

  // Quitação individual (Não)
  const [singleDepositDate, setSingleDepositDate] = useState<string>(
    new Date().toISOString().split('T')[0],
  )
  const [singleDepositAmount, setSingleDepositAmount] = useState<string>(
    currentRequest.amount ? String(currentRequest.amount) : '0',
  )

  // Quitação conjunta (Sim)
  const [batchDepositDate, setBatchDepositDate] = useState<string>(
    new Date().toISOString().split('T')[0],
  )
  const [batchDepositTotalStr, setBatchDepositTotalStr] = useState<string>('')
  const [allEligibleRequests, setAllEligibleRequests] = useState<StandaloneRequest[]>([])
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([currentRequest.id])
  const [loadingEligible, setLoadingEligible] = useState<boolean>(false)

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setIsMultipleRequests(false)
      const todayStr = new Date().toISOString().split('T')[0]
      setSingleDepositDate(todayStr)
      setSingleDepositAmount(String(currentRequest.amount || 0))
      setBatchDepositDate(todayStr)
      setBatchDepositTotalStr('')
      setSelectedRequestIds([currentRequest.id])
      loadEligibleRequests()
    }
  }, [open, currentRequest.id, currentRequest.amount])

  const loadEligibleRequests = async () => {
    setLoadingEligible(true)
    try {
      const all = await standaloneRequestService.listRequests()
      // Elegíveis para quitação: empacotadas (já enviadas por e-mail)
      const notSettled = all.filter((r) => r.status !== 'quitada')
      if (!notSettled.some((r) => r.id === currentRequest.id)) {
        notSettled.unshift(currentRequest)
      }
      setAllEligibleRequests(notSettled)
    } catch (err) {
      console.error('Erro ao carregar solicitações elegíveis:', err)
      toast({
        title: 'Erro ao carregar solicitações',
        description: 'Não foi possível buscar as solicitações para quitação.',
        variant: 'destructive',
      })
    } finally {
      setLoadingEligible(false)
    }
  }

  const handleToggleRequest = (id: string, isAllowed: boolean) => {
    if (!isAllowed) return
    if (id === currentRequest.id) return // A atual é obrigatória
    setSelectedRequestIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  // Soma em tempo real das selecionadas
  const selectedSum = useMemo(() => {
    return allEligibleRequests
      .filter((r) => selectedRequestIds.includes(r.id))
      .reduce((sum, r) => sum + (r.amount || 0), 0)
  }, [allEligibleRequests, selectedRequestIds])

  const parsedBatchDepositTotal = useMemo(() => {
    const cleaned = batchDepositTotalStr.replace(/\./g, '').replace(',', '.')
    const val = parseFloat(cleaned)
    return isNaN(val) ? 0 : val
  }, [batchDepositTotalStr])

  const depositDiff = useMemo(() => {
    if (!parsedBatchDepositTotal) return 0
    return Number((parsedBatchDepositTotal - selectedSum).toFixed(2))
  }, [parsedBatchDepositTotal, selectedSum])

  const isSumMatching = useMemo(() => {
    if (!parsedBatchDepositTotal) return false
    return Math.abs(depositDiff) < 0.01
  }, [parsedBatchDepositTotal, depositDiff])

  // Submissão individual (NÃO)
  const handleConfirmSingle = async () => {
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
      const updated = await standaloneRequestService.settleSingleRequest({
        requestId: currentRequest.id,
        depositDate: singleDepositDate,
        depositAmount: parsedAmount,
        user,
      })

      if (updated) {
        toast({
          title: 'Solicitação quitada com sucesso! 💰',
          description: `A solicitação "${updated.description}" foi marcada como Quitada no valor de ${formatCurrencyBRL(parsedAmount)}.`,
        })
        onSuccess(updated)
        onOpenChange(false)
      }
    } catch (err: any) {
      console.error('Erro ao quitar solicitação:', err)
      toast({
        title: 'Erro ao quitar solicitação',
        description: err?.message || 'Ocorreu um erro ao processar a quitação.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Submissão conjunta (SIM)
  const handleConfirmBatch = async () => {
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

    if (selectedRequestIds.length <= 1) {
      toast({
        title: 'Selecione mais de uma solicitação',
        description:
          'Para depósito conjunto, selecione duas ou mais solicitações que compõem o valor total. Caso seja apenas uma, selecione "Não".',
        variant: 'destructive',
      })
      return
    }

    if (!isSumMatching) {
      toast({
        title: 'A soma das solicitações não bate com o valor do depósito',
        description: `Diferença de ${formatCurrencyBRL(Math.abs(depositDiff))}. Ajuste as seleções ou o valor antes de confirmar.`,
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      const amountsMap: Record<string, number> = {}
      for (const r of allEligibleRequests) {
        if (selectedRequestIds.includes(r.id)) {
          amountsMap[r.id] = r.amount || 0
        }
      }

      const updatedList = await standaloneRequestService.settleBatchRequests({
        requestIds: selectedRequestIds,
        depositDate: batchDepositDate,
        depositTotal: parsedBatchDepositTotal,
        requestsAmounts: amountsMap,
        user,
      })

      const myUpdated = updatedList.find((r) => r.id === currentRequest.id) || updatedList[0]

      toast({
        title: 'Quitação conjunta realizada com sucesso! 🎉',
        description: `${updatedList.length} solicitações foram quitadas simultaneamente com depósito total de ${formatCurrencyBRL(parsedBatchDepositTotal)}.`,
      })

      if (myUpdated) {
        onSuccess(myUpdated)
      }
      onOpenChange(false)
    } catch (err: any) {
      console.error('Erro na quitação conjunta:', err)
      toast({
        title: 'Erro ao registrar quitação conjunta',
        description: err?.message || 'Ocorreu um erro ao processar a quitação conjunta.',
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
                Quitação de Solicitação Avulsa
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Registre os dados oficiais do depósito bancário efetuado ao colaborador.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Resumo da solicitação atual */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 text-sm">
              {currentRequest.description}
            </span>
            <span className="font-black text-emerald-600 text-base tabular-nums">
              {formatCurrencyBRL(currentRequest.amount)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-slate-500 text-[11px] flex-wrap">
            <span>
              Categoria: <strong className="text-slate-700">{currentRequest.category}</strong>
            </span>
            <span>•</span>
            <span>Data da despesa: {formatDateBR(currentRequest.expense_date)}</span>
            <span>•</span>
            <span>
              Solicitante:{' '}
              <strong className="text-slate-700">
                {currentRequest.user_profile?.full_name || 'Solicitante'}
              </strong>
            </span>
          </div>
          {currentRequest.report_sent_at && (
            <div className="flex items-center gap-1.5 text-[11px] text-blue-700 pt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>
                Relatório enviado por e-mail para{' '}
                <strong>{currentRequest.report_sent_to || 'destinatário'}</strong> em{' '}
                {new Date(currentRequest.report_sent_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
          )}
        </div>

        {/* Pergunta Central: Depósito Único ou Conjunto? */}
        <div className="space-y-3 pt-2">
          <div className="p-3.5 rounded-xl border-2 border-blue-200 bg-blue-50/40 space-y-2">
            <Label className="text-xs font-bold text-slate-900 block">
              Foi reembolsado mais de uma solicitação na mesma data?
            </Label>
            <RadioGroup
              value={isMultipleRequests ? 'sim' : 'nao'}
              onValueChange={(val) => setIsMultipleRequests(val === 'sim')}
              className="flex items-center gap-6 pt-1"
            >
              <div className="flex items-center space-x-2 cursor-pointer">
                <RadioGroupItem value="nao" id="settle-req-nao" />
                <Label
                  htmlFor="settle-req-nao"
                  className="text-xs font-medium text-slate-800 cursor-pointer"
                >
                  <strong>Não</strong> (Depósito único apenas para esta solicitação)
                </Label>
              </div>
              <div className="flex items-center space-x-2 cursor-pointer">
                <RadioGroupItem value="sim" id="settle-req-sim" />
                <Label
                  htmlFor="settle-req-sim"
                  className="text-xs font-medium text-slate-800 cursor-pointer"
                >
                  <strong>Sim</strong> (Depósito conjunto somando várias despesas)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* CASO NÃO: Depósito Único */}
          {!isMultipleRequests ? (
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
                    Valor total transferido na conta do colaborador.
                  </span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
                <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-0.5 leading-relaxed">
                  <span className="font-semibold block">Quitação definitiva e blindada</span>
                  <span className="text-amber-800 text-[11px]">
                    Após a confirmação, esta solicitação avulsa terá status <strong>Quitada</strong>{' '}
                    e não poderá mais ter seus dados contábeis alterados ou retrocedidos.
                  </span>
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirmSingle}
                  disabled={submitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs gap-1.5"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Confirmar Quitação Individual
                </Button>
              </DialogFooter>
            </div>
          ) : (
            /* CASO SIM: Depósito Conjunto */
            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    Data do Depósito Conjunto *
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
                    placeholder="Ex: 1.250,50"
                    className="text-xs font-bold text-slate-900 h-9"
                  />
                </div>
              </div>

              {/* Lista de solicitações disponíveis para seleção */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                    Selecione as solicitações que compõem este depósito:
                  </Label>
                  <span className="text-[11px] text-slate-500">
                    {selectedRequestIds.length} selecionada(s)
                  </span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto divide-y divide-slate-100 bg-white shadow-inner">
                  {loadingEligible ? (
                    <div className="p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                      Carregando solicitações...
                    </div>
                  ) : allEligibleRequests.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      Nenhuma outra solicitação disponível.
                    </div>
                  ) : (
                    allEligibleRequests.map((req) => {
                      const isCurrent = req.id === currentRequest.id
                      const isSelected = selectedRequestIds.includes(req.id)
                      const isAllowed = req.status === 'empacotada' || isCurrent

                      return (
                        <div
                          key={req.id}
                          onClick={() => handleToggleRequest(req.id, isAllowed)}
                          className={`
                            p-3 flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer
                            ${isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'}
                            ${!isAllowed ? 'opacity-50 cursor-not-allowed bg-slate-50/60' : ''}
                          `}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Checkbox
                              checked={isSelected}
                              disabled={isCurrent || !isAllowed}
                              onCheckedChange={() => handleToggleRequest(req.id, isAllowed)}
                              className="shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-800 truncate">
                                  {req.description}
                                </span>
                                {isCurrent && (
                                  <Badge className="text-[9px] bg-blue-100 text-blue-800 border-0 h-4">
                                    Atual
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                                <span>{req.category}</span>
                                <span>•</span>
                                <span>{formatDateBR(req.expense_date)}</span>
                                <span>•</span>
                                <span>{req.user_profile?.full_name || 'Solicitante'}</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-bold text-slate-900 block tabular-nums">
                              {formatCurrencyBRL(req.amount)}
                            </span>
                            {!isAllowed && (
                              <span className="text-[10px] text-amber-600 font-medium">
                                Não enviada
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Validação em Tempo Real */}
              <div className="p-3.5 rounded-xl border bg-slate-50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">Soma das solicitações selecionadas:</span>
                  <span className="font-black text-slate-900 text-sm tabular-nums">
                    {formatCurrencyBRL(selectedSum)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">Valor total do depósito informado:</span>
                  <span className="font-black text-slate-900 text-sm tabular-nums">
                    {formatCurrencyBRL(parsedBatchDepositTotal)}
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-200">
                  {parsedBatchDepositTotal <= 0 ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Info className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>Informe o valor do depósito acima para verificar a soma.</span>
                    </div>
                  ) : isSumMatching ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Soma exata confirmada! O valor bate perfeitamente com o depósito informado.
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <div>
                        <span className="font-semibold block">Valores não conferem:</span>
                        <span className="text-[11px]">
                          {depositDiff > 0
                            ? `Faltam ${formatCurrencyBRL(depositDiff)} em solicitações para atingir o depósito informado.`
                            : `A soma das solicitações excede o depósito em ${formatCurrencyBRL(Math.abs(depositDiff))}.`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirmBatch}
                  disabled={submitting || !isSumMatching || selectedRequestIds.length <= 1}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs gap-1.5 disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Confirmar Quitação Conjunta ({selectedRequestIds.length})
                </Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
