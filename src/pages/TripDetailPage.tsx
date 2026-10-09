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
  DollarSign,
  Mail,
  RotateCcw,
  Unlock,
  Send,
  Download,
  ChevronDown,
} from 'lucide-react'
import { reportEmailService } from '@/services/reportEmailService'
import { exportTripToExcel, exportConsolidatedReportPdf } from '@/services/reportExportService'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  getEffectiveTripStatus,
} from '@/lib/formatters'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
import { showExpenseDeletedUndoToast, showTripDeletedUndoToast } from '@/services/undoService'
import { useAuth } from '@/hooks/use-auth'
import { SettleTripModal } from '@/components/SettleTripModal'

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, profile, isAdmin, loading: authLoading } = useAuth()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [auditRules, setAuditRules] = useState<AuditEvaluationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingExpenseId, setCheckingExpenseId] = useState<string | null>(null)

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

  // Settle Trip Modal
  const [settleModalOpen, setSettleModalOpen] = useState(false)

  // Reopen Trip Modal (Governança: apenas admin, motivo min 10 chars)
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopeningTrip, setReopeningTrip] = useState(false)

  // Send / Resend Email Modal
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('financeiro@empresa.com.br')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [attachPdf, setAttachPdf] = useState(true)
  const [attachReceipts, setAttachReceipts] = useState(true)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSentSuccess, setEmailSentSuccess] = useState(false)
  const [emailSendingStep, setEmailSendingStep] = useState<string | null>(null)
  const [emailErrorMsg, setEmailErrorMsg] = useState<string | null>(null)
  const [emailErrorAction, setEmailErrorAction] = useState<string | null>(null)
  const [emailRawError, setEmailRawError] = useState<string | null>(null)

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

  // Edit Expense Modal (quando viagem aberta)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [isUpdatingExpense, setIsUpdatingExpense] = useState(false)
  const [editExpMerchant, setEditExpMerchant] = useState('')
  const [editExpDate, setEditExpDate] = useState('')
  const [editExpAmount, setEditExpAmount] = useState('')
  const [editExpCategory, setEditExpCategory] = useState<ExpenseCategory>('alimentacao')
  const [editExpCnpj, setEditExpCnpj] = useState('')
  const [editExpTripId, setEditExpTripId] = useState<string>('')
  const [userTrips, setUserTrips] = useState<Trip[]>([])
  const [loadingUserTrips, setLoadingUserTrips] = useState(false)

  const loadTripData = async () => {
    if (!id) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    setLoading(true)
    try {
      const t = await storageService.getTrip(id)
      if (!t) {
        toast({
          title: 'Viagem não encontrada',
          description:
            'O identificador solicitado não existe ou você não possui permissão para acessá-lo.',
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
    } catch (err: any) {
      console.error('Falha ao carregar detalhes da viagem:', err)
      toast({
        title: 'Erro ao carregar viagem',
        description: `Não foi possível carregar os detalhes: ${err?.message || 'erro de conexão'}`,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleToggleManualAudit = async (exp: Expense, markConforme: boolean) => {
    if (!trip || !user) return

    const locked = storageService.isTripLocked(trip.status)
    if (locked) {
      toast({
        title: 'Ação não permitida',
        description:
          'Esta viagem está fechada/reembolsada e seus dados estão bloqueados para edição.',
        variant: 'destructive',
      })
      return
    }

    setCheckingExpenseId(exp.id)
    try {
      const currentUserName =
        profile?.full_name ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        'Auditor Corporativo'

      const updated = await storageService.setExpenseManualAudit(exp.id, markConforme, {
        id: user.id,
        name: currentUserName,
      })

      if (updated) {
        setExpenses((prev) => prev.map((e) => (e.id === exp.id ? updated : e)))
        if (viewingExpense && viewingExpense.id === exp.id) {
          setViewingExpense(updated)
        }
      }

      toast({
        title: markConforme ? 'Conferência confirmada (OK)' : 'Conferência revertida',
        description: markConforme
          ? `O lançamento "${exp.merchant_name}" foi conferido e marcado como conforme por ${currentUserName}.`
          : `A conferência do lançamento "${exp.merchant_name}" voltou para o status pendente.`,
      })
    } catch (err: any) {
      toast({
        title: 'Erro na conferência',
        description: err?.message || 'Não foi possível atualizar o status de auditoria.',
        variant: 'destructive',
      })
    } finally {
      setCheckingExpenseId(null)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    loadTripData()
  }, [authLoading, user?.id, id])

  const handleOpenJustify = (rule: AuditEvaluationRule) => {
    setJustifyingRule(rule)
    setJustificationText(rule.justification || '')
  }

  const handleSaveJustification = async () => {
    if (!justifyingRule || !trip) return
    if (storageService.isTripLocked(trip.status)) {
      toast({
        title: 'Ação não permitida',
        description:
          'Esta viagem está fechada/reembolsada e seus dados estão bloqueados para edição.',
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
    if (storageService.isTripLocked(trip.status)) {
      toast({
        title: 'Ação não permitida',
        description:
          'Esta viagem está fechada/reembolsada e seus dados estão bloqueados para edição.',
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

    if (storageService.isTripLocked(trip.status)) {
      toast({
        title: 'Viagem bloqueada',
        description:
          'Esta viagem está fechada/reembolsada e seus dados estão bloqueados para edição.',
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
    } catch (saveErr: any) {
      console.error('Erro ao criar despesa:', saveErr)
      toast({
        title: 'Erro ao adicionar comprovante',
        description: storageService.formatDatabaseError(saveErr),
        variant: 'destructive',
      })
    } finally {
      setIsUploadingExpense(false)
    }
  }

  const loadAvailableTrips = async () => {
    setLoadingUserTrips(true)
    try {
      const list = await storageService.listTrips()
      setUserTrips(list)
    } catch (err) {
      console.error('Falha ao listar viagens para seleção:', err)
    } finally {
      setLoadingUserTrips(false)
    }
  }

  const handleOpenEditExpense = (exp: Expense) => {
    if (storageService.isTripLocked(trip?.status)) {
      toast({
        title: 'Edição bloqueada',
        description:
          'Esta viagem está fechada/reembolsada e seus dados estão bloqueados para edição.',
        variant: 'destructive',
      })
      return
    }
    setEditingExpense(exp)
    setEditExpMerchant(exp.merchant_name)
    setEditExpDate(exp.issue_date)
    setEditExpAmount(String(exp.amount))
    setEditExpCategory(exp.category)
    setEditExpCnpj(exp.cnpj || '')
    setEditExpTripId(exp.trip_id || trip?.id || '')
    loadAvailableTrips()
  }

  const handleSaveExpenseEdits = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingExpense || !trip) return

    if (storageService.isTripLocked(trip.status)) {
      toast({
        title: 'Edição bloqueada',
        description:
          'Esta viagem está fechada/reembolsada e seus dados estão bloqueados para edição.',
        variant: 'destructive',
      })
      return
    }

    const parsed = parseFloat(editExpAmount.replace(',', '.'))
    if (isNaN(parsed) || parsed <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'Informe um valor maior que zero.',
        variant: 'destructive',
      })
      return
    }

    const targetTripId = editExpTripId || trip.id
    const targetTrip =
      userTrips.find((t) => t.id === targetTripId) || (targetTripId === trip.id ? trip : null)
    if (targetTrip && storageService.isTripLocked(targetTrip.status)) {
      toast({
        title: 'Viagem de destino bloqueada',
        description:
          'Não é possível vincular despesas a uma viagem com status auditada, fechada ou reembolsada.',
        variant: 'destructive',
      })
      return
    }

    const isMovingTrip = targetTripId !== trip.id

    setIsUpdatingExpense(true)
    try {
      await storageService.updateExpense(editingExpense.id, {
        merchant_name: editExpMerchant.trim(),
        issue_date: editExpDate,
        amount: parsed,
        category: editExpCategory,
        cnpj: editExpCnpj.trim() || null,
        trip_id: targetTripId,
      })

      if (isMovingTrip) {
        const destName = targetTrip?.destination || 'outra viagem'
        toast({
          title: 'Despesa movida com sucesso!',
          description: `O comprovante foi transferido para a viagem "${destName}". A listagem atual foi atualizada.`,
        })
      } else {
        toast({
          title: 'Despesa atualizada',
          description: 'Os dados do comprovante foram salvos com sucesso.',
        })
      }
      setEditingExpense(null)
      loadTripData()
    } catch (err: any) {
      console.error('Erro ao atualizar despesa:', err)
      toast({
        title: 'Erro ao salvar despesa',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    } finally {
      setIsUpdatingExpense(false)
    }
  }

  const confirmDeleteExpense = async () => {
    if (!expenseToDelete) return
    const deletedExp = { ...expenseToDelete }
    setIsDeletingExpense(true)
    try {
      // Exclusão no banco; não remove o arquivo do Storage imediatamente para viabilizar "Desfazer"
      await storageService.deleteExpense(deletedExp.id, false)
      setExpenseToDelete(null)

      // Atualiza estado local imediatamente
      setExpenses((prev) => prev.filter((e) => e.id !== deletedExp.id))
      loadTripData()

      // Toast com ação Desfazer (sonner) visível por 10s
      showExpenseDeletedUndoToast({
        expense: deletedExp,
        tripDestination: trip?.destination,
        onRestored: () => {
          loadTripData()
        },
        onRestoreFailed: () => {
          loadTripData()
        },
      })
    } catch (err: any) {
      toast({
        title: 'Exclusão não permitida',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    } finally {
      setIsDeletingExpense(false)
    }
  }

  const confirmDeleteTrip = async () => {
    if (!trip) return
    const currentTripSnapshot = { ...trip }
    const currentExpensesSnapshot = [...expenses]
    setIsDeletingTrip(true)
    try {
      await storageService.deleteTrip(currentTripSnapshot.id, false)
      setDeleteTripDialogOpen(false)

      showTripDeletedUndoToast({
        trip: currentTripSnapshot,
        expenses: currentExpensesSnapshot,
        onRestored: () => {
          navigate(`/trips/${currentTripSnapshot.id}`)
        },
      })

      navigate('/')
    } catch (err: any) {
      toast({
        title: 'Exclusão não permitida',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    } finally {
      setIsDeletingTrip(false)
    }
  }

  const handleSaveTripEdits = async () => {
    if (!trip) return
    const isLockedCurrently = storageService.isTripLocked(trip.status)

    // Se já está travada, só permite alterar o status (se for para um novo status)
    // Destination e motivo são mantidos inalterados
    const payload: { destination?: string; motivo?: string; status: TripStatus } = {
      status: editStatus,
    }

    if (!isLockedCurrently) {
      payload.destination = editDestination.trim()
      payload.motivo = editMotivo.trim()
    }

    try {
      await storageService.updateTrip(trip.id, payload)
      toast({
        title: 'Viagem atualizada',
        description: 'Os dados cadastrais foram salvos com sucesso.',
      })
      setEditTripOpen(false)
      loadTripData()
    } catch (err: any) {
      console.error('Erro ao atualizar viagem:', err)
      toast({
        title: 'Erro ao atualizar viagem',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    }
  }

  // Estado local para geração de PDF na TripDetailPage
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfProgressText, setPdfProgressText] = useState('')

  // Exportação direta para Excel a partir de TripDetailPage
  const handleExportExcelDirect = () => {
    if (!trip) return
    try {
      exportTripToExcel(trip, expenses)
      toast({
        title: 'Planilha baixada!',
        description: 'O arquivo .csv estruturado para Excel foi gerado e baixado com sucesso.',
      })
    } catch (err: any) {
      console.error('Erro ao exportar planilha Excel:', err)
      toast({
        title: 'Erro ao gerar planilha',
        description: err?.message || 'Falha ao processar os dados da viagem.',
        variant: 'destructive',
      })
    }
  }

  // Exportação direta para PDF Consolidado com rasterização dos comprovantes e progresso
  const handleExportPdfDirect = async () => {
    if (!trip || generatingPdf) return
    setGeneratingPdf(true)
    setPdfProgressText('Iniciando processamento dos comprovantes...')

    try {
      const collaboratorName =
        trip.user_profile?.full_name ||
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        'Colaborador Solicitante'

      await exportConsolidatedReportPdf(
        trip,
        expenses,
        (current, total, message) => {
          setPdfProgressText(`${message} (${Math.round((current / total) * 100)}%)`)
        },
        collaboratorName,
      )

      toast({
        title: 'Relatório consolidado gerado!',
        description:
          'O PDF consolidado com todos os comprovantes foi processado e aberto em nova aba.',
      })
    } catch (err: any) {
      console.error('Erro ao gerar relatório consolidado em PDF:', err)
      toast({
        title: 'Erro ao gerar relatório',
        description: err?.message || 'Houve uma falha ao compilar o PDF com os comprovantes.',
        variant: 'destructive',
      })
    } finally {
      setGeneratingPdf(false)
      setPdfProgressText('')
    }
  }

  // Abertura do modal de e-mail na TripDetailPage
  const handleOpenTripEmailModal = () => {
    if (!trip) return
    const collaboratorName =
      trip.user_profile?.full_name ||
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      'Colaborador Solicitante'

    if (trip.report_sent_to) {
      setEmailTo(trip.report_sent_to)
    }

    setEmailSubject(
      `${trip.report_sent_at ? 'Reenvio: ' : ''}Prestação de Contas — ${trip.destination} (${formatDateRangeBR(
        trip.start_date,
        trip.end_date,
      )})`,
    )
    setEmailBody(
      `Olá,\n\nSegue em anexo a prestação de contas consolidada referente à viagem corporativa para ${
        trip.destination
      }.\n\n• Período: ${formatDateRangeBR(trip.start_date, trip.end_date)}\n• Solicitante: ${collaboratorName}\n• Total de Despesas: ${formatCurrencyBRL(
        trip.total_amount,
      )}\n• Quantidade de Comprovantes: ${expenses.length}\n• Motivo: ${
        trip.motivo
      }\n\nTodos os comprovantes foram conferidos conforme as diretrizes de compliance.\n\nAtenciosamente,\n${collaboratorName}`,
    )
    setEmailSentSuccess(false)
    setEmailErrorMsg(null)
    setEmailErrorAction(null)
    setEmailRawError(null)
    setEmailSendingStep(null)
    setEmailModalOpen(true)
  }

  const handleSendReportEmail = async () => {
    if (!trip) return
    const trimmedTo = emailTo.trim()
    if (!trimmedTo || !trimmedTo.includes('@')) {
      toast({
        title: 'Destinatário inválido',
        description: 'Informe um endereço de e-mail corporativo válido.',
        variant: 'destructive',
      })
      return
    }

    setSendingEmail(true)
    setEmailErrorMsg(null)
    setEmailErrorAction(null)
    setEmailRawError(null)
    setEmailSendingStep('Preparando relatório consolidado...')

    try {
      const collaboratorName =
        trip.user_profile?.full_name ||
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        user?.email?.split('@')[0] ||
        'Colaborador Solicitante'

      const result = await reportEmailService.sendReportEmail({
        to: trimmedTo,
        subject: emailSubject.trim(),
        body: emailBody.trim(),
        trip,
        expenses,
        collaboratorName,
        attachPdf,
        attachReceipts,
        onProgress: (stepText) => {
          setEmailSendingStep(stepText)
        },
      })

      if (result.success) {
        setEmailSentSuccess(true)

        // Registrar no banco de dados que o relatório desta viagem foi enviado (ou reenviado) por e-mail
        try {
          const currentUserName =
            profile?.full_name ||
            user?.user_metadata?.full_name ||
            user?.email?.split('@')[0] ||
            'Usuário'
          const updatedTrip = await storageService.markReportEmailSent(
            trip.id,
            trimmedTo,
            user ? { id: user.id, name: currentUserName } : null,
          )
          if (updatedTrip) {
            setTrip(updatedTrip)
          }
        } catch (markErr) {
          console.warn('Falha ao registrar marcação de e-mail enviado na viagem:', markErr)
        }

        toast({
          title: trip.report_sent_at
            ? 'Relatório reenviado com sucesso!'
            : 'Relatório enviado por e-mail!',
          description: `Prestação de contas entregue para ${trimmedTo}. Status atualizado na auditoria.`,
        })
        loadTripData()
      } else {
        setEmailErrorMsg(
          result.error ||
            result.message ||
            'Não foi possível concluir o envio automático pelo servidor.',
        )
        setEmailErrorAction(result.errorAction || null)
        setEmailRawError(result.rawError || null)
        toast({
          title: 'Não foi possível enviar o e-mail',
          description: result.error || result.message || 'Verifique as configurações de e-mail.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('Falha inesperada no envio de e-mail:', err)
      setEmailErrorMsg(err?.message || 'Erro inesperado ao gerar ou enviar o e-mail.')
      toast({
        title: 'Erro inesperado no envio',
        description: err?.message || 'Tente novamente ou utilize o envio manual.',
        variant: 'destructive',
      })
    } finally {
      setSendingEmail(false)
      setEmailSendingStep(null)
    }
  }

  // Executar reabertura da viagem (Governança: apenas admin, motivo min 10 chars)
  const handleConfirmReopenTrip = async () => {
    if (!trip || !isAdmin) return
    const reason = reopenReason.trim()
    if (!reason || reason.length < 10) {
      toast({
        title: 'Motivo insuficiente',
        description: 'Por favor, descreva o motivo da reabertura com no mínimo 10 caracteres.',
        variant: 'destructive',
      })
      return
    }

    setReopeningTrip(true)
    try {
      const currentUserName =
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email ||
        'Administrador'

      await storageService.reopenTrip({
        tripId: trip.id,
        reason,
        user: user ? { id: user.id, name: currentUserName } : null,
      })

      toast({
        title: 'Viagem reaberta com sucesso!',
        description:
          'A viagem voltou para o status "Em Triagem". Comprovantes e dados cadastrais agora estão desbloqueados para ajustes.',
      })

      setReopenDialogOpen(false)
      setReopenReason('')
      await loadTripData()
    } catch (err: any) {
      console.error('Erro ao reabrir viagem:', err)
      toast({
        title: 'Falha ao reabrir viagem',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    } finally {
      setReopeningTrip(false)
    }
  }

  if (authLoading || loading || !trip) {
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
  const effectiveStatus = getEffectiveTripStatus(trip)
  const statusConf = TRIP_STATUS_CONFIG[effectiveStatus]
  const isTripLocked = storageService.isTripLocked(effectiveStatus)

  // Manual Audit Progress (conferência humana de cada lançamento)
  const totalExpenses = expenses.length
  const checkedExpensesCount = expenses.filter(
    (e) => e.audit_manual_checked || e.audit_status === 'conforme',
  ).length
  const checkedExpensesPercent =
    totalExpenses > 0 ? Math.round((checkedExpensesCount / totalExpenses) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Banner Informativo de Imutabilidade / Governança */}
      {effectiveStatus === 'reembolsada' ? (
        <div
          role="alert"
          className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 sm:p-4.5 text-emerald-950 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-200/80 text-emerald-900 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-sm sm:text-base text-emerald-950 flex items-center gap-2">
                <span>💰 Viagem Reembolsada e Processo Quitado</span>
                <Badge className="bg-emerald-200 text-emerald-900 text-[10px] font-bold border-none">
                  Quitação Definitiva
                </Badge>
              </h3>
              <div className="text-xs text-emerald-900 leading-relaxed space-y-0.5">
                <p>
                  Data do Depósito:{' '}
                  <strong>
                    {trip.settlement_date ? formatDateBR(trip.settlement_date) : 'Registrada'}
                  </strong>
                  {' • '}
                  Valor Quitado:{' '}
                  <strong className="text-emerald-900">
                    {formatCurrencyBRL(trip.settlement_amount ?? trip.total_amount)}
                  </strong>
                  {trip.settlement_batch_id &&
                    trip.settlement_batch_count &&
                    trip.settlement_batch_count > 1 && (
                      <span className="ml-1.5 inline-flex items-center gap-1 font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-200">
                        Quitada em depósito conjunto com {trip.settlement_batch_count} viagens
                        {trip.settlement_deposit_total && (
                          <span>
                            {' '}
                            (Depósito total: {formatCurrencyBRL(trip.settlement_deposit_total)})
                          </span>
                        )}
                      </span>
                    )}
                </p>
                {trip.settled_by_name && (
                  <p className="text-[11px] text-emerald-800">
                    Liquidado por: <strong>{trip.settled_by_name}</strong>
                    {trip.settled_at && (
                      <span>
                        {' '}
                        em {new Date(trip.settled_at).toLocaleDateString('pt-BR')} às{' '}
                        {new Date(trip.settled_at).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => navigate('/reports')}
            className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shrink-0 gap-1.5 shadow-xs w-full sm:w-auto"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Ver Relatório Oficial</span>
          </Button>
        </div>
      ) : isTripLocked ? (
        <div
          role="alert"
          className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 sm:p-4.5 text-amber-950 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-0.5">
              <h3 className="font-bold text-sm sm:text-base text-amber-950 flex items-center gap-2">
                <span>
                  🔒 Esta viagem está fechada/auditada e seus dados estão bloqueados para edição
                </span>
              </h3>
              <p className="text-xs text-amber-800 leading-relaxed">
                Status atual:{' '}
                <strong className="underline decoration-amber-400 underline-offset-2">
                  {statusConf.label}
                </strong>
                . Despesas não podem ser inseridas, alteradas ou excluídas, e os dados principais da
                viagem estão protegidos por governança. Exportação e envio de relatório continuam
                disponíveis.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReopenReason('')
                  setReopenDialogOpen(true)
                }}
                className="bg-amber-100/80 hover:bg-amber-200/80 text-amber-900 border-amber-300 text-xs font-semibold gap-1.5"
              >
                <Unlock className="w-3.5 h-3.5 text-amber-800" />
                <span>Reabrir Viagem</span>
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => navigate('/reports')}
              className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs font-semibold shrink-0 gap-1.5 shadow-xs w-full sm:w-auto"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Ver Relatório Oficial</span>
            </Button>
          </div>
        </div>
      ) : null}

      {/* Banner Informativo Discreto de Viagem Reaberta */}
      {trip.reopened_at && effectiveStatus === 'em_triagem' && (
        <div
          role="status"
          className="bg-blue-50/70 border border-blue-200/80 rounded-lg p-3 text-blue-900 text-xs flex items-start sm:items-center justify-between gap-3 animate-fade-in"
        >
          <div className="flex items-start sm:items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <RotateCcw className="w-3.5 h-3.5" />
            </div>
            <div className="space-y-0.5 leading-snug">
              <span className="font-semibold block text-slate-900">
                Esta viagem foi reaberta em {new Date(trip.reopened_at).toLocaleDateString('pt-BR')}{' '}
                às{' '}
                {new Date(trip.reopened_at).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {trip.reopened_by_name ? ` por ${trip.reopened_by_name}` : ''}
              </span>
              {trip.reopen_reason && (
                <p className="text-slate-600 text-[11px]">
                  <strong>Motivo da reabertura:</strong> {trip.reopen_reason}
                </p>
              )}
            </div>
          </div>
          <Badge
            variant="outline"
            className="text-[10px] bg-white border-blue-300 text-blue-700 shrink-0 font-medium"
          >
            Desbloqueada para ajustes
          </Badge>
        </div>
      )}

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
              title="Viagem fechada, auditada ou reembolsada — exclusão bloqueada por regra de governança"
            >
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Viagem bloqueada para exclusão</span>
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
            {isTripLocked ? (
              <Lock className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <Edit className="w-3.5 h-3.5" />
            )}
            <span>{isTripLocked ? 'Ver / Alterar Status' : 'Editar Viagem'}</span>
          </Button>

          {/* Exportação Direta de Relatório: PDF Consolidado e Planilha Excel */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={generatingPdf}
                className="text-xs gap-1.5 shadow-sm font-semibold text-slate-700 border-slate-300 hover:bg-slate-50"
              >
                {generatingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                )}
                <span>{generatingPdf ? 'Gerando PDF...' : 'Exportar Relatório'}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-semibold text-slate-600">
                Baixar arquivos diretamente
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={handleExportPdfDirect}
                disabled={generatingPdf}
                className="cursor-pointer gap-2 py-2 text-xs"
              >
                <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="font-semibold text-slate-900">Exportar PDF Consolidado</span>
                  <span className="text-[10px] text-slate-500">
                    Com capa, auditoria e comprovantes
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportExcelDirect}
                className="cursor-pointer gap-2 py-2 text-xs"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="font-semibold text-slate-900">Exportar Planilha Excel</span>
                  <span className="text-[10px] text-slate-500">
                    Tabela estruturada (.csv/Excel)
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate('/reports')}
                className="cursor-pointer gap-2 py-2 text-xs text-slate-600"
              >
                <ArrowLeft className="w-3.5 h-3.5 rotate-180 shrink-0 text-slate-400" />
                <span className="text-slate-700 font-medium">Ver Central de Relatórios</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Botão Enviar / Reenviar Relatório por E-mail (Gatilho Autônomo e Separado) */}
          <Button
            size="sm"
            onClick={handleOpenTripEmailModal}
            className={`text-xs gap-1.5 shadow-sm font-semibold text-white ${
              trip.report_sent_at
                ? 'bg-blue-700 hover:bg-blue-800'
                : 'bg-[#1e40af] hover:bg-[#1d3d9e]'
            }`}
          >
            {trip.report_sent_at ? (
              <RotateCcw className="w-3.5 h-3.5" />
            ) : (
              <Mail className="w-3.5 h-3.5" />
            )}
            <span>{trip.report_sent_at ? 'Reenviar por E-mail' : 'Enviar por E-mail'}</span>
          </Button>

          {/* Botão Reabrir Viagem para Admin (quando auditada ou fechada) */}
          {isAdmin && (effectiveStatus === 'auditada' || effectiveStatus === 'fechada') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReopenReason('')
                setReopenDialogOpen(true)
              }}
              className="text-xs gap-1.5 text-amber-800 border-amber-300 hover:bg-amber-50 font-semibold"
            >
              <Unlock className="w-3.5 h-3.5 text-amber-700" />
              <span>Reabrir Viagem</span>
            </Button>
          )}

          {/* Botão Quitar Viagem: liberado quando relatório enviado por e-mail e viagem ainda não reembolsada */}
          {effectiveStatus !== 'reembolsada' &&
            (trip.report_sent_at ? (
              <Button
                size="sm"
                onClick={() => setSettleModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shadow-sm font-bold animate-pulse hover:animate-none"
              >
                <DollarSign className="w-4 h-4" />
                <span>Quitar Viagem</span>
              </Button>
            ) : effectiveStatus === 'auditada' || effectiveStatus === 'fechada' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSettleModalOpen(true)}
                className="text-xs gap-1.5 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-300 font-semibold"
                title="Quitar viagem (disponível para viagens auditadas ou fechadas)"
              >
                <DollarSign className="w-4 h-4" />
                <span>Quitar Viagem</span>
              </Button>
            ) : null)}
        </div>
      </div>

      {/* Banner de feedback de progresso ao gerar PDF direto */}
      {generatingPdf && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between gap-3 animate-pulse shadow-2xs">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
            <span className="font-semibold">
              {pdfProgressText || 'Preparando PDF consolidado...'}
            </span>
          </div>
          <span className="text-[11px] text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded border border-blue-200">
            Rasterizando comprovantes
          </span>
        </div>
      )}

      {/* Header Section: Trip Overview Card */}
      <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden">
        {' '}
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusConf.badgeClass}`}
              >
                {statusConf.label}
              </span>

              {effectiveStatus === 'reembolsada' && trip.settlement_date && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>Quitada em {formatDateBR(trip.settlement_date)}</span>
                </span>
              )}

              {trip.report_sent_at && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 cursor-help">
                        <Mail className="w-3 h-3 text-blue-600" />
                        <span>
                          Relatório Enviado (
                          {new Date(trip.report_sent_at).toLocaleDateString('pt-BR')})
                        </span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      <p className="font-semibold">Último envio por e-mail:</p>
                      <p>Data: {new Date(trip.report_sent_at).toLocaleString('pt-BR')}</p>
                      {trip.report_sent_to && <p>Destinatário: {trip.report_sent_to}</p>}
                      {trip.report_sent_by_name && <p>Enviado por: {trip.report_sent_by_name}</p>}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

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

            <div className="flex items-center gap-2 text-xs text-slate-600 pt-0.5">
              <span>Colaborador Solicitante:</span>
              <span className="font-semibold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {trip.user_profile?.full_name || 'Colaborador Corporativo'}
              </span>
              {trip.user_profile?.email && (
                <span className="text-[11px] text-slate-400">({trip.user_profile.email})</span>
              )}
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

            {/* Manual Audit Check Progress Bar */}
            {totalExpenses > 0 && (
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-200">
                <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                  Conferência:{' '}
                  <strong className="text-blue-700">
                    {checkedExpensesCount} de {totalExpenses}
                  </strong>{' '}
                  lançamentos conferidos ({checkedExpensesPercent}%)
                </span>
                <div className="w-24">
                  <Progress value={checkedExpensesPercent} className="h-2" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isTripLocked ? (
              <>
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
                  Adicionar Comprovante
                </Button>
              </>
            ) : (
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 border border-slate-200 text-slate-500 text-xs font-medium cursor-not-allowed select-none"
                title="Viagem fechada/reembolsada — adição de despesas bloqueada"
              >
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Upload e adição bloqueados</span>
              </div>
            )}
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
            {/* Mobile progress indicator */}
            {totalExpenses > 0 && (
              <div className="sm:hidden px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  Conferência: {checkedExpensesCount}/{totalExpenses} ({checkedExpensesPercent}%)
                </span>
                <div className="w-20">
                  <Progress value={checkedExpensesPercent} className="h-2" />
                </div>
              </div>
            )}
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-[11px] font-semibold text-slate-500 tracking-wider">
                <tr>
                  <th className="py-3 px-4">Data Emissão</th>
                  <th className="py-3 px-4">Categoria</th>
                  <th className="py-3 px-4">Estabelecimento / Razão Social</th>
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-center">Status Auditoria</th>
                  <th className="py-3 px-4 text-center">Conferência Manual</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((exp) => {
                  const catColor = CATEGORY_COLORS[exp.category]
                  const isDupe = exp.audit_flags?.includes('comprovante_duplicado')
                  const isManuallyChecked = Boolean(exp.audit_manual_checked)
                  const isBusy = checkingExpenseId === exp.id

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

                      {/* Status Auditoria (pill com borda e diferenciação visual clara) */}
                      <td className="py-3.5 px-4 text-center">
                        <TooltipProvider delayDuration={200}>
                          {isManuallyChecked ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Conforme (manual)</span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs max-w-xs space-y-1">
                                <p className="font-semibold text-emerald-900">
                                  ✓ Conferido e aprovado manualmente
                                </p>
                                {exp.audit_manual_checked_by_name && (
                                  <p className="text-[11px] text-slate-600">
                                    Auditor: <strong>{exp.audit_manual_checked_by_name}</strong>
                                  </p>
                                )}
                                {exp.audit_manual_checked_at && (
                                  <p className="text-[11px] text-slate-500">
                                    Data/Hora:{' '}
                                    {new Date(exp.audit_manual_checked_at).toLocaleString('pt-BR')}
                                  </p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          ) : exp.audit_status === 'conforme' ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50/80 text-emerald-700 border border-emerald-200">
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span>Conforme (motor)</span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">
                                Validado automaticamente pelo motor de regras
                              </TooltipContent>
                            </Tooltip>
                          ) : exp.audit_status === 'justificado' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              Justificado
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Pendente
                            </span>
                          )}
                        </TooltipProvider>
                      </td>

                      {/* Botão de Conferência Manual: OK / Desfazer */}
                      <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        {isTripLocked ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium cursor-not-allowed select-none"
                            title="Viagem fechada — conferência bloqueada"
                          >
                            <Lock className="w-3 h-3 text-slate-400" />
                            <span>Bloqueado</span>
                          </span>
                        ) : isManuallyChecked ? (
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => handleToggleManualAudit(exp, false)}
                              className="h-7 px-2 text-[11px] font-medium border-slate-200 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 text-slate-600 transition-colors"
                              title="Clique para desfazer a conferência e voltar para pendente"
                            >
                              {isBusy ? (
                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              ) : (
                                <X className="w-3 h-3 mr-1 text-slate-400 hover:text-amber-600" />
                              )}
                              <span>Desfazer</span>
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleToggleManualAudit(exp, true)}
                            className="h-7 px-2.5 text-[11px] font-semibold border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shadow-2xs transition-all"
                            title="Confirmar conferência deste comprovante (marcar Conforme manualmente)"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <Check className="w-3.5 h-3.5 mr-1 text-emerald-600 group-hover:text-white" />
                            )}
                            <span>Confirmar OK</span>
                          </Button>
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
                              className="inline-flex items-center gap-1 text-slate-300 cursor-not-allowed select-none px-1"
                              title="Viagem fechada/reembolsada — edição e exclusão de despesas bloqueadas"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </div>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditExpense(exp)}
                                className="h-7 w-7 p-0 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                title="Editar Despesa"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpenseToDelete(exp)}
                                className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                title="Excluir Comprovante e Arquivo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
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
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              {isTripLocked ? (
                <Lock className="w-4 h-4 text-amber-600" />
              ) : (
                <Edit className="w-4 h-4 text-blue-600" />
              )}
              <span>
                {isTripLocked
                  ? 'Alterar Status da Viagem (Bloqueada para Edição)'
                  : 'Editar Dados da Viagem'}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {isTripLocked
                ? 'Esta viagem está em modo somente leitura devido ao seu status atual. Os campos cadastrais estão bloqueados para edição.'
                : 'Atualize os dados cadastrais da viagem corporativa.'}
            </DialogDescription>
          </DialogHeader>

          {isTripLocked && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                🔒 <strong>Modo Somente Leitura:</strong> Esta viagem está fechada/reembolsada e
                seus dados estão bloqueados para edição. Apenas a transição de status é permitida.
              </span>
            </div>
          )}

          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Destino</Label>
              <Input
                value={editDestination}
                onChange={(e) => setEditDestination(e.target.value)}
                disabled={isTripLocked}
                className="text-xs disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Período da Viagem</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={trip.start_date}
                  disabled
                  className="text-xs bg-slate-100 text-slate-500 cursor-not-allowed"
                  title="Data de início (somente leitura)"
                />
                <Input
                  type="date"
                  value={trip.end_date}
                  disabled
                  className="text-xs bg-slate-100 text-slate-500 cursor-not-allowed"
                  title="Data de término (somente leitura)"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Tipo de Transporte</Label>
              <Input
                value={TRANSPORT_LABELS[trip.transport_type]}
                disabled
                className="text-xs bg-slate-100 text-slate-500 cursor-not-allowed"
                title="Tipo de transporte (somente leitura)"
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
                disabled={isTripLocked}
                className="text-xs resize-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
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

      {/* Edit Single Expense Modal (quando viagem aberta) */}
      <Dialog open={!!editingExpense} onOpenChange={(open) => !open && setEditingExpense(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Edit className="w-4 h-4 text-blue-600" />
              Editar Despesa
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Arquivo: {editingExpense?.file_name}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveExpenseEdits} className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Estabelecimento *</Label>
              <Input
                value={editExpMerchant}
                onChange={(e) => setEditExpMerchant(e.target.value)}
                required
                className="text-xs"
                disabled={isUpdatingExpense}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Data de Emissão *</Label>
                <Input
                  type="date"
                  value={editExpDate}
                  onChange={(e) => setEditExpDate(e.target.value)}
                  required
                  className="text-xs"
                  disabled={isUpdatingExpense}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Valor (R$) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editExpAmount}
                  onChange={(e) => setEditExpAmount(e.target.value)}
                  required
                  className="text-xs tabular-nums"
                  disabled={isUpdatingExpense}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Categoria *</Label>
              <Select
                value={editExpCategory}
                onValueChange={(val) => setEditExpCategory(val as ExpenseCategory)}
                disabled={isUpdatingExpense}
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

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">CNPJ (opcional)</Label>
              <Input
                value={editExpCnpj}
                onChange={(e) => setEditExpCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
                className="text-xs"
                disabled={isUpdatingExpense}
              />
            </div>

            {/* Seleção de Viagem Vinculada */}
            <div className="space-y-1 pt-1 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Plane className="w-3.5 h-3.5 text-blue-600" />
                  Viagem Vinculada *
                </Label>
                {editExpTripId && editExpTripId !== trip.id && (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Será movida para outra viagem
                  </span>
                )}
              </div>
              <Select
                value={editExpTripId || trip.id}
                onValueChange={setEditExpTripId}
                disabled={isUpdatingExpense || loadingUserTrips}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue
                    placeholder={
                      loadingUserTrips ? 'Carregando viagens...' : 'Selecione a viagem vinculada'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {/* Se a lista de userTrips ainda não tem a própria viagem atual, garante que ela apareça */}
                  {(userTrips.length > 0 ? userTrips : [trip]).map((tr) => {
                    const locked = storageService.isTripLocked(tr.status)
                    const isCurrent = tr.id === trip.id
                    return (
                      <SelectItem
                        key={tr.id}
                        value={tr.id}
                        disabled={locked && !isCurrent}
                        className="text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 w-full">
                          <span>
                            {tr.destination} ({formatDateBR(tr.start_date)})
                            {isCurrent ? ' (Atual)' : ''}
                          </span>
                          {locked && (
                            <span className="text-[10px] text-slate-400 font-normal">
                              🔒 Bloqueada ({TRIP_STATUS_CONFIG[tr.status]?.label || tr.status})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-400">
                Caso este comprovante tenha sido lançado na viagem errada, escolha a viagem correta
                para movê-lo. Viagens auditadas, fechadas ou reembolsadas não podem receber
                despesas.
              </p>
            </div>

            <DialogFooter className="pt-3 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingExpense(null)}
                disabled={isUpdatingExpense}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isUpdatingExpense}
                className="bg-[#1e40af] text-white text-xs gap-1"
              >
                {isUpdatingExpense ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Salvar Despesa</span>
              </Button>
            </DialogFooter>
          </form>
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

          <DialogFooter className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {viewingExpense && (
                <>
                  {viewingExpense.audit_manual_checked ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>Conforme (verificado manualmente)</span>
                      </span>
                      {!isTripLocked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={checkingExpenseId === viewingExpense.id}
                          onClick={() => handleToggleManualAudit(viewingExpense, false)}
                          className="h-8 text-xs text-slate-500 hover:text-amber-700 hover:bg-amber-50"
                        >
                          {checkingExpenseId === viewingExpense.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          ) : (
                            <X className="w-3.5 h-3.5 mr-1" />
                          )}
                          Desfazer conferência
                        </Button>
                      )}
                    </div>
                  ) : (
                    !isTripLocked && (
                      <Button
                        size="sm"
                        disabled={checkingExpenseId === viewingExpense.id}
                        onClick={() => handleToggleManualAudit(viewingExpense, true)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shadow-sm font-semibold h-8"
                      >
                        {checkingExpenseId === viewingExpense.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        <span>Confirmar OK nesta conferência</span>
                      </Button>
                    )
                  )}
                </>
              )}
            </div>

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
      {/* Settle Trip Modal (Quitação de Viagem) */}
      {trip && (
        <SettleTripModal
          open={settleModalOpen}
          onOpenChange={setSettleModalOpen}
          currentTrip={trip}
          user={
            user
              ? {
                  id: user.id,
                  name:
                    profile?.full_name ||
                    user.user_metadata?.full_name ||
                    user.email?.split('@')[0] ||
                    'Usuário',
                }
              : null
          }
          onSuccess={(updatedTrip) => {
            setTrip(updatedTrip)
            loadTripData()
          }}
        />
      )}

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
                <p className="font-semibold">⚠️ Exclusão em cascata:</p>
                <ul className="list-disc list-inside space-y-0.5 text-rose-700">
                  <li>
                    Todas as <strong>{expenses.length} despesas</strong> vinculadas serão apagadas.
                  </li>
                  <li>
                    Esta ação poderá ser <strong>desfeita por até 10 segundos</strong> após a
                    confirmação através do aviso na tela.
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
                <p className="font-semibold">Possibilidade de desfazer:</p>
                <p>
                  O comprovante <strong>"{expenseToDelete?.file_name}"</strong> será desvinculado e
                  o total recalculado. Você terá <strong>10 segundos</strong> para desfazer esta
                  ação pelo aviso que surgirá na tela.
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

      {/* AlertDialog de Governança: Reabrir Viagem (Exclusivo Administradores) */}
      <AlertDialog open={reopenDialogOpen} onOpenChange={setReopenDialogOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-amber-900 flex items-center gap-2 text-base">
              <Unlock className="w-5 h-5 text-amber-600" />
              Reabertura de Viagem (Fluxo de Governança)
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-xs sm:text-sm space-y-3 pt-1">
              <p>
                A viagem para <strong className="text-slate-900">{trip.destination}</strong> voltará
                do status <strong className="text-amber-800">{statusConf.label}</strong> para{' '}
                <strong className="text-blue-700">Em Triagem</strong>.
              </p>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-950 space-y-1.5 leading-relaxed">
                <p className="font-semibold flex items-center gap-1.5 text-amber-900">
                  <ShieldCheck className="w-4 h-4 text-amber-700" />
                  Rastreabilidade e Desbloqueio:
                </p>
                <ul className="list-disc list-inside space-y-1 text-amber-900/90">
                  <li>
                    A viagem será desbloqueada para inclusão, edição e exclusão de comprovantes.
                  </li>
                  <li>O histórico e o motivo da reabertura ficarão permanentemente gravados.</li>
                  <li>Após as correções, o relatório deverá ser reenviado.</li>
                </ul>
              </div>

              <div className="space-y-1.5 pt-1">
                <Label
                  htmlFor="reopen-reason-input"
                  className="text-xs font-semibold text-slate-800 flex items-center justify-between"
                >
                  <span>Motivo obrigatório da reabertura:</span>
                  <span
                    className={`text-[11px] font-normal ${reopenReason.trim().length >= 10 ? 'text-emerald-600' : 'text-slate-400'}`}
                  >
                    {reopenReason.trim().length}/10 caracteres mín.
                  </span>
                </Label>
                <Textarea
                  id="reopen-reason-input"
                  rows={3}
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Ex: Correção de comprovante duplicado de alimentação e ajuste de valor do táxi..."
                  className="text-xs resize-none"
                  disabled={reopeningTrip}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-2">
            <AlertDialogCancel disabled={reopeningTrip}>Cancelar</AlertDialogCancel>
            <Button
              onClick={handleConfirmReopenTrip}
              disabled={reopeningTrip || reopenReason.trim().length < 10}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs gap-1.5"
            >
              {reopeningTrip ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Reabrindo Viagem...</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Confirmar Reabertura</span>
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Envio / Reenvio de Relatório por E-mail */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              {trip.report_sent_at ? (
                <RotateCcw className="w-4 h-4 text-blue-600" />
              ) : (
                <Mail className="w-4 h-4 text-blue-600" />
              )}
              <span>
                {trip.report_sent_at
                  ? 'Reenviar Prestação de Contas por E-mail'
                  : 'Enviar Prestação de Contas por E-mail'}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {trip.report_sent_at
                ? 'Esta viagem já teve relatório enviado. Você pode reenviar o relatório consolidado atualizado.'
                : 'Dispare o relatório consolidado diretamente para a controladoria ou gestor com anexo em PDF.'}
            </DialogDescription>
          </DialogHeader>

          {/* Banner de último envio */}
          {trip.report_sent_at && (
            <div className="p-2.5 bg-blue-50/80 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5 leading-snug">
                <span className="font-semibold block">Último envio registrado:</span>
                <p className="text-[11px] text-blue-800">
                  Enviado em{' '}
                  <strong>
                    {new Date(trip.report_sent_at).toLocaleDateString('pt-BR')} às{' '}
                    {new Date(trip.report_sent_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>
                  {trip.report_sent_to && (
                    <span>
                      {' '}
                      para <strong>{trip.report_sent_to}</strong>
                    </span>
                  )}
                  {trip.report_sent_by_name && (
                    <span>
                      {' '}
                      por <strong>{trip.report_sent_by_name}</strong>
                    </span>
                  )}
                  .
                </p>
                <p className="text-[10px] text-blue-700 italic">
                  O reenvio atualizará a data, horário e destinatário do relatório oficial.
                </p>
              </div>
            </div>
          )}

          {emailSentSuccess ? (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-900 text-base">
                {trip.report_sent_at
                  ? 'Relatório Reenviado com Sucesso!'
                  : 'Relatório Enviado com Sucesso!'}
              </h3>
              <p className="text-xs text-slate-600 max-w-sm mx-auto">
                A prestação de contas foi disparada para <strong>{emailTo}</strong> com o PDF
                oficial anexado.
              </p>
              <div className="pt-2">
                <Button
                  size="sm"
                  onClick={() => setEmailModalOpen(false)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                >
                  Concluir
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5 pt-1">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">
                  Destinatário (E-mail Corporativo)
                </Label>
                <Input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="financeiro@empresa.com.br"
                  className="text-xs h-9"
                  disabled={sendingEmail}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Assunto</Label>
                <Input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="text-xs h-9"
                  disabled={sendingEmail}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Mensagem</Label>
                <Textarea
                  rows={4}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="text-xs resize-none"
                  disabled={sendingEmail}
                />
              </div>

              {/* Anexos */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wide">
                  Anexos Inclusos:
                </span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attachPdf}
                    onChange={(e) => setAttachPdf(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    disabled={sendingEmail}
                  />
                  <span className="text-slate-800">
                    PDF Consolidado Oficial (capa, demonstrativo gerencial e tabela de comprovantes)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attachReceipts}
                    onChange={(e) => setAttachReceipts(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    disabled={sendingEmail}
                  />
                  <span className="text-slate-800">
                    Páginas rasterizadas de cada recibo/nota fiscal ({expenses.length} comprovantes)
                  </span>
                </label>
              </div>

              {/* Status de progresso */}
              {sendingEmail && emailSendingStep && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center gap-2 animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                  <span>{emailSendingStep}</span>
                </div>
              )}

              {/* Mensagem de Erro com Fallback */}
              {emailErrorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold">{emailErrorMsg}</p>
                      {emailErrorAction && (
                        <p className="text-[11px] text-rose-800">{emailErrorAction}</p>
                      )}
                      {emailRawError && (
                        <pre className="text-[10px] bg-rose-100/60 p-1.5 rounded overflow-x-auto text-rose-950 font-mono">
                          {emailRawError}
                        </pre>
                      )}
                    </div>
                  </div>
                  <div className="pt-1 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const currentUserName =
                            profile?.full_name ||
                            user?.user_metadata?.full_name ||
                            user?.email?.split('@')[0] ||
                            'Usuário'
                          const updatedTrip = await storageService.markReportEmailSent(
                            trip.id,
                            emailTo.trim() || 'cliente_email_local',
                            user ? { id: user.id, name: currentUserName } : null,
                          )
                          if (updatedTrip) {
                            setTrip(updatedTrip)
                          }
                        } catch (markErr) {
                          console.warn('Falha ao registrar marcação via mailto:', markErr)
                        }
                        const mailtoUrl = reportEmailService.createMailToLink(
                          emailTo,
                          emailSubject,
                          emailBody,
                        )
                        window.location.href = mailtoUrl
                      }}
                      className="text-xs h-7 border-rose-300 text-rose-800 hover:bg-rose-100"
                    >
                      <Mail className="w-3 h-3 mr-1" />
                      Abrir no meu aplicativo de e-mail (mailto)
                    </Button>
                  </div>
                </div>
              )}

              <DialogFooter className="pt-2 flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEmailModalOpen(false)}
                  disabled={sendingEmail}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSendReportEmail}
                  disabled={sendingEmail}
                  className={`text-xs gap-1.5 font-semibold text-white ${
                    trip.report_sent_at
                      ? 'bg-blue-700 hover:bg-blue-800'
                      : 'bg-[#1e40af] hover:bg-[#1d3d9e]'
                  }`}
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{trip.report_sent_at ? 'Reenviando...' : 'Enviando...'}</span>
                    </>
                  ) : (
                    <>
                      {trip.report_sent_at ? (
                        <RotateCcw className="w-3.5 h-3.5" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {trip.report_sent_at
                          ? 'Reenviar Prestação de Contas'
                          : 'Enviar Prestação de Contas'}
                      </span>
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
