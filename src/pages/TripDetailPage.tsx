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
  Lock,
  UploadCloud,
  FileImage,
  Loader2,
} from 'lucide-react'
import { DocumentViewer } from '@/components/DocumentViewer'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  const [selectedReceiptFile, setSelectedReceiptFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isUploadingExpense, setIsUploadingExpense] = useState(false)
  const [isDragOverReceipt, setIsDragOverReceipt] = useState(false)
  const fileInputManualRef = React.useRef<HTMLInputElement | null>(null)

  const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
  ]
  const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024 // 15MB

  const handleSelectFile = (file: File | null | undefined) => {
    setFileError(null)
    if (!file) return

    const ext = file.name.toLowerCase().split('.').pop()
    const isValidExt = ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext || '')
    const isValidMime = ALLOWED_MIME_TYPES.includes(file.type) || isValidExt

    if (!isValidMime) {
      setFileError('Tipo de arquivo não suportado. Envie comprovantes em PDF, JPG, PNG ou WEBP.')
      toast({
        title: 'Formato não suportado',
        description: 'Por favor, selecione um arquivo PDF ou imagem (JPG/PNG).',
        variant: 'destructive',
      })
      return
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError('Arquivo muito grande. O limite máximo permitido é de 15 MB.')
      toast({
        title: 'Tamanho excedido',
        description: 'O arquivo selecionado ultrapassa o limite de 15 MB.',
        variant: 'destructive',
      })
      return
    }

    setSelectedReceiptFile(file)
  }

  // Expense Preview Modal
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null)

  // Edit Trip Modal
  const [editTripOpen, setEditTripOpen] = useState(false)
  const [editDestination, setEditDestination] = useState('')
  const [editMotivo, setEditMotivo] = useState('')
  const [editStatus, setEditStatus] = useState<TripStatus>('em_triagem')

  // Deletion modals state
  const [deleteTripDialogOpen, setDeleteTripDialogOpen] = useState(false)
  const [isDeletingTrip, setIsDeletingTrip] = useState(false)

  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null)
  const [isDeletingExpense, setIsDeletingExpense] = useState(false)

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
    if (isTripLocked) {
      toast({
        title: 'Ação não permitida',
        description: 'Viagem fechada ou reembolsada não permite alteração de auditoria.',
        variant: 'destructive',
      })
      return
    }
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
    if (isTripLocked) {
      toast({
        title: 'Ação não permitida',
        description: 'Viagem fechada ou reembolsada não permite alteração de auditoria.',
        variant: 'destructive',
      })
      return
    }
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

    if (isTripLocked) {
      toast({
        title: 'Viagem fechada',
        description: 'Não é permitido adicionar comprovantes a uma viagem fechada ou reembolsada.',
        variant: 'destructive',
      })
      return
    }

    const parsed = parseFloat(newExpAmount.replace(',', '.'))
    if (isNaN(parsed) || parsed <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'Informe um valor maior que zero.',
        variant: 'destructive',
      })
      return
    }

    setIsUploadingExpense(true)
    try {
      let uploadedFileUrl = ''
      let finalFileName = ''

      if (selectedReceiptFile) {
        finalFileName = selectedReceiptFile.name
        try {
          uploadedFileUrl = await storageService.uploadReceiptFile(selectedReceiptFile)
        } catch (uploadErr) {
          console.error('Erro ao enviar arquivo para o Supabase Storage:', uploadErr)
          toast({
            title: 'Erro no upload do comprovante',
            description:
              'Não foi possível salvar o arquivo no armazenamento em nuvem. Tente novamente.',
            variant: 'destructive',
          })
          setIsUploadingExpense(false)
          return
        }
      }

      await storageService.createExpense({
        trip_id: trip.id,
        file_name: finalFileName || `recibo_manual_${Date.now()}.png`,
        file_url: uploadedFileUrl || '',
        issue_date: newExpDate || trip.start_date,
        category: newExpCategory,
        merchant_name: newExpMerchant.trim() || 'Comprovante Manual',
        amount: parsed,
        ocr_raw_text: selectedReceiptFile
          ? `Comprovante manual anexado: ${selectedReceiptFile.name}`
          : 'Comprovante inserido manualmente sem arquivo anexo.',
        is_verified: true,
        audit_flags: [],
        audit_status: 'conforme',
      })

      toast({
        title: 'Comprovante adicionado com sucesso!',
        description: selectedReceiptFile
          ? 'O arquivo foi enviado e a despesa registrada na prestação de contas.'
          : 'A despesa foi registrada com sucesso (sem arquivo anexo).',
      })

      setAddExpenseOpen(false)
      setNewExpMerchant('')
      setNewExpAmount('')
      setSelectedReceiptFile(null)
      setFileError(null)
      loadTripData()
    } catch (saveErr) {
      console.error('Erro ao criar despesa:', saveErr)
      toast({
        title: 'Erro ao adicionar comprovante',
        description:
          'Ocorreu um erro ao gravar a despesa. Verifique sua conexão e tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsUploadingExpense(false)
    }
  }

  const confirmDeleteExpense = async () => {
    if (!expenseToDelete) return
    setIsDeletingExpense(true)
    try {
      await storageService.deleteExpense(expenseToDelete.id)
      toast({
        title: 'Comprovante excluído',
        description: `O item "${expenseToDelete.merchant_name}" e seu respectivo arquivo no armazenamento foram removidos permanentemente.`,
      })
      setExpenseToDelete(null)
      loadTripData()
    } catch (err: any) {
      toast({
        title: 'Exclusão não permitida',
        description:
          err?.message ||
          'Não foi possível excluir o comprovante. Verifique se a viagem não está fechada ou reembolsada.',
        variant: 'destructive',
      })
    } finally {
      setIsDeletingExpense(false)
    }
  }

  const confirmDeleteTrip = async () => {
    if (!trip) return
    setIsDeletingTrip(true)
    try {
      await storageService.deleteTrip(trip.id)
      toast({
        title: 'Viagem excluída com sucesso',
        description:
          'A viagem, suas despesas e todos os comprovantes anexados foram removidos permanentemente.',
      })
      setDeleteTripDialogOpen(false)
      navigate('/')
    } catch (err: any) {
      toast({
        title: 'Exclusão não permitida',
        description:
          err?.message ||
          'Não foi possível excluir a viagem. Viagens fechadas ou reembolsadas são imutáveis.',
        variant: 'destructive',
      })
    } finally {
      setIsDeletingTrip(false)
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
  const isTripLocked = storageService.isTripLockedForDeletion(trip.status)

  return (
    <div className="space-y-6">
      {/* Back button & quick navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="text-xs text-slate-600 hover:text-slate-900 gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao Dashboard</span>
        </Button>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Delete Trip Action */}
          {isTripLocked ? (
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 border border-slate-200 text-slate-500 text-xs font-medium cursor-not-allowed select-none"
              title="Viagem fechada — exclusão bloqueada permanentemente após emissão do pedido de reembolso"
            >
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Viagem fechada — exclusão bloqueada</span>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTripDialogOpen(true)}
              className="text-xs gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Excluir Viagem</span>
            </Button>
          )}

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
                        {isTripLocked ? (
                          <div
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-slate-400 text-xs font-medium cursor-not-allowed select-none"
                            title="Viagem fechada — ações de auditoria bloqueadas"
                          >
                            <Lock className="w-3 h-3 text-slate-400" />
                            <span>Viagem Fechada</span>
                          </div>
                        ) : (
                          <>
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
                          </>
                        )}
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
              disabled={isTripLocked}
              className="text-xs gap-1.5 text-slate-700 disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload em Lote
            </Button>

            <Button
              size="sm"
              onClick={() => setAddExpenseOpen(true)}
              disabled={isTripLocked}
              className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 shadow-sm disabled:opacity-50"
            >
              {isTripLocked ? <Lock className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {isTripLocked ? 'Adição Bloqueada' : 'Adicionar Comprovante Manualmente'}
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
                          {isTripLocked ? (
                            <div
                              className="h-7 w-7 flex items-center justify-center text-slate-300 cursor-not-allowed"
                              title="Viagem fechada — exclusão de despesa bloqueada"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpenseToDelete(exp)}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                              title="Excluir Comprovante e Arquivo"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
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
      <Dialog
        open={addExpenseOpen}
        onOpenChange={(open) => {
          if (!isUploadingExpense) {
            setAddExpenseOpen(open)
            if (!open) {
              setSelectedReceiptFile(null)
              setFileError(null)
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-600" />
              Adicionar Comprovante Manualmente
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Cadastre um recibo avulso diretamente para esta viagem e anexe o comprovante fiscal.
            </DialogDescription>
          </DialogHeader>

          {isTripLocked ? (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-xs flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                Esta viagem está fechada ou reembolsada. A inclusão de novas despesas está
                bloqueada.
              </span>
            </div>
          ) : (
            <form onSubmit={handleManualAddExpense} className="space-y-4 pt-1">
              {/* Receipt File Upload Dropzone */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    <span>Arquivo do Comprovante (Recibo / Nota Fiscal)</span>
                  </Label>
                  <span className="text-[11px] text-slate-400 font-normal">Opcional</span>
                </div>

                <input
                  ref={fileInputManualRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    handleSelectFile(file)
                    // Reset input so re-selecting same file triggers onChange
                    e.target.value = ''
                  }}
                />

                {!selectedReceiptFile ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault()
                      setIsDragOverReceipt(true)
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault()
                      setIsDragOverReceipt(false)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      setIsDragOverReceipt(false)
                      const file = e.dataTransfer.files?.[0]
                      handleSelectFile(file)
                    }}
                    onClick={() => fileInputManualRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-4 sm:p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                      isDragOverReceipt
                        ? 'border-[#1e40af] bg-blue-50/60 scale-[1.01]'
                        : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50/70 bg-slate-50/30'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1e40af] flex items-center justify-center mb-2">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-bold text-slate-800">
                      Clique para selecionar ou arraste o comprovante aqui
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      PDF, JPG, PNG ou WEBP (até 15 MB)
                    </p>
                    <span className="mt-2 text-[10px] bg-blue-50 text-[#1e40af] px-2 py-0.5 rounded-full font-medium border border-blue-200">
                      Upload seguro no Supabase Storage
                    </span>
                  </div>
                ) : (
                  <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-3 flex items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                        {selectedReceiptFile.name.toLowerCase().endsWith('.pdf') ? (
                          <FileText className="w-5 h-5" />
                        ) : (
                          <FileImage className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {selectedReceiptFile.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {(selectedReceiptFile.size / 1024).toFixed(1)} KB • Pronto para upload
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputManualRef.current?.click()}
                        className="h-7 text-[11px] text-[#1e40af] hover:bg-blue-100"
                      >
                        Trocar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedReceiptFile(null)
                          setFileError(null)
                        }}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                        title="Remover arquivo selecionado"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {fileError && (
                  <p className="text-[11px] text-rose-600 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{fileError}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Estabelecimento *</Label>
                <Input
                  value={newExpMerchant}
                  onChange={(e) => setNewExpMerchant(e.target.value)}
                  placeholder="Ex: Localiza Aluguel de Carros, Uber, Restaurante..."
                  required
                  className="text-xs"
                  disabled={isUploadingExpense}
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
                    disabled={isUploadingExpense}
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
                    disabled={isUploadingExpense}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Categoria *</Label>
                <Select
                  value={newExpCategory}
                  onValueChange={(val) => setNewExpCategory(val as ExpenseCategory)}
                  disabled={isUploadingExpense}
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
                  disabled={isUploadingExpense}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isUploadingExpense}
                  className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 shadow-sm"
                >
                  {isUploadingExpense ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Salvando Comprovante...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Adicionar Despesa</span>
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
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
        <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center justify-between">
              <span className="truncate mr-2">{viewingExpense?.merchant_name}</span>
              <span className="text-emerald-600 font-extrabold tabular-nums shrink-0">
                {viewingExpense && formatCurrencyBRL(viewingExpense.amount)}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Arquivo: {viewingExpense?.file_name || 'Sem arquivo anexado'} • Data:{' '}
              {viewingExpense && formatDateBR(viewingExpense.issue_date)}
            </DialogDescription>
          </DialogHeader>

          {viewingExpense && (
            <div className="pt-2">
              {viewingExpense.file_url || viewingExpense.file_name ? (
                <DocumentViewer
                  fileName={viewingExpense.file_name || 'comprovante'}
                  fileUrl={viewingExpense.file_url}
                  ocrRawText={viewingExpense.ocr_raw_text}
                />
              ) : (
                <div className="text-center p-8 bg-slate-50 rounded-xl border border-slate-200">
                  <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">
                    Despesa cadastrada sem anexo de comprovante
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Este item foi incluído manualmente sem o upload de arquivo digital.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-3">
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
      {/* Alert Dialog: Confirm Delete Trip */}
      <AlertDialog open={deleteTripDialogOpen} onOpenChange={setDeleteTripDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-600" />
              Excluir Viagem Inteira?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-xs sm:text-sm space-y-2">
              <p>
                Tem certeza que deseja excluir permanentemente a viagem para{' '}
                <strong className="text-slate-900">"{trip.destination}"</strong> (período de{' '}
                {formatDateRangeBR(trip.start_date, trip.end_date)})?
              </p>
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-800 text-xs space-y-1">
                <p className="font-semibold">⚠️ Ação irreversível em cascata:</p>
                <ul className="list-disc list-inside space-y-0.5 text-rose-700">
                  <li>
                    Todas as <strong>{expenses.length} despesas</strong> vinculadas serão apagadas
                    do banco de dados.
                  </li>
                  <li>
                    Todos os <strong>comprovantes fiscais (PDFs e imagens)</strong> armazenados no
                    bucket <code>comprovantes</code> serão removidos permanentemente.
                  </li>
                  <li>Os logs de auditoria e compliance desta viagem serão descartados.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-2">
            <AlertDialogCancel disabled={isDeletingTrip}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteTrip}
              disabled={isDeletingTrip}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {isDeletingTrip
                ? 'Excluindo Viagem e Comprovantes...'
                : 'Sim, Excluir Viagem e Arquivos'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Alert Dialog: Confirm Delete Single Expense */}
      <AlertDialog
        open={!!expenseToDelete}
        onOpenChange={(open) => !open && setExpenseToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-600" />
              Excluir Comprovante de Despesa?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-xs sm:text-sm space-y-2">
              <p>
                Deseja excluir a despesa de{' '}
                <strong className="text-slate-900">{expenseToDelete?.merchant_name}</strong> no
                valor de{' '}
                <strong className="text-emerald-700">
                  {expenseToDelete && formatCurrencyBRL(expenseToDelete.amount)}
                </strong>
                ?
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-xs space-y-1">
                <p className="font-semibold">Aviso sobre o arquivo de comprovante:</p>
                <p>
                  O arquivo <strong>"{expenseToDelete?.file_name}"</strong> será removido
                  permanentemente do armazenamento em nuvem e o total acumulado da viagem será
                  recalculado automaticamente.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-2">
            <AlertDialogCancel disabled={isDeletingExpense}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteExpense}
              disabled={isDeletingExpense}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {isDeletingExpense ? 'Excluindo Despesa e Arquivo...' : 'Sim, Excluir Comprovante'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
