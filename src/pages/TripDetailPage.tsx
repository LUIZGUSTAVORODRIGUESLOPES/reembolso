import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  MapPin,
  Calendar,
  Plane,
  Car,
  CarFront,
  MoreHorizontal,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  FileText,
  Upload,
  Plus,
  ArrowLeft,
  FileSpreadsheet,
  Edit,
  Trash2,
  Eye,
  Check,
  X,
  FileCheck2,
  ShieldCheck,
  Tag,
  Building2,
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { Trip, Expense, AuditEvaluationRule, ExpenseCategory, TripStatus } from '@/types/database'
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateRangeBR,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  TRIP_STATUS_CONFIG,
  TRANSPORT_LABELS,
} from '@/lib/formatters'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [auditRules, setAuditRules] = useState<AuditEvaluationRule[]>([])
  const [loading, setLoading] = useState(true)

  // Justification Modal
  const [justifyingRule, setJustifyingRule] = useState<AuditEvaluationRule | null>(null)
  const [justificationText, setJustificationText] = useState('')
  const [savingJustification, setSavingJustification] = useState(false)

  // Single Expense Manual Add Modal
  const [addExpenseOpen, setAddExpenseOpen] = useState(false)
  const [newExpMerchant, setNewExpMerchant] = useState('')
  const [newExpAmount, setNewExpAmount] = useState('')
  const [newExpDate, setNewExpDate] = useState('')
  const [newExpCategory, setNewExpCategory] = useState<ExpenseCategory>('alimentacao')

  // Expense Preview Modal
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null)

  // Edit Trip Modal
  const [editTripOpen, setEditTripOpen] = useState(false)
  const [editDestination, setEditDestination] = useState('')
  const [editMotivo, setEditMotivo] = useState('')
  const [editStatus, setEditStatus] = useState<TripStatus>('em_triagem')

  const loadTripData = async () => {
    if (!id) return
    setLoading(true)
    try {
      const t = await storageService.getTrip(id)
      if (!t) {
        toast({
          title: 'Viagem não encontrada',
          description: 'O identificador solicitado não existe.',
          variant: 'destructive',
        })
        navigate('/')
        return
      }

      const expList = await storageService.listExpenses(id)
      const rules = await storageService.evaluateTripAudit(id)

      setTrip(t)
      setExpenses(expList)
      setAuditRules(rules)

      // Pre-fill edit modal
      setEditDestination(t.destination)
      setEditMotivo(t.motivo)
      setEditStatus(t.status)
      setNewExpDate(t.start_date)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTripData()
  }, [id])

  const handleOpenJustify = (rule: AuditEvaluationRule) => {
    setJustifyingRule(rule)
    setJustificationText(rule.justification || '')
  }

  const handleSaveJustification = async () => {
    if (!justifyingRule || !trip) return
    if (!justificationText.trim()) {
      toast({
        title: 'Justificativa obrigatória',
        description: 'Por favor, detalhe a justificativa para arquivamento no log de compliance.',
        variant: 'destructive',
      })
      return
    }

    setSavingJustification(true)
    try {
      await storageService.saveAuditLog({
        trip_id: trip.id,
        rule_key: justifyingRule.key,
        status: 'justified',
        message: justificationText.trim(),
      })

      toast({
        title: 'Justificativa gravada!',
        description: 'A pendência foi justificada e registrada no log oficial de auditoria.',
      })

      setJustifyingRule(null)
      loadTripData()
    } catch {
      toast({
        title: 'Erro ao salvar justificativa',
        variant: 'destructive',
      })
    } finally {
      setSavingJustification(false)
    }
  }

  const handleIgnoreRule = async (rule: AuditEvaluationRule) => {
    if (!trip) return
    await storageService.saveAuditLog({
      trip_id: trip.id,
      rule_key: rule.key,
      status: 'justified',
      message: 'Ignorado pelo auditor responsável.',
    })
    toast({
      title: 'Alerta ignorado',
      description: 'O item não bloqueará a aprovação da viagem.',
    })
    loadTripData()
  }

  const handleManualAddExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!trip) return

    const parsed = parseFloat(newExpAmount.replace(',', '.'))
    if (isNaN(parsed) || parsed <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'Informe um valor maior que zero.',
        variant: 'destructive',
      })
      return
    }

    try {
      await storageService.createExpense({
        trip_id: trip.id,
        file_name: `recibo_manual_${Date.now()}.png`,
        file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
        issue_date: newExpDate || trip.start_date,
        category: newExpCategory,
        merchant_name: newExpMerchant || 'Comprovante Manual',
        amount: parsed,
        is_verified: true,
        audit_flags: [],
        audit_status: 'conforme',
      })

      toast({
        title: 'Comprovante adicionado!',
        description: 'A despesa foi anexada à viagem e o total recalculado.',
      })

      setAddExpenseOpen(false)
      setNewExpMerchant('')
      setNewExpAmount('')
      loadTripData()
    } catch {
      toast({
        title: 'Erro ao adicionar comprovante',
        variant: 'destructive',
      })
    }
  }

  const handleDeleteExpense = async (expId: string) => {
    try {
      await storageService.deleteExpense(expId)
      toast({
        title: 'Comprovante excluído',
        description: 'O item foi removido com sucesso.',
      })
      loadTripData()
    } catch {
      toast({
        title: 'Erro ao excluir comprovante',
        variant: 'destructive',
      })
    }
  }

  const handleSaveTripEdits = async () => {
    if (!trip) return
    try {
      await storageService.updateTrip(trip.id, {
        destination: editDestination.trim(),
        motivo: editMotivo.trim(),
        status: editStatus,
      })
      toast({
        title: 'Viagem atualizada',
        description: 'Os dados cadastrais foram salvos com sucesso.',
      })
      setEditTripOpen(false)
      loadTripData()
    } catch {
      toast({
        title: 'Erro ao atualizar viagem',
        variant: 'destructive',
      })
    }
  }

  if (loading || !trip) {
    return (
      <div className="p-12 text-center text-slate-500">
        Carregando detalhes da viagem e executando motor de auditoria...
      </div>
    )
  }

  // Audit calculations
  const totalRules = auditRules.length
  const passedRules = auditRules.filter(
    (r) => r.status === 'pass' || r.status === 'justified',
  ).length
  const auditPercent = totalRules > 0 ? Math.round((passedRules / totalRules) * 100) : 100
  const statusConf = TRIP_STATUS_CONFIG[trip.status]

  return (
    <div className="space-y-6">
      {/* Back button & quick navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="text-xs text-slate-600 hover:text-slate-900 gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao Dashboard</span>
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditTripOpen(true)}
            className="text-xs gap-1.5"
          >
            <Edit className="w-3.5 h-3.5" />
            <span>Editar Viagem</span>
          </Button>

          <Button
            size="sm"
            onClick={() => navigate('/reports')}
            className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 shadow-sm font-semibold"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Exportar Relatório</span>
          </Button>
        </div>
      </div>

      {/* Header Section: Trip Overview Card */}
      <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusConf.badgeClass}`}
              >
                {statusConf.label}
              </span>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium">
                {trip.transport_type === 'aéreo' && <Plane className="w-3 h-3 text-blue-600" />}
                {trip.transport_type === 'carro_proprio' && (
                  <Car className="w-3 h-3 text-amber-600" />
                )}
                {trip.transport_type === 'carro_alugado' && (
                  <CarFront className="w-3 h-3 text-emerald-600" />
                )}
                {trip.transport_type === 'outros' && (
                  <MoreHorizontal className="w-3 h-3 text-slate-600" />
                )}
                <span>{TRANSPORT_LABELS[trip.transport_type]}</span>
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <MapPin className="w-6 h-6 text-blue-600 shrink-0" />
              <span>{trip.destination}</span>
            </h2>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Período: <strong>{formatDateRangeBR(trip.start_date, trip.end_date)}</strong>
              </span>
              <span>•</span>
              <span>
                Atribuído ao mês de: <strong>{formatDateBR(trip.start_date).slice(3)}</strong>{' '}
                (Regra da Virada)
              </span>
            </div>

            <p className="text-xs text-slate-600 max-w-2xl pt-1">
              <strong>Motivo Corporativo:</strong> {trip.motivo}
            </p>
            {trip.notes && <p className="text-[11px] text-slate-400 italic">Obs: {trip.notes}</p>}
          </div>

          {/* Big Emerald Total */}
          <div className="lg:text-right bg-slate-50 lg:bg-transparent p-4 lg:p-0 rounded-xl border lg:border-none border-slate-200">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
              Total Acumulado da Prestação
            </span>
            <div className="text-3xl sm:text-4xl font-black text-[#10b981] tabular-nums mt-0.5">
              {formatCurrencyBRL(trip.total_amount)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {expenses.length} comprovante(s) vinculado(s)
            </p>
          </div>
        </div>
      </Card>

      {/* Audit Alerts Panel (Most visually prominent) */}
      <Card className="border-2 border-blue-200 bg-gradient-to-br from-white via-blue-50/20 to-indigo-50/30 shadow-md">
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-blue-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Motor de Auditoria Inteligente & Compliance
                </h3>
                <p className="text-xs text-slate-500">
                  Validação automática de inconsistências, comprovantes faltantes e duplicatas
                </p>
              </div>
            </div>

            {/* Compliance Progress Indicator */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="text-xs font-bold text-slate-800">
                  {passedRules} de {totalRules} regras auditadas
                </span>
                <span className="text-[11px] text-slate-500 block">
                  {auditPercent === 100 ? '100% Conforme' : 'Pendências ativas'}
                </span>
              </div>
              <div className="w-24">
                <Progress value={auditPercent} className="h-2" />
              </div>
            </div>
          </div>

          {/* List of Rules */}
          <div className="space-y-3 pt-1">
            {auditRules.map((rule) => {
              const isWarning = rule.status === 'warning'
              const isJustified = rule.status === 'justified'
              const isPass = rule.status === 'pass'

              return (
                <div
                  key={rule.key}
                  className={`p-4 rounded-xl border transition-all ${
                    isWarning
                      ? 'border-amber-300 bg-amber-50/40 shadow-2xs'
                      : isJustified
                        ? 'border-slate-200 bg-slate-50/70 opacity-80'
                        : 'border-emerald-200 bg-emerald-50/30'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {isWarning && (
                        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
                          <AlertTriangle className="w-4 h-4" />
                        </div>
                      )}
                      {isJustified && (
                        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      )}
                      {isPass && (
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                          <Check className="w-4 h-4" />
                        </div>
                      )}

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">{rule.title}</h4>
                          {isJustified && (
                            <Badge className="bg-slate-200 text-slate-700 text-[10px] font-semibold">
                              Justificado
                            </Badge>
                          )}
                          {isPass && (
                            <Badge className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                              Conforme
                            </Badge>
                          )}
                          {isWarning && (
                            <Badge className="bg-amber-100 text-amber-800 text-[10px] font-semibold">
                              Ação Requerida
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed">{rule.message}</p>

                        {/* Justification note if present */}
                        {rule.justification && (
                          <div className="pt-1.5 text-xs text-slate-500 italic bg-white/70 p-2 rounded border border-slate-200">
                            <strong>Justificativa do Auditor:</strong> "{rule.justification}"
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action buttons for warning */}
                    {isWarning && (
                      <div className="flex items-center gap-2 shrink-0 sm:self-center">
                        <Button
                          size="sm"
                          onClick={() => setAddExpenseOpen(true)}
                          className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs h-8 px-2.5"
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Adicionar Comprovante
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenJustify(rule)}
                          className="text-xs h-8 px-2.5 border-amber-300 text-amber-900 bg-white hover:bg-amber-50"
                        >
                          Justificar
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleIgnoreRule(rule)}
                          className="text-xs h-8 px-2 text-slate-400 hover:text-slate-600"
                        >
                          Ignorar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Expenses Table Card */}
      <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-base">
              Comprovantes & Despesas da Viagem
            </h3>
            <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
              {expenses.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/upload')}
              className="text-xs gap-1.5 text-slate-700"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload em Lote
            </Button>

            <Button
              size="sm"
              onClick={() => setAddExpenseOpen(true)}
              className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar Comprovante Manualmente
            </Button>
          </div>
        </div>

        {expenses.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="font-semibold text-slate-700 text-sm">Nenhum comprovante anexado</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
              Faça o upload dos recibos para iniciar a auditoria automatizada desta viagem.
            </p>
            <Button
              size="sm"
              onClick={() => navigate('/upload')}
              className="bg-[#1e40af] text-white text-xs"
            >
              <Upload className="w-3.5 h-3.5 mr-1" />
              Enviar Comprovantes
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-[11px] font-semibold text-slate-500 tracking-wider">
                <tr>
                  <th className="py-3 px-4">Data Emissão</th>
                  <th className="py-3 px-4">Categoria</th>
                  <th className="py-3 px-4">Estabelecimento / Razão Social</th>
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-center">Status Auditoria</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((exp) => {
                  const catColor = CATEGORY_COLORS[exp.category]
                  const isDupe = exp.audit_flags?.includes('comprovante_duplicado')

                  return (
                    <tr
                      key={exp.id}
                      className="hover:bg-slate-50 transition-colors cursor-pointer group"
                      onClick={() => setViewingExpense(exp)}
                    >
                      <td className="py-3.5 px-4 font-medium text-slate-800">
                        {formatDateBR(exp.issue_date)}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${catColor.bg} ${catColor.text} ${catColor.border}`}
                        >
                          {CATEGORY_LABELS[exp.category]}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{exp.merchant_name}</span>
                          {isDupe && (
                            <span className="text-[10px] bg-rose-100 text-rose-700 font-semibold px-1.5 py-0.5 rounded border border-rose-200">
                              Duplicata
                            </span>
                          )}
                        </div>
                        {exp.cnpj && (
                          <span className="text-[11px] text-slate-400 block">{exp.cnpj}</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right font-black text-[#10b981] text-sm tabular-nums">
                        {formatCurrencyBRL(exp.amount)}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        {exp.audit_status === 'conforme' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Conforme
                          </span>
                        )}
                        {exp.audit_status === 'justificado' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            Justificado
                          </span>
                        )}
                        {exp.audit_status === 'pendente' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            Pendente
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewingExpense(exp)}
                            className="h-7 w-7 p-0 text-slate-500 hover:text-blue-600"
                            title="Visualizar Comprovante"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                            title="Excluir Comprovante"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Justification Dialog */}
      <Dialog open={!!justifyingRule} onOpenChange={(open) => !open && setJustifyingRule(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              Justificar Alerta de Compliance
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {justifyingRule?.title}: {justifyingRule?.message}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <Label htmlFor="justification" className="text-xs font-semibold text-slate-700">
              Texto da Justificativa para Auditoria Contábil *
            </Label>
            <Textarea
              id="justification"
              rows={3}
              placeholder="Ex: Hospedagem fornecida pela empresa parceira do evento; ou transporte terrestre realizado em veículo particular com KM faturado separadamente."
              value={justificationText}
              onChange={(e) => setJustificationText(e.target.value)}
              className="text-xs resize-none"
            />
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setJustifyingRule(null)}
              disabled={savingJustification}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSaveJustification}
              disabled={savingJustification}
              className="bg-[#1e40af] text-white text-xs"
            >
              {savingJustification ? 'Salvando...' : 'Gravar Justificativa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Single Expense Modal */}
      <Dialog open={addExpenseOpen} onOpenChange={setAddExpenseOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-600" />
              Adicionar Comprovante Manualmente
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Cadastre um recibo avulso diretamente para esta viagem.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleManualAddExpense} className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Estabelecimento *</Label>
              <Input
                value={newExpMerchant}
                onChange={(e) => setNewExpMerchant(e.target.value)}
                placeholder="Ex: Localiza Aluguel de Carros, Uber, Restaurante..."
                required
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Data de Emissão *</Label>
                <Input
                  type="date"
                  value={newExpDate}
                  onChange={(e) => setNewExpDate(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Valor (R$) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newExpAmount}
                  onChange={(e) => setNewExpAmount(e.target.value)}
                  placeholder="0,00"
                  required
                  className="text-xs tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Categoria *</Label>
              <Select
                value={newExpCategory}
                onValueChange={(val) => setNewExpCategory(val as ExpenseCategory)}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-3 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddExpenseOpen(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="bg-[#1e40af] text-white text-xs">
                Adicionar Despesa
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Trip Details Modal */}
      <Dialog open={editTripOpen} onOpenChange={setEditTripOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Editar Dados da Viagem
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Destino</Label>
              <Input
                value={editDestination}
                onChange={(e) => setEditDestination(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Status do Processo</Label>
              <Select value={editStatus} onValueChange={(val) => setEditStatus(val as TripStatus)}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Selecione o status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="em_triagem">Em Triagem</SelectItem>
                  <SelectItem value="com_pendencias">Com Pendências</SelectItem>
                  <SelectItem value="auditada">Auditada</SelectItem>
                  <SelectItem value="fechada">Fechada</SelectItem>
                  <SelectItem value="reembolsada">Reembolsada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Motivo</Label>
              <Textarea
                rows={2}
                value={editMotivo}
                onChange={(e) => setEditMotivo(e.target.value)}
                className="text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditTripOpen(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSaveTripEdits}
              className="bg-[#1e40af] text-white text-xs"
            >
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Expense Modal */}
      <Dialog open={!!viewingExpense} onOpenChange={(open) => !open && setViewingExpense(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center justify-between">
              <span>{viewingExpense?.merchant_name}</span>
              <span className="text-emerald-600 font-extrabold tabular-nums">
                {viewingExpense && formatCurrencyBRL(viewingExpense.amount)}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Arquivo: {viewingExpense?.file_name} • Data:{' '}
              {viewingExpense && formatDateBR(viewingExpense.issue_date)}
            </DialogDescription>
          </DialogHeader>

          <div className="bg-slate-100 p-3 rounded-lg flex items-center justify-center max-h-[360px] overflow-auto">
            {viewingExpense && (
              <img
                src={viewingExpense.file_url}
                alt={viewingExpense.merchant_name}
                className="max-h-[320px] w-auto object-contain rounded shadow"
              />
            )}
          </div>

          {viewingExpense?.ocr_raw_text && (
            <div className="text-[11px] font-mono bg-slate-50 p-2.5 rounded border border-slate-200 text-slate-600">
              <strong>Extração OCR:</strong> {viewingExpense.ocr_raw_text}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewingExpense(null)}
              className="text-xs"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
