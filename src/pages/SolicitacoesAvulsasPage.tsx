import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  PackageOpen,
  Plus,
  Search,
  Filter,
  FileSpreadsheet,
  FileText,
  Mail,
  Send,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Eye,
  Loader2,
  UploadCloud,
  DollarSign,
  AlertCircle,
  FileQuestion,
  Calendar,
  Sparkles,
  ShieldAlert,
  Building,
  Tag,
  Receipt,
  Clock,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { StandaloneRequest, StandaloneRequestStatus } from '@/types/database'
import { standaloneRequestService } from '@/services/standaloneRequestService'
import { processRealReceiptOcr } from '@/services/ocrService'
import {
  exportStandaloneRequestPdf,
  exportStandaloneRequestToExcel,
} from '@/services/reportExportService'
import { reportEmailService } from '@/services/reportEmailService'
import { showStandaloneRequestDeletedUndoToast } from '@/services/undoService'
import { SettleStandaloneModal } from '@/components/SettleStandaloneModal'
import { DocumentViewer } from '@/components/DocumentViewer'
import { formatCurrencyBRL, formatDateBR, normalizeSearchText } from '@/lib/formatters'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'

const CATEGORY_SUGGESTIONS = [
  'Equipamento',
  'Evento/Ingresso',
  'Material de Escritório',
  'Software / Licença',
  'Treinamento / Curso',
  'Outro',
]

export default function SolicitacoesAvulsasPage() {
  const { user, profile, isAdmin } = useAuth()
  const { toast } = useToast()

  const [requests, setRequests] = useState<StandaloneRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | StandaloneRequestStatus>('all')

  // Modais
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [settleModalOpen, setSettleModalOpen] = useState(false)
  const [selectedForSettle, setSelectedForSettle] = useState<StandaloneRequest | null>(null)

  // Visualizador de comprovante
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerDoc, setViewerDoc] = useState<{
    url: string
    fileName: string
    title: string
  } | null>(null)

  // Envio por e-mail
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [selectedForEmail, setSelectedForEmail] = useState<StandaloneRequest | null>(null)
  const [emailRecipient, setEmailRecipient] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailProgress, setEmailProgress] = useState('')

  // Reabertura (governança admin)
  const [reopenModalOpen, setReopenModalOpen] = useState(false)
  const [selectedForReopen, setSelectedForReopen] = useState<StandaloneRequest | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [reopening, setReopening] = useState(false)

  // Exclusão com confirmação e Desfazer
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [requestToDelete, setRequestToDelete] = useState<StandaloneRequest | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Formulário de Criação / Edição
  const [isEditing, setIsEditing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formDescription, setFormDescription] = useState('')
  const [formCategory, setFormCategory] = useState('Equipamento')
  const [customCategory, setCustomCategory] = useState('')
  const [formExpenseDate, setFormExpenseDate] = useState(new Date().toISOString().split('T')[0])
  const [formAmount, setFormAmount] = useState('')
  const [formMerchant, setFormMerchant] = useState('')
  const [formCnpj, setFormCnpj] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState('')
  const [existingReceiptUrl, setExistingReceiptUrl] = useState('')
  const [existingReceiptFileName, setExistingReceiptFileName] = useState('')
  const [existingStoragePath, setExistingStoragePath] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState<string | null>(null)

  // Estado do OCR durante o upload
  const [ocrProcessing, setOcrProcessing] = useState(false)
  const [ocrProgressText, setOcrProgressText] = useState('')
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null)
  const [savingRequest, setSavingRequest] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadRequests = async () => {
    setLoading(true)
    try {
      const data = await standaloneRequestService.listRequests()
      setRequests(data)
    } catch (err: any) {
      console.error('Erro ao carregar solicitações avulsas:', err)
      toast({
        title: 'Erro ao carregar dados',
        description: err?.message || 'Falha ao buscar solicitações avulsas.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()
  }, [])

  // Filtragem e busca
  const filteredRequests = useMemo(() => {
    const q = normalizeSearchText(searchQuery)
    return requests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (!q) return true

      const desc = normalizeSearchText(r.description)
      const cat = normalizeSearchText(r.category)
      const merch = normalizeSearchText(r.merchant_name)
      const cnpj = normalizeSearchText(r.cnpj)
      const notes = normalizeSearchText(r.notes)
      const user = normalizeSearchText(r.user_profile?.full_name)

      return (
        desc.includes(q) ||
        cat.includes(q) ||
        merch.includes(q) ||
        cnpj.includes(q) ||
        notes.includes(q) ||
        user.includes(q)
      )
    })
  }, [requests, searchQuery, statusFilter])

  // Contadores
  const counts = useMemo(() => {
    const emTriagem = requests.filter((r) => r.status === 'em_triagem').length
    const empacotada = requests.filter((r) => r.status === 'empacotada').length
    const quitada = requests.filter((r) => r.status === 'quitada').length
    const totalAmount = requests.reduce((acc, r) => acc + (r.amount || 0), 0)
    return { emTriagem, empacotada, quitada, total: requests.length, totalAmount }
  }, [requests])

  // Resetar formulário de criação
  const resetForm = () => {
    setIsEditing(false)
    setEditingId(null)
    setFormDescription('')
    setFormCategory('Equipamento')
    setCustomCategory('')
    setFormExpenseDate(new Date().toISOString().split('T')[0])
    setFormAmount('')
    setFormMerchant('')
    setFormCnpj('')
    setFormNotes('')
    setReceiptFile(null)
    setReceiptPreviewUrl('')
    setExistingReceiptUrl('')
    setExistingReceiptFileName('')
    setExistingStoragePath(null)
    setOcrText(null)
    setOcrConfidence(null)
    setOcrProcessing(false)
  }

  const handleOpenCreateModal = () => {
    resetForm()
    setCreateModalOpen(true)
  }

  const handleOpenEditModal = (req: StandaloneRequest) => {
    if (req.status !== 'em_triagem') {
      toast({
        title: 'Edição bloqueada',
        description: 'Apenas solicitações com status "Em Triagem" podem ser editadas diretamente.',
        variant: 'destructive',
      })
      return
    }

    setIsEditing(true)
    setEditingId(req.id)
    setFormDescription(req.description)
    if (CATEGORY_SUGGESTIONS.includes(req.category)) {
      setFormCategory(req.category)
      setCustomCategory('')
    } else {
      setFormCategory('Outro')
      setCustomCategory(req.category)
    }
    setFormExpenseDate(req.expense_date)
    setFormAmount(String(req.amount))
    setFormMerchant(req.merchant_name || '')
    setFormCnpj(req.cnpj || '')
    setFormNotes(req.notes || '')
    setExistingReceiptUrl(req.receipt_url)
    setExistingReceiptFileName(req.receipt_file_name)
    setExistingStoragePath(req.receipt_storage_path || null)
    setReceiptPreviewUrl(req.receipt_url)
    setReceiptFile(null)
    setOcrText(req.ocr_raw_text || null)
    setOcrConfidence(null)
    setCreateModalOpen(true)
  }

  // Upload de arquivo de recibo + OCR automático
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setReceiptFile(file)
    setReceiptPreviewUrl(URL.createObjectURL(file))
    setOcrProcessing(true)
    setOcrProgressText('Iniciando OCR no comprovante...')

    try {
      const ocrResult = await processRealReceiptOcr(file, (pct, status) => {
        setOcrProgressText(`${status} (${pct}%)`)
      })

      // Pré-preencher campos se extraídos com confiança e se formulário vazio
      if (ocrResult.amount && !formAmount) {
        setFormAmount(ocrResult.amount.toFixed(2))
      }
      if (
        ocrResult.issue_date &&
        (!formExpenseDate || formExpenseDate === new Date().toISOString().split('T')[0])
      ) {
        setFormExpenseDate(ocrResult.issue_date)
      }
      if (ocrResult.merchant_name && !formMerchant) {
        setFormMerchant(ocrResult.merchant_name)
      }
      if (ocrResult.cnpj && !formCnpj) {
        setFormCnpj(ocrResult.cnpj)
      }
      if (ocrResult.ocr_raw_text) {
        setOcrText(ocrResult.ocr_raw_text)
      }
      setOcrConfidence(ocrResult.confidence_score)

      toast({
        title: 'Comprovante lido via OCR! ✨',
        description: `Dados fiscais extraídos com ${ocrResult.confidence_score}% de confiança. Você pode revisar e ajustar livremente.`,
      })
    } catch (err: any) {
      console.warn('Falha no processamento OCR:', err)
      toast({
        title: 'Aviso de OCR',
        description:
          'Não foi possível extrair dados automaticamente do documento. Preencha os campos manualmente.',
      })
    } finally {
      setOcrProcessing(false)
    }
  }

  // Submissão da criação / edição
  const handleSaveRequest = async () => {
    if (!formDescription.trim()) {
      toast({
        title: 'Descrição obrigatória',
        description: 'Informe uma descrição para a despesa avulsa.',
        variant: 'destructive',
      })
      return
    }

    const finalCategory =
      formCategory === 'Outro' && customCategory.trim() ? customCategory.trim() : formCategory

    const parsedAmount = parseFloat(formAmount.replace(/\./g, '').replace(',', '.'))
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'Informe um valor numérico positivo para a despesa.',
        variant: 'destructive',
      })
      return
    }

    if (!formExpenseDate) {
      toast({
        title: 'Data obrigatória',
        description: 'Informe a data da realização da despesa.',
        variant: 'destructive',
      })
      return
    }

    // Se estiver criando, o comprovante é obrigatório
    if (!isEditing && !receiptFile) {
      toast({
        title: 'Comprovante obrigatório',
        description: 'Faça o upload do recibo ou nota fiscal para continuar.',
        variant: 'destructive',
      })
      return
    }

    setSavingRequest(true)
    try {
      let finalReceiptUrl = existingReceiptUrl
      let finalFileName = existingReceiptFileName
      let finalStoragePath = existingStoragePath

      // Se um novo arquivo foi selecionado, fazer upload no Storage
      if (receiptFile) {
        const uploadRes = await standaloneRequestService.uploadReceiptFile(receiptFile)
        finalReceiptUrl = uploadRes.publicUrl
        finalFileName = receiptFile.name
        finalStoragePath = uploadRes.storagePath
      }

      if (isEditing && editingId) {
        const updated = await standaloneRequestService.updateRequest(editingId, {
          description: formDescription.trim(),
          category: finalCategory,
          expense_date: formExpenseDate,
          amount: parsedAmount,
          merchant_name: formMerchant.trim() || null,
          cnpj: formCnpj.trim() || null,
          notes: formNotes.trim() || null,
          receipt_url: finalReceiptUrl,
          receipt_file_name: finalFileName,
          receipt_storage_path: finalStoragePath,
          ocr_raw_text: ocrText,
        })

        if (updated) {
          setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
          toast({
            title: 'Solicitação atualizada! ✅',
            description: `A solicitação "${updated.description}" foi salva com sucesso.`,
          })
        }
      } else {
        const created = await standaloneRequestService.createRequest({
          description: formDescription.trim(),
          category: finalCategory,
          expense_date: formExpenseDate,
          amount: parsedAmount,
          merchant_name: formMerchant.trim(),
          cnpj: formCnpj.trim(),
          notes: formNotes.trim(),
          receipt_url: finalReceiptUrl,
          receipt_file_name: finalFileName,
          receipt_storage_path: finalStoragePath || undefined,
          ocr_raw_text: ocrText || undefined,
        })

        setRequests((prev) => [created, ...prev])
        toast({
          title: 'Solicitação avulsa criada! 🎉',
          description: `Solicitação "${created.description}" (${formatCurrencyBRL(created.amount)}) registrada em triagem.`,
        })
      }

      setCreateModalOpen(false)
      resetForm()
    } catch (err: any) {
      console.error('Erro ao salvar solicitação:', err)
      toast({
        title: 'Erro ao salvar',
        description: err?.message || 'Falha ao salvar a solicitação avulsa.',
        variant: 'destructive',
      })
    } finally {
      setSavingRequest(false)
    }
  }

  // Visualizar comprovante
  const handleViewReceipt = (req: StandaloneRequest) => {
    setViewerDoc({
      url: req.receipt_url,
      fileName: req.receipt_file_name,
      title: `${req.description} (${formatCurrencyBRL(req.amount)})`,
    })
    setViewerOpen(true)
  }

  // Exportar Excel
  const handleExportExcel = (req: StandaloneRequest) => {
    try {
      exportStandaloneRequestToExcel(req)
      toast({
        title: 'Planilha exportada! 📊',
        description: `Planilha CSV da solicitação "${req.description}" gerada com sucesso.`,
      })
    } catch (err: any) {
      toast({
        title: 'Falha ao exportar',
        description: err?.message || 'Não foi possível gerar a planilha.',
        variant: 'destructive',
      })
    }
  }

  // Exportar PDF
  const handleExportPdf = async (req: StandaloneRequest) => {
    try {
      toast({
        title: 'Gerando PDF consolidado...',
        description: 'Processando comprovante e montando o documento oficial.',
      })
      await exportStandaloneRequestPdf(
        req,
        req.user_profile?.full_name || profile?.full_name || user?.email?.split('@')[0],
      )
    } catch (err: any) {
      console.error('Erro ao exportar PDF:', err)
      toast({
        title: 'Falha ao gerar PDF',
        description: err?.message || 'Não foi possível gerar o PDF da solicitação.',
        variant: 'destructive',
      })
    }
  }

  // Abrir modal de envio por e-mail
  const handleOpenEmailModal = (req: StandaloneRequest) => {
    if (!req.receipt_url && !req.receipt_file_name) {
      toast({
        title: 'Comprovante ausente',
        description:
          'A solicitação precisa ter um comprovante anexado para ser enviada por e-mail.',
        variant: 'destructive',
      })
      return
    }

    const solName = req.user_profile?.full_name || profile?.full_name || 'Colaborador'
    const isReenvio = req.status === 'empacotada'

    setSelectedForEmail(req)
    setEmailRecipient(req.report_sent_to || 'financeiro@empresa.com.br')
    setEmailSubject(
      isReenvio
        ? `[REENVIO] Solicitação Avulsa de Reembolso: ${req.description} - ${solName}`
        : `Solicitação Avulsa de Reembolso: ${req.description} - ${solName}`,
    )
    setEmailBody(
      `Olá,\n\nSegue para conferência e reembolso a solicitação avulsa de despesa corporativa:\n\n• Descrição: ${req.description}\n• Categoria: ${req.category}\n• Data: ${formatDateBR(req.expense_date)}\n• Valor: ${formatCurrencyBRL(req.amount)}\n• Estabelecimento: ${req.merchant_name || 'Não informado'}\n• Solicitante: ${solName}\n${req.notes ? `• Observações: ${req.notes}\n` : ''}\nO comprovante fiscal original está consolidado em anexo.\n\nAtenciosamente,\n${solName}`,
    )
    setEmailModalOpen(true)
  }

  // Disparar envio de e-mail (Envio)
  const handleSendEmail = async () => {
    if (!selectedForEmail) return
    if (!emailRecipient.trim()) {
      toast({
        title: 'Destinatário obrigatório',
        description: 'Informe o endereço de e-mail de destino.',
        variant: 'destructive',
      })
      return
    }

    setSendingEmail(true)
    setEmailProgress('Preparando anexo PDF e conectando ao serviço de e-mail...')

    try {
      const solName =
        selectedForEmail.user_profile?.full_name || profile?.full_name || 'Colaborador'
      const sendRes = await reportEmailService.sendReportEmail({
        to: emailRecipient.trim(),
        subject: emailSubject.trim(),
        body: emailBody.trim(),
        standaloneRequest: selectedForEmail,
        collaboratorName: solName,
        attachPdf: true,
        onProgress: (step) => setEmailProgress(step),
      })

      if (sendRes.success) {
        // Atualiza status para 'empacotada' e grava metadados de envio
        const updated = await standaloneRequestService.markReportEmailSent(
          selectedForEmail.id,
          emailRecipient.trim(),
          user ? { id: user.id, name: profile?.full_name || user.email || 'Usuário' } : null,
        )

        if (updated) {
          setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
        }

        toast({
          title: 'Solicitação enviada com sucesso! ✉️',
          description: `E-mail enviado com sucesso para ${emailRecipient}. Status atualizado para "Enviada".`,
        })
        setEmailModalOpen(false)
      } else {
        // Caso provedor não configurado, oferece fallback
        if (sendRes.mailToFallback) {
          toast({
            title: 'Serviço automático indisponível',
            description:
              sendRes.message || 'Abra o cliente de e-mail padrão para concluir o envio.',
          })
          const link = reportEmailService.createMailToLink(
            sendRes.mailToFallback.to,
            sendRes.mailToFallback.subject,
            sendRes.mailToFallback.body,
          )
          window.open(link, '_blank')
        } else {
          toast({
            title: 'Falha no envio de e-mail',
            description: sendRes.message || sendRes.error || 'Erro ao despachar e-mail.',
            variant: 'destructive',
          })
        }
      }
    } catch (err: any) {
      console.error('Erro ao enviar e-mail:', err)
      toast({
        title: 'Erro inesperado no envio',
        description: err?.message || 'Falha ao enviar por e-mail.',
        variant: 'destructive',
      })
    } finally {
      setSendingEmail(false)
      setEmailProgress('')
    }
  }

  // Quitação
  const handleOpenSettleModal = (req: StandaloneRequest) => {
    if (req.status !== 'empacotada') {
      toast({
        title: 'Quitação indisponível',
        description: 'A solicitação precisa ser enviada por e-mail antes de ser quitada.',
        variant: 'destructive',
      })
      return
    }
    setSelectedForSettle(req)
    setSettleModalOpen(true)
  }

  // Reabertura
  const handleOpenReopenModal = (req: StandaloneRequest) => {
    if (!isAdmin) {
      toast({
        title: 'Acesso restrito',
        description: 'Apenas Administradores podem reabrir solicitações enviadas.',
        variant: 'destructive',
      })
      return
    }
    if (req.status !== 'empacotada') {
      toast({
        title: 'Reabertura indisponível',
        description: 'Apenas solicitações com status "Enviada" podem ser reabertas.',
        variant: 'destructive',
      })
      return
    }
    setSelectedForReopen(req)
    setReopenReason('')
    setReopenModalOpen(true)
  }

  const handleConfirmReopen = async () => {
    if (!selectedForReopen) return
    if (!reopenReason.trim() || reopenReason.trim().length < 10) {
      toast({
        title: 'Justificativa obrigatória',
        description:
          'Informe uma justificativa com no mínimo 10 caracteres explicando o motivo da reabertura.',
        variant: 'destructive',
      })
      return
    }

    setReopening(true)
    try {
      const updated = await standaloneRequestService.reopenRequest({
        requestId: selectedForReopen.id,
        reason: reopenReason.trim(),
        user: user ? { id: user.id, name: profile?.full_name || user.email || 'Admin' } : null,
      })

      if (updated) {
        setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
        toast({
          title: 'Solicitação reaberta! 🔄',
          description: `A solicitação "${updated.description}" retornou para "Em Triagem" para correções.`,
        })
        setReopenModalOpen(false)
      }
    } catch (err: any) {
      console.error('Erro ao reabrir solicitação:', err)
      toast({
        title: 'Falha ao reabrir',
        description: err?.message || 'Não foi possível reabrir a solicitação.',
        variant: 'destructive',
      })
    } finally {
      setReopening(false)
    }
  }

  // Exclusão com Desfazer
  const handlePromptDelete = (req: StandaloneRequest) => {
    if (req.status !== 'em_triagem') {
      toast({
        title: 'Exclusão não permitida',
        description: 'Não é permitido excluir uma solicitação já enviada ou quitada.',
        variant: 'destructive',
      })
      return
    }
    setRequestToDelete(req)
    setDeleteConfirmOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!requestToDelete) return
    setDeleting(true)

    try {
      const target = requestToDelete
      await standaloneRequestService.deleteRequest(target.id)

      setRequests((prev) => prev.filter((r) => r.id !== target.id))
      setDeleteConfirmOpen(false)

      // Toast com botão "Desfazer" de 10 segundos
      showStandaloneRequestDeletedUndoToast({
        request: target,
        onRestored: (restored) => {
          setRequests((prev) => [restored, ...prev])
        },
      })
    } catch (err: any) {
      console.error('Erro ao excluir solicitação:', err)
      toast({
        title: 'Falha ao excluir',
        description: err?.message || 'Não foi possível excluir a solicitação.',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
      setRequestToDelete(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 border border-blue-100 shadow-sm">
              <PackageOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  Solicitações Avulsas de Reembolso
                </h2>
                <Badge className="bg-blue-100 text-blue-800 border-0 text-[10px] font-semibold uppercase">
                  Módulo Simplificado
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Reembolsos de equipamentos eventuais, ingressos, materiais ou despesas corporativas
                fora de viagem.
              </p>
            </div>
          </div>

          <Button
            onClick={handleOpenCreateModal}
            className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs sm:text-sm font-semibold gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova Solicitação
          </Button>
        </div>

        {/* Métricas rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mt-6 pt-5 border-t border-slate-100">
          <div
            onClick={() => setStatusFilter('all')}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'border-blue-500 bg-blue-50/50 shadow-sm'
                : 'border-slate-100 bg-slate-50/50 hover:bg-slate-100/50'
            }`}
          >
            <span className="text-[11px] font-medium text-slate-500 block">
              Total de Solicitações
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-xl font-black text-slate-900">{counts.total}</span>
              <span className="text-[11px] font-semibold text-slate-600">
                {formatCurrencyBRL(counts.totalAmount)}
              </span>
            </div>
          </div>

          <div
            onClick={() => setStatusFilter('em_triagem')}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              statusFilter === 'em_triagem'
                ? 'border-blue-500 bg-blue-50/50 shadow-sm'
                : 'border-slate-100 bg-slate-50/50 hover:bg-slate-100/50'
            }`}
          >
            <span className="text-[11px] font-medium text-blue-700 block flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Em Triagem
            </span>
            <span className="text-xl font-black text-blue-900 block mt-1">{counts.emTriagem}</span>
          </div>

          <div
            onClick={() => setStatusFilter('empacotada')}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              statusFilter === 'empacotada'
                ? 'border-emerald-500 bg-emerald-50/50 shadow-sm'
                : 'border-slate-100 bg-slate-50/50 hover:bg-slate-100/50'
            }`}
          >
            <span className="text-[11px] font-medium text-emerald-700 block flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Enviadas
            </span>
            <span className="text-xl font-black text-emerald-900 block mt-1">
              {counts.empacotada}
            </span>
          </div>

          <div
            onClick={() => setStatusFilter('quitada')}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              statusFilter === 'quitada'
                ? 'border-emerald-600 bg-emerald-600/10 shadow-sm'
                : 'border-slate-100 bg-slate-50/50 hover:bg-slate-100/50'
            }`}
          >
            <span className="text-[11px] font-medium text-emerald-800 block flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Quitadas (Reembolsadas)
            </span>
            <span className="text-xl font-black text-emerald-950 block mt-1">{counts.quitada}</span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Buscar por descrição, categoria, fornecedor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-slate-50 border-slate-200 focus:bg-white"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            Status:
          </span>
          <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
            <SelectTrigger className="w-44 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              <SelectItem value="em_triagem">Em Triagem</SelectItem>
              <SelectItem value="empacotada">Enviada</SelectItem>
              <SelectItem value="quitada">Quitada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabela de Solicitações */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-16 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            <span>Carregando solicitações avulsas...</span>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
              <PackageOpen className="w-7 h-7" />
            </div>
            <h3 className="font-bold text-slate-800 text-sm">
              {searchQuery || statusFilter !== 'all'
                ? 'Nenhuma solicitação encontrada para os filtros aplicados'
                : 'Nenhuma solicitação avulsa cadastrada ainda'}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {searchQuery || statusFilter !== 'all'
                ? 'Tente ajustar os termos de pesquisa ou remover os filtros de status.'
                : 'Clique no botão abaixo para registrar o reembolso de um equipamento, ingresso ou outra despesa eventual.'}
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <Button
                onClick={handleOpenCreateModal}
                size="sm"
                className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 mt-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Criar Primeira Solicitação
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Descrição & Fornecedor</th>
                  <th className="py-3.5 px-4">Categoria</th>
                  <th className="py-3.5 px-4">Data Despesa</th>
                  <th className="py-3.5 px-4">Solicitante</th>
                  <th className="py-3.5 px-4 text-right">Valor</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-center">Comprovante</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map((req) => {
                  const isEmTriagem = req.status === 'em_triagem'
                  const isEmpacotada = req.status === 'empacotada'
                  const isQuitada = req.status === 'quitada'

                  return (
                    <tr key={req.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Descrição & Fornecedor */}
                      <td className="py-3.5 px-4 max-w-[240px]">
                        <span
                          className="font-semibold text-slate-900 block truncate"
                          title={req.description}
                        >
                          {req.description}
                        </span>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5 truncate">
                          {req.merchant_name ? (
                            <span>{req.merchant_name}</span>
                          ) : (
                            <span className="italic text-slate-400">Fornecedor não informado</span>
                          )}
                          {req.cnpj && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-[10px]">{req.cnpj}</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Categoria */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className="bg-slate-100 text-slate-700 border-slate-200 text-[11px] font-medium"
                        >
                          {req.category}
                        </Badge>
                      </td>

                      {/* Data Despesa */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-700">
                        {formatDateBR(req.expense_date)}
                      </td>

                      {/* Solicitante */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-700">
                        {req.user_profile?.full_name || 'Solicitante'}
                      </td>

                      {/* Valor */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-right font-black text-slate-900 tabular-nums">
                        {formatCurrencyBRL(req.amount)}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-center">
                        {isEmTriagem && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                            Em Triagem
                          </span>
                        )}
                        {isEmpacotada && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            Enviada
                          </span>
                        )}
                        {isQuitada && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-600 text-white border border-emerald-700 shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Quitada
                          </span>
                        )}
                      </td>

                      {/* Comprovante */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-center">
                        {req.receipt_url ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewReceipt(req)}
                            className="h-8 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 gap-1 text-[11px]"
                            title="Visualizar documento anexado"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Ver Recibo
                          </Button>
                        ) : (
                          <span className="text-slate-400 text-[11px] italic">Sem anexo</span>
                        )}
                      </td>

                      {/* Ações */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Exportar PDF (SEMPRE disponível conforme regra v0.0.27) */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExportPdf(req)}
                            className="h-8 w-8 p-0 text-slate-600 hover:text-blue-700 hover:bg-blue-50"
                            title="Exportar Relatório em PDF"
                          >
                            <FileText className="w-4 h-4" />
                          </Button>

                          {/* Exportar Excel/CSV (SEMPRE disponível) */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExportExcel(req)}
                            className="h-8 w-8 p-0 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50"
                            title="Exportar Planilha Excel / CSV"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                          </Button>

                          {/* Enviar / Reenviar e-mail */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEmailModal(req)}
                            className={`h-8 px-2 gap-1 text-[11px] ${
                              isEmpacotada
                                ? 'text-slate-600 hover:text-blue-700 hover:bg-blue-50'
                                : 'text-blue-700 hover:text-blue-900 bg-blue-50/60 hover:bg-blue-100 font-semibold'
                            }`}
                            title={
                              isEmpacotada
                                ? 'Reenviar prestação de contas por e-mail'
                                : 'Enviar por e-mail'
                            }
                          >
                            <Mail className="w-3.5 h-3.5" />
                            {isEmpacotada ? 'Reenviar' : 'Enviar E-mail'}
                          </Button>

                          {/* Botão Quitar (Apenas se enviada) */}
                          {isEmpacotada && (
                            <Button
                              size="sm"
                              onClick={() => handleOpenSettleModal(req)}
                              className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold gap-1 shadow-sm"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                              Quitar
                            </Button>
                          )}

                          {/* Reabrir (Apenas Admin e se enviada) */}
                          {isEmpacotada && isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenReopenModal(req)}
                              className="h-8 px-2 text-amber-700 hover:text-amber-900 hover:bg-amber-50 text-[11px] gap-1"
                              title="Reabrir solicitação enviada para correções (Admin)"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Reabrir
                            </Button>
                          )}

                          {/* Editar / Excluir (Apenas em triagem) */}
                          {isEmTriagem && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditModal(req)}
                                className="h-8 px-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-[11px]"
                              >
                                Editar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handlePromptDelete(req)}
                                className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                title="Excluir solicitação"
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
      </div>

      {/* ========================================================= */}
      {/* MODAL 1: Nova / Editar Solicitação com OCR */}
      {/* ========================================================= */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="sm:max-w-[620px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <PackageOpen className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900">
                  {isEditing ? 'Editar Solicitação Avulsa' : 'Nova Solicitação Avulsa de Reembolso'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Envie o comprovante fiscal para pré-preenchimento automático via OCR ou preencha
                  manualmente.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Bloco de Upload de Comprovante com OCR */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Comprovante / Nota Fiscal *</span>
                {ocrConfidence !== null && (
                  <span className="text-[11px] font-bold text-blue-600 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-blue-500" />
                    OCR: {ocrConfidence}% confiança
                  </span>
                )}
              </Label>

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all
                  ${receiptPreviewUrl ? 'border-blue-300 bg-blue-50/30' : 'border-slate-300 hover:border-blue-400 bg-slate-50/60'}
                `}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*,application/pdf"
                  className="hidden"
                />

                {ocrProcessing ? (
                  <div className="py-4 space-y-2">
                    <Loader2 className="w-7 h-7 animate-spin text-blue-600 mx-auto" />
                    <p className="text-xs font-semibold text-blue-900">{ocrProgressText}</p>
                    <p className="text-[11px] text-slate-500">
                      Processando documento com o mesmo motor de OCR do Reembolso.ai...
                    </p>
                  </div>
                ) : receiptPreviewUrl ? (
                  <div className="flex items-center justify-between gap-3 text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                        <Receipt className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-900 block truncate">
                          {receiptFile
                            ? receiptFile.name
                            : existingReceiptFileName || 'Comprovante anexado'}
                        </span>
                        <span className="text-[11px] text-emerald-600 font-medium block">
                          Arquivo carregado com sucesso. Clique para substituir.
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        fileInputRef.current?.click()
                      }}
                      className="text-[11px] h-8 shrink-0"
                    >
                      Trocar
                    </Button>
                  </div>
                ) : (
                  <div className="py-3 space-y-1.5">
                    <UploadCloud className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-800">
                      Clique para selecionar o recibo ou nota fiscal (PDF ou Imagem)
                    </p>
                    <p className="text-[11px] text-slate-400">
                      O valor e a data serão extraídos automaticamente pelo OCR e pré-preenchidos.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Descrição / Título */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Descrição da Despesa *</Label>
              <Input
                type="text"
                placeholder="Ex: Mouse ergonômico sem fio, Ingresso conferência Tech, etc."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="text-xs h-9"
              />
            </div>

            {/* Categoria e Data */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-blue-600" />
                  Categoria / Tipo *
                </Label>
                <Select value={formCategory} onValueChange={(val) => setFormCategory(val)}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_SUGGESTIONS.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-600" />
                  Data da Despesa *
                </Label>
                <Input
                  type="date"
                  value={formExpenseDate}
                  onChange={(e) => setFormExpenseDate(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            </div>

            {/* Categoria customizada livre caso tenha escolhido 'Outro' */}
            {formCategory === 'Outro' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Especifique a Categoria Livre
                </Label>
                <Input
                  type="text"
                  placeholder="Ex: Assinatura de Ferramenta, Livro Técnico, etc."
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            )}

            {/* Valor e Fornecedor */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  Valor Total (R$) *
                </Label>
                <Input
                  type="text"
                  placeholder="0,00"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="text-xs font-bold text-emerald-700 h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-slate-500" />
                  Estabelecimento / Fornecedor
                </Label>
                <Input
                  type="text"
                  placeholder="Ex: Kalunga, Sympla, Amazon..."
                  value={formMerchant}
                  onChange={(e) => setFormMerchant(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            </div>

            {/* CNPJ opcional */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                CNPJ do Fornecedor (opcional)
              </Label>
              <Input
                type="text"
                placeholder="00.000.000/0000-00"
                value={formCnpj}
                onChange={(e) => setFormCnpj(e.target.value)}
                className="text-xs h-9 font-mono"
              />
            </div>

            {/* Observações */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                Observações / Justificativa
              </Label>
              <Textarea
                placeholder="Detalhes adicionais sobre a necessidade desta despesa..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="text-xs min-h-[70px]"
              />
            </div>
          </div>

          <DialogFooter className="pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateModalOpen(false)}
              disabled={savingRequest || ocrProcessing}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSaveRequest}
              disabled={savingRequest || ocrProcessing}
              className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs font-semibold gap-1.5"
            >
              {savingRequest ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {isEditing ? 'Salvar Alterações' : 'Criar Solicitação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================= */}
      {/* MODAL 2: Envio por E-mail */}
      {/* ========================================================= */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent className="sm:max-w-[580px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900">
                  {selectedForEmail?.status === 'empacotada'
                    ? 'Reenviar Solicitação por E-mail'
                    : 'Enviar Solicitação por E-mail'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  O relatório com o comprovante fiscal auditado será anexado em formato PDF.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedForEmail && (
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">
                    {selectedForEmail.description}
                  </span>
                  <span className="font-black text-emerald-600">
                    {formatCurrencyBRL(selectedForEmail.amount)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Data: {formatDateBR(selectedForEmail.expense_date)} • Categoria:{' '}
                  {selectedForEmail.category}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Destinatário (E-mail Financeiro) *
                </Label>
                <Input
                  type="email"
                  value={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.value)}
                  placeholder="financeiro@empresa.com.br"
                  className="text-xs h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Assunto</Label>
                <Input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="text-xs h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Mensagem</Label>
                <Textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="text-xs min-h-[140px] font-mono text-[11px]"
                />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  Ao enviar com sucesso, a solicitação ficará com status <strong>Enviada</strong> e
                  liberada para quitação financeira.
                </span>
              </div>

              {sendingEmail && (
                <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-700 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                  <span>{emailProgress || 'Enviando...'}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEmailModalOpen(false)}
              disabled={sendingEmail}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSendEmail}
              disabled={sendingEmail}
              className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs font-semibold gap-1.5"
            >
              {sendingEmail ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {selectedForEmail?.status === 'empacotada' ? 'Reenviar E-mail' : 'Enviar Relatório'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================= */}
      {/* MODAL 3: Quitação de Solicitação Avulsa */}
      {/* ========================================================= */}
      {selectedForSettle && (
        <SettleStandaloneModal
          open={settleModalOpen}
          onOpenChange={setSettleModalOpen}
          currentRequest={selectedForSettle}
          user={user ? { id: user.id, name: profile?.full_name || user.email || 'Usuário' } : null}
          onSuccess={(updated) => {
            setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
            setSelectedForSettle(null)
          }}
        />
      )}

      {/* ========================================================= */}
      {/* MODAL 4: Reabertura Governança (Admin) */}
      {/* ========================================================= */}
      <Dialog open={reopenModalOpen} onOpenChange={setReopenModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900">
                  Reabrir Solicitação Enviada
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Governança corporativa: reabre a solicitação para &quot;Em Triagem&quot;
                  permitindo correções.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedForReopen && (
            <div className="space-y-3 pt-2">
              <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1 border border-slate-200">
                <span className="font-semibold text-slate-800">
                  {selectedForReopen.description}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Valor: {formatCurrencyBRL(selectedForReopen.amount)} • Solicitante:{' '}
                  {selectedForReopen.user_profile?.full_name || 'Solicitante'}
                </span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Motivo da Reabertura (mínimo 10 caracteres) *
                </Label>
                <Textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Explique detalhadamente o motivo da reabertura para auditoria..."
                  className="text-xs min-h-[90px]"
                />
                <span className="text-[10px] text-slate-400 block text-right">
                  {reopenReason.trim().length}/10 caracteres
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReopenModalOpen(false)}
              disabled={reopening}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmReopen}
              disabled={reopening || reopenReason.trim().length < 10}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold gap-1.5"
            >
              {reopening ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Confirmar Reabertura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================= */}
      {/* MODAL 5: Exclusão com Confirmação e Desfazer */}
      {/* ========================================================= */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-slate-900">
              Excluir solicitação avulsa?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-500">
              A solicitação &quot;{requestToDelete?.description}&quot; (
              {formatCurrencyBRL(requestToDelete?.amount || 0)}) será removida. Você terá{' '}
              <strong>10 segundos para desfazer</strong> a ação após confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="text-xs">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmDelete()
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold gap-1.5"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Excluir Solicitação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Visualizador de Comprovante */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[92vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-4 border-b border-slate-100 flex-row items-center justify-between space-y-0">
            <div>
              <DialogTitle className="text-sm font-bold text-slate-900 truncate max-w-md">
                {viewerDoc?.title || viewerDoc?.fileName || 'Visualizar Comprovante'}
              </DialogTitle>
              <DialogDescription className="text-[11px] text-slate-500 truncate max-w-md">
                {viewerDoc?.fileName}
              </DialogDescription>
            </div>
            {viewerDoc?.url && (
              <a
                href={viewerDoc.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium pr-6"
              >
                Abrir original
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </DialogHeader>

          <div className="flex-1 bg-slate-900/5 p-4 overflow-auto flex items-center justify-center min-h-[450px]">
            {viewerDoc?.url?.toLowerCase().endsWith('.pdf') ? (
              <iframe
                src={viewerDoc.url}
                title="Comprovante PDF"
                className="w-full h-[65vh] rounded-lg border border-slate-200 bg-white"
              />
            ) : viewerDoc?.url ? (
              <img
                src={viewerDoc.url}
                alt="Comprovante"
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-sm border border-slate-200 bg-white"
              />
            ) : (
              <div className="text-center p-8 text-xs text-slate-500">
                Documento não encontrado ou indisponível.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
