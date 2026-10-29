import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Trash2,
  Save,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Building2,
  FileText,
  DollarSign,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Tag,
  Lock,
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { Expense, Trip, ExpenseCategory } from '@/types/database'
import { formatCurrencyBRL, formatDateBR, CATEGORY_LABELS } from '@/lib/formatters'
import {
  parseBrazilianReceiptText,
  reprocessAndExtractMultipleReceipts,
  MultiReceiptItem,
} from '@/services/ocrService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Sparkles,
  Calculator,
  Check,
  Info,
  Files,
  Plus,
  X,
  Loader2,
  HelpCircle,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { useToast } from '@/hooks/use-toast'
import { showExpenseDeletedUndoToast } from '@/services/undoService'
import { useAuth } from '@/hooks/use-auth'
import { CreateTripModal } from '@/components/CreateTripModal'
import { DocumentViewer } from '@/components/DocumentViewer'
import { TripSelectorWithUnlock } from '@/components/TripSelectorWithUnlock'
import { ReopenTripModal } from '@/components/ReopenTripModal'

export default function TriagePage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, loading: authLoading } = useAuth()

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  // Mobile navigation tab state
  const [activeTabMobile, setActiveTabMobile] = useState<'document' | 'form'>('document')

  // Form edit state for current expense
  const [issueDate, setIssueDate] = useState('')
  const [issueTime, setIssueTime] = useState('')
  const [merchantName, setMerchantName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('outros')
  const [amountStr, setAmountStr] = useState('')
  const [assignedTripId, setAssignedTripId] = useState<string>('')

  // Hybrid points / miles state
  const [useMiles, setUseMiles] = useState(false)
  const [cashAmountStr, setCashAmountStr] = useState('')
  const [pointsUsedStr, setPointsUsedStr] = useState('')
  const [mileRateStr, setMileRateStr] = useState('0.017')

  // Multi-receipt and PDF pages state
  const [docPageInfo, setDocPageInfo] = useState<{ isPdf: boolean; totalPages: number }>({
    isPdf: false,
    totalPages: 1,
  })

  // Estabiliza o callback para o DocumentViewer não reexecutar useEffect a cada render da página
  const handleDocumentLoaded = useCallback((info: { isPdf: boolean; totalPages: number }) => {
    setDocPageInfo((prev) => {
      if (prev.isPdf === info.isPdf && prev.totalPages === info.totalPages) {
        return prev
      }
      return info
    })
  }, [])
  // Track decision per expense ID: 'single' | 'multiple' | null
  const [multiPageDecision, setMultiPageDecision] = useState<Record<string, 'single' | 'multiple'>>(
    {},
  )
  const [multiReceiptActive, setMultiReceiptActive] = useState(false)
  const [multiReceiptItems, setMultiReceiptItems] = useState<MultiReceiptItem[]>([])
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessingProgress, setReprocessingProgress] = useState(0)
  const [reprocessingStatus, setReprocessingStatus] = useState('')

  // Dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)
  const [tripToUnlock, setTripToUnlock] = useState<Trip | null>(null)
  const [unlockModalOpen, setUnlockModalOpen] = useState(false)

  const loadData = async () => {
    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    setLoading(true)
    try {
      const allTrips = await storageService.listTrips()
      const allExpenses = await storageService.listExpenses()
      // Critério defensivo da fila de triagem:
      // Pendente de triagem = recibo sem conferência manual completa (!e.audit_manual_checked) OU sem viagem vinculada (!e.trip_id).
      // O estado vazio só é exibido quando realmente não houver despesas pendentes por esse critério.
      const listToReview = allExpenses
        .filter((e) => !e.audit_manual_checked || !e.trip_id)
        .slice()
        .sort((a, b) => {
          // Receipts that have extracted amounts or dates should be prioritized or in natural order
          return a.file_name.localeCompare(b.file_name)
        })

      setTrips(allTrips)
      setExpenses(listToReview)
      setCurrentIndex(0)
    } catch (err: any) {
      console.error('Falha ao carregar dados da triagem:', err)
      toast({
        title: 'Erro ao carregar triagem',
        description: `Não foi possível carregar os comprovantes: ${err?.message || 'erro de conexão'}`,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    loadData()
  }, [authLoading, user?.id])

  // Sync current expense to form inputs
  const currentExpense = expenses[currentIndex] || null

  useEffect(() => {
    if (!currentExpense) {
      setIssueDate('')
      setIssueTime('')
      setMerchantName('')
      setCnpj('')
      setCategory('outros')
      setAmountStr('')
      setAssignedTripId('')
      setUseMiles(false)
      setCashAmountStr('')
      setPointsUsedStr('')
      setMileRateStr('0.017')
      return
    }

    // If the record has raw OCR text, extract any fields that might be missing or generic
    const parsedFallback =
      currentExpense.ocr_raw_text &&
      currentExpense.ocr_raw_text !== 'Arquivo sem texto extraído' &&
      currentExpense.ocr_raw_text !== 'Nenhum texto legível detectado.'
        ? parseBrazilianReceiptText(currentExpense.ocr_raw_text, currentExpense.file_name)
        : null

    // Determine issue_date: prefer stored date unless it matches upload fallback (e.g. today) and fallback has better date
    const initialDate = currentExpense.issue_date || parsedFallback?.issue_date || ''
    setIssueDate(initialDate)

    // Determine issue_time
    const initialTime = currentExpense.issue_time || parsedFallback?.issue_time || ''
    setIssueTime(initialTime)

    // Determine merchant_name: clean up any legacy corrupted values (e.g. "PÁGINA 1] ---")
    const isCorruptedMerchant = (val: string) => {
      const v = val.toLowerCase()
      return (
        v.includes('página') ||
        v.includes('pagina') ||
        v.startsWith('---') ||
        v.startsWith('[') ||
        v.includes('---') ||
        v.includes(']')
      )
    }

    let initialMerchant = currentExpense.merchant_name || ''
    if (isCorruptedMerchant(initialMerchant)) {
      // Discard invalid page marker stored before v0.0.64
      initialMerchant = ''
    }

    if (
      (!initialMerchant || initialMerchant === 'Estabelecimento a identificar') &&
      parsedFallback?.merchant_name &&
      !isCorruptedMerchant(parsedFallback.merchant_name)
    ) {
      initialMerchant = parsedFallback.merchant_name
    }
    setMerchantName(initialMerchant)

    // Determine CNPJ: prefer stored, fallback to OCR parsed
    const initialCnpj = currentExpense.cnpj || parsedFallback?.cnpj || ''
    setCnpj(initialCnpj)

    // Determine category: if stored is 'outros' and fallback classified a specific one
    let initialCategory = currentExpense.category || 'outros'
    if (
      initialCategory === 'outros' &&
      parsedFallback?.category &&
      parsedFallback.category !== 'outros'
    ) {
      initialCategory = parsedFallback.category
    }
    setCategory(initialCategory)

    // Determine amount: if stored is 0 or null, check fallback
    let initialAmount =
      currentExpense.amount !== null &&
      currentExpense.amount !== undefined &&
      currentExpense.amount > 0
        ? String(currentExpense.amount)
        : ''
    if (!initialAmount && parsedFallback?.amount && parsedFallback.amount > 0) {
      initialAmount = String(parsedFallback.amount)
    }
    setAmountStr(initialAmount)

    // Detecção híbrida de pontos/milhas
    const detectedPoints = parsedFallback?.points_applied || 0
    if (detectedPoints > 0) {
      setUseMiles(initialCategory === 'transporte')
      setPointsUsedStr(String(detectedPoints))
      setCashAmountStr(initialAmount)
      setMileRateStr('0.017')
    } else {
      setUseMiles(false)
      setPointsUsedStr('')
      setCashAmountStr(initialAmount)
      setMileRateStr('0.017')
    }

    // Reset multi-receipt panel states for newly selected expense
    setMultiReceiptActive(false)
    setMultiReceiptItems([])
    setDocPageInfo({ isPdf: false, totalPages: 1 })

    // Assigned trip: preserve expense trip_id or select first available trip
    setAssignedTripId(currentExpense.trip_id || (trips[0]?.id ?? ''))
  }, [currentIndex, currentExpense, trips])

  // Triggers reprocessAndExtractMultipleReceipts
  const handleTriggerReprocessMultiple = async () => {
    if (!currentExpense) return
    setReprocessing(true)
    setReprocessingProgress(5)
    setReprocessingStatus('Iniciando análise de múltiplos comprovantes...')
    setMultiReceiptActive(true)

    try {
      const res = await reprocessAndExtractMultipleReceipts(
        currentExpense.file_url,
        currentExpense.file_name,
        currentExpense.ocr_raw_text,
        (progress, status) => {
          setReprocessingProgress(progress)
          setReprocessingStatus(status)
        },
      )

      setMultiReceiptItems(res.items)
      if (res.totalSum > 0) {
        setAmountStr(res.totalSum.toFixed(2))
      }

      toast({
        title: 'Múltiplos recibos detectados!',
        description: `${res.items.length} comprovante(s) identificados com soma de ${formatCurrencyBRL(res.totalSum)}.`,
      })
    } catch (err: any) {
      console.warn('Erro ao reprocessar múltiplos recibos:', err)
      toast({
        title: 'Atenção ao reprocessar',
        description:
          err?.message ||
          'Não foi possível extrair automaticamente todos os recibos. Você pode adicioná-los manualmente.',
        variant: 'destructive',
      })
      // Provide fallback items so user can type them manually
      setMultiReceiptItems([
        { id: 'p1', label: 'Item 1', amount: parseFloat(amountStr) || 0 },
        { id: 'p2', label: 'Item 2', amount: 0 },
      ])
    } finally {
      setReprocessing(false)
    }
  }

  // Multi-receipt helper: calculate current total
  const multiReceiptCalculatedTotal = useMemo(() => {
    return Number(
      multiReceiptItems.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0).toFixed(2),
    )
  }, [multiReceiptItems])

  // Check if save is blocked by unconfirmed multi-page prompt
  const currentExpenseDecision = currentExpense ? multiPageDecision[currentExpense.id] : null
  const hasPage2InOcr = Boolean(
    currentExpense?.ocr_raw_text &&
    (currentExpense.ocr_raw_text.includes('--- [PÁGINA 2] ---') ||
      currentExpense.ocr_raw_text.includes('--- [PAGINA 2] ---') ||
      currentExpense.ocr_raw_text.includes('[PÁGINA 2]') ||
      currentExpense.ocr_raw_text.includes('[PAGINA 2]')),
  )
  const isMultiPagePdf = (docPageInfo.isPdf && docPageInfo.totalPages > 1) || hasPage2InOcr
  const effectiveTotalPages =
    docPageInfo.totalPages > 1 ? docPageInfo.totalPages : hasPage2InOcr ? 2 : 1
  const isMultiPagePendingDecision =
    isMultiPagePdf && !currentExpenseDecision && !multiReceiptActive

  // Duplicate match details if flagged
  const isDuplicate = currentExpense?.audit_flags?.includes('comprovante_duplicado') || false
  const duplicateReference = useMemo(() => {
    if (!currentExpense || !isDuplicate) return null
    // Procura na lista de despesas carregadas aquela que deu match
    const otherExpenses = expenses.filter((e) => e.id !== currentExpense.id)
    for (const other of otherExpenses) {
      if (
        Math.abs(other.amount - currentExpense.amount) < 0.01 &&
        other.issue_date === currentExpense.issue_date
      ) {
        return other
      }
    }
    return null
  }, [currentExpense, isDuplicate, expenses])

  const handleSave = async (advanceNext = false) => {
    if (!currentExpense) return

    if (isMultiPagePendingDecision) {
      toast({
        title: 'Confirmação necessária',
        description: `Este arquivo possui ${effectiveTotalPages} páginas. Escolha se deseja manter como recibo único ou somar múltiplos recibos antes de salvar.`,
        variant: 'destructive',
      })
      return
    }

    const parsedAmount = parseFloat(amountStr.replace(',', '.'))
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'Por favor, informe um valor monetário positivo.',
        variant: 'destructive',
      })
      return
    }

    try {
      const auditorName =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email?.split('@')[0] ||
        'Auditor Corporativo'

      const updated = await storageService.updateExpense(currentExpense.id, {
        issue_date: issueDate,
        issue_time: issueTime || null,
        merchant_name: merchantName,
        cnpj: cnpj || null,
        category,
        amount: parsedAmount,
        trip_id: assignedTripId || null,
        is_verified: true,
        audit_manual_checked: true,
        audit_manual_checked_at: new Date().toISOString(),
        audit_manual_checked_by_id: user?.id || null,
        audit_manual_checked_by_name: auditorName,
        audit_status: 'conforme',
      })

      toast({
        title: 'Comprovante verificado e conferido!',
        description: `Dados de ${merchantName} confirmados e marcados como conformes na auditoria.`,
      })

      // Update in local state
      const updatedList = expenses.map((e) =>
        e.id === currentExpense.id ? { ...e, ...updated } : e,
      )
      setExpenses(updatedList)

      if (advanceNext) {
        if (currentIndex < expenses.length - 1) {
          setCurrentIndex((prev) => prev + 1)
        } else {
          // Finished all receipts
          toast({
            title: 'Triagem completa!',
            description: 'Todos os comprovantes foram verificados com sucesso.',
          })
          if (assignedTripId) {
            navigate(`/trips/${assignedTripId}`)
          } else {
            navigate('/')
          }
        }
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    }
  }

  const [isDeleting, setIsDeleting] = useState(false)

  // Check if current assigned trip is locked
  const assignedTrip = trips.find((t) => t.id === assignedTripId)
  const isAssignedTripLocked = assignedTrip ? storageService.isTripLocked(assignedTrip) : false

  const handleDeleteExpense = async () => {
    if (!currentExpense) return
    const deletedExp = { ...currentExpense }
    setIsDeleting(true)
    try {
      // Fecha o diálogo de confirmação imediatamente para liberar a UI
      setDeleteDialogOpen(false)

      // Atualiza o estado local imediatamente, avançando para o próximo item
      const remaining = expenses.filter((e) => e.id !== deletedExp.id)
      setExpenses(remaining)

      if (remaining.length === 0) {
        navigate('/')
      } else if (currentIndex >= remaining.length) {
        setCurrentIndex(Math.max(0, remaining.length - 1))
      }

      // Chama o serviço de exclusão (não depende do preview nem bloqueia o avanço da UI)
      try {
        await storageService.deleteExpense(deletedExp.id, false)
      } catch (err: any) {
        console.warn('Erro ao excluir no banco/storage:', err)
        toast({
          title: 'Aviso ao excluir',
          description: storageService.formatDatabaseError(err) || 'Item removido da visualização.',
          variant: 'destructive',
        })
      }

      showExpenseDeletedUndoToast({
        expense: deletedExp,
        onRestored: (restored) => {
          // Volta para a fila de triagem se ainda for pendente pelo critério defensivo
          if (!restored.audit_manual_checked || !restored.trip_id) {
            setExpenses((prev) => [restored, ...prev])
          }
        },
      })
    } catch (unexpectedErr: any) {
      console.error('Erro inesperado no fluxo de exclusão:', unexpectedErr)
      toast({
        title: 'Erro ao excluir',
        description: 'Ocorreu um erro ao processar a exclusão.',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="p-12 text-center text-slate-500">
        Carregando comprovantes para conferência OCR...
      </div>
    )
  }

  if (!currentExpense || expenses.length === 0) {
    return (
      <Card className="border border-slate-200 p-12 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">
          Nenhum comprovante pendente de triagem!
        </h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-5">
          Todos os recibos enviados foram conferidos e validados pela equipe de auditoria
          corporativa.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => navigate('/')} className="text-xs">
            Ir ao Dashboard
          </Button>
          <Button onClick={() => navigate('/upload')} className="bg-[#1e40af] text-white text-xs">
            Upload de Novos Recibos
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top Header Row with Progress and Navigation */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-sm">
            {currentIndex + 1}
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
              Triagem de Comprovantes ({currentIndex + 1} de {expenses.length})
            </h2>
            <p className="text-xs text-slate-500">
              Arquivo:{' '}
              <span className="font-medium text-slate-700">{currentExpense.file_name}</span>
            </p>
          </div>
        </div>

        {/* Counter and Navigation Arrows */}
        <div className="flex items-center gap-2">
          {/* Mobile view switcher */}
          <div className="flex md:hidden border border-slate-200 rounded-lg overflow-hidden mr-2">
            <button
              onClick={() => setActiveTabMobile('document')}
              className={`px-3 py-1.5 text-xs font-semibold ${
                activeTabMobile === 'document'
                  ? 'bg-[#1e40af] text-white'
                  : 'bg-white text-slate-600'
              }`}
            >
              Documento
            </button>
            <button
              onClick={() => setActiveTabMobile('form')}
              className={`px-3 py-1.5 text-xs font-semibold ${
                activeTabMobile === 'form' ? 'bg-[#1e40af] text-white' : 'bg-white text-slate-600'
              }`}
            >
              Formulário
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            className="h-8 px-2 text-xs gap-1"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Anterior</span>
          </Button>

          <span className="text-xs font-semibold text-slate-600 px-2 tabular-nums">
            {currentIndex + 1} / {expenses.length}
          </span>

          <Button
            variant="outline"
            size="sm"
            disabled={currentIndex === expenses.length - 1}
            onClick={() => setCurrentIndex((prev) => Math.min(expenses.length - 1, prev + 1))}
            className="h-8 px-2 text-xs gap-1"
          >
            <span className="hidden sm:inline">Próximo</span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Split-Screen 50% / 50% */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* LEFT PANEL: Document Viewer */}
        <div
          className={`space-y-2 ${activeTabMobile === 'document' ? 'block' : 'hidden md:block'}`}
        >
          {/* Sticky Duplicate Banner if flagged */}
          {isDuplicate && (
            <div className="bg-amber-100 border border-amber-300 rounded-lg p-3 text-amber-950 text-xs font-semibold flex items-center justify-between gap-2 shadow-xs animate-shake">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  ⚠️ Atenção: Possível duplicata detectada. Já existe despesa em{' '}
                  {formatDateBR(duplicateReference?.issue_date || currentExpense.issue_date)} —{' '}
                  {duplicateReference?.merchant_name || currentExpense.merchant_name} (
                  {formatCurrencyBRL(duplicateReference?.amount || currentExpense.amount)}).
                </span>
              </div>
            </div>
          )}
          {/* Document Viewer Frame with full PDF / Image / Fallback support */}
          <DocumentViewer
            fileName={currentExpense.file_name}
            fileUrl={currentExpense.file_url}
            ocrRawText={currentExpense.ocr_raw_text}
            onDocumentLoaded={handleDocumentLoaded}
          />
        </div>

        {/* RIGHT PANEL: Confirmation Form */}
        <div className={`space-y-4 ${activeTabMobile === 'form' ? 'block' : 'hidden md:block'}`}>
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardContent className="p-5 sm:p-6 space-y-4">
              {/* REGRA 1: Pergunta Automática para PDF > 1 página em destaque no topo */}
              {isMultiPagePdf && !currentExpenseDecision && !multiReceiptActive && (
                <div className="p-4 rounded-xl border-2 border-indigo-400 bg-indigo-50/90 text-indigo-950 space-y-3 shadow-xs">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Files className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-indigo-950">
                        📄 Este arquivo possui {effectiveTotalPages} páginas
                      </h4>
                      <p className="text-xs text-indigo-800 leading-relaxed">
                        Trata-se de um <strong>recibo único</strong> (com várias páginas de um mesmo
                        documento) ou de <strong>múltiplos recibos</strong> que devem ser somados?
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setMultiPageDecision((prev) => ({
                          ...prev,
                          [currentExpense.id]: 'single',
                        }))
                        toast({
                          title: 'Recibo Único confirmado',
                          description:
                            'Mantendo o valor único para todas as páginas deste documento.',
                        })
                      }}
                      className="text-xs bg-white text-slate-700 hover:bg-slate-100 border-indigo-200 font-semibold flex-1"
                    >
                      Recibo Único (Manter valor único)
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setMultiPageDecision((prev) => ({
                          ...prev,
                          [currentExpense.id]: 'multiple',
                        }))
                        handleTriggerReprocessMultiple()
                      }}
                      className="text-xs bg-indigo-700 hover:bg-indigo-800 text-white font-semibold flex-1 gap-1.5 shadow-xs"
                    >
                      <Files className="w-3.5 h-3.5" />
                      Múltiplos Recibos (Reprocessar e Somar)
                    </Button>
                  </div>
                </div>
              )}

              {/* Progress bar when reprocessing */}
              {reprocessing && (
                <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/70 space-y-2">
                  <div className="flex items-center justify-between text-xs text-indigo-900 font-medium">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                      {reprocessingStatus || 'Processando páginas...'}
                    </span>
                    <span className="tabular-nums font-bold">{reprocessingProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-indigo-200/60 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 transition-all duration-300 rounded-full"
                      style={{ width: `${reprocessingProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  Conferência dos Dados Extraídos
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Revise e confirme os campos fiscais lidos pelo OCR antes de salvar.
                </p>
              </div>

              {/* Data Real de Emissão e Hora */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="issue_date"
                    className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                  >
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    Data Real de Emissão *
                  </Label>
                  <Input
                    id="issue_date"
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="text-sm bg-slate-50 focus:bg-white"
                    required
                  />
                  <p className="text-[11px] text-slate-400">Data fiscal lida do comprovante.</p>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="issue_time"
                    className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                  >
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    Hora de Emissão (opcional)
                  </Label>
                  <Input
                    id="issue_time"
                    type="time"
                    value={issueTime}
                    onChange={(e) => setIssueTime(e.target.value)}
                    className="text-sm bg-slate-50 focus:bg-white"
                  />
                  <p className="text-[11px] text-slate-400">Hora extraída pelo OCR (ex: 20:47).</p>
                </div>
              </div>

              {/* Estabelecimento */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="merchant"
                  className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                >
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  Estabelecimento / Razão Social *
                </Label>
                <Input
                  id="merchant"
                  value={merchantName}
                  onChange={(e) => setMerchantName(e.target.value)}
                  placeholder="Ex: Posto Ipiranga, Uber, Hotel Ibis..."
                  className="text-sm bg-slate-50 focus:bg-white font-medium"
                  required
                />
                {merchantName === 'Estabelecimento a identificar' && (
                  <p className="text-[11px] text-amber-600 font-medium">
                    ⚠️ Nome não detectado automaticamente pelo OCR. Por favor confirme com o
                    documento.
                  </p>
                )}
              </div>

              {/* CNPJ */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="cnpj"
                  className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  CNPJ (opcional)
                </Label>
                <Input
                  id="cnpj"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className="text-sm bg-slate-50 focus:bg-white"
                />
              </div>

              {/* Categoria */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-slate-400" />
                  Categoria de Despesa *
                </Label>
                <Select
                  value={category}
                  onValueChange={(val) => setCategory(val as ExpenseCategory)}
                >
                  <SelectTrigger className="text-sm bg-slate-50 focus:bg-white">
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

              {/* Seção Condicional Híbrida: Passagens / Transporte pagos com Milhas/Pontos + Dinheiro */}
              {category === 'transporte' && (
                <div className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="use-miles-switch"
                        className="text-xs font-bold text-purple-950 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                        Usar Pontos/Milhas
                      </Label>
                      <p className="text-[11px] text-purple-700">
                        Ative caso a passagem tenha sido paga combinando pontos e taxa/dinheiro
                      </p>
                    </div>
                    <Switch
                      id="use-miles-switch"
                      checked={useMiles || parseFloat(pointsUsedStr) > 0}
                      onCheckedChange={(checked) => {
                        setUseMiles(checked)
                        if (!checked) {
                          setPointsUsedStr('')
                        } else if (!cashAmountStr) {
                          setCashAmountStr(amountStr)
                        }
                      }}
                    />
                  </div>

                  {(useMiles || parseFloat(pointsUsedStr) > 0) && (
                    <div className="space-y-3 pt-1">
                      {/* 3 campos lado a lado */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-700">
                            Valor em Dinheiro / Taxas (R$)
                          </Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                              R$
                            </span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={cashAmountStr}
                              onChange={(e) => setCashAmountStr(e.target.value)}
                              placeholder="0.00"
                              className="pl-8 text-xs font-semibold tabular-nums bg-white"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-700">
                            Pontos Utilizados
                          </Label>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            value={pointsUsedStr}
                            onChange={(e) => setPointsUsedStr(e.target.value)}
                            placeholder="Ex: 48100"
                            className="text-xs font-semibold tabular-nums bg-white"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-700">
                            Valor da Milha (R$)
                          </Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                              R$
                            </span>
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={mileRateStr}
                              onChange={(e) => setMileRateStr(e.target.value)}
                              placeholder="0.017"
                              className="pl-8 text-xs font-semibold tabular-nums bg-white"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Banner de Valor Sugerido com Botão de Aplicação */}
                      {(() => {
                        const parsedCash = parseFloat(cashAmountStr.replace(',', '.')) || 0
                        const parsedPts = parseFloat(pointsUsedStr.replace(',', '.')) || 0
                        const parsedRate = parseFloat(mileRateStr.replace(',', '.')) || 0.017
                        const suggested = parseFloat(
                          (parsedCash + parsedPts * parsedRate).toFixed(2),
                        )

                        return (
                          <div className="p-3 rounded-lg bg-white border border-purple-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2">
                              <Calculator className="w-4 h-4 text-purple-600 shrink-0" />
                              <div className="text-xs text-slate-700">
                                <span className="font-medium">Valor Sugerido: </span>
                                <strong className="text-purple-900 font-extrabold text-sm tabular-nums">
                                  {formatCurrencyBRL(suggested)}
                                </strong>
                                <span className="text-slate-600 ml-1">. Deseja aplicar?</span>
                                <span className="text-[11px] text-slate-500 block sm:inline sm:ml-1.5">
                                  ({formatCurrencyBRL(parsedCash)} +{' '}
                                  {parsedPts.toLocaleString('pt-BR')} pts × R${' '}
                                  {parsedRate.toFixed(3)})
                                </span>
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                setAmountStr(suggested.toFixed(2))
                                toast({
                                  title: 'Valor sugerido aplicado!',
                                  description: `Valor total da despesa atualizado para ${formatCurrencyBRL(suggested)}.`,
                                })
                              }}
                              className="bg-purple-700 hover:bg-purple-800 text-white text-xs h-8 px-3 gap-1 shrink-0 font-semibold"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Aplicar</span>
                            </Button>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* Valor Total (R$) + REGRA 2: Botão Manual Sempre Disponível */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="amount"
                    className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                  >
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    Valor Total da Despesa (R$) *
                  </Label>

                  {/* REGRA 2: Botão / Switch Manual Sempre Disponível */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={reprocessing}
                    onClick={() => {
                      if (!multiReceiptActive) {
                        handleTriggerReprocessMultiple()
                      } else {
                        setMultiReceiptActive(false)
                      }
                    }}
                    className={`h-7 px-2.5 text-xs font-semibold gap-1.5 transition-colors ${
                      multiReceiptActive
                        ? 'text-indigo-700 bg-indigo-50 border border-indigo-200'
                        : 'text-slate-600 hover:text-indigo-700 hover:bg-indigo-50'
                    }`}
                  >
                    <Files className="w-3.5 h-3.5 text-indigo-600" />
                    <span>
                      {multiReceiptActive
                        ? 'Ocultar Múltiplos Recibos'
                        : 'Múltiplos Recibos no Arquivo (Extrair e Somar)'}
                    </span>
                  </Button>
                </div>

                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    R$
                  </span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    className="pl-9 text-base font-bold text-slate-900 bg-slate-50 focus:bg-white tabular-nums"
                    required
                  />
                </div>
              </div>

              {/* REGRA 3: Painel de Conferência das Parcelas Somadas */}
              {multiReceiptActive && (
                <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Files className="w-4 h-4 text-indigo-700" />
                      <span className="text-xs font-bold text-indigo-950">
                        Comprovantes Detectados ({multiReceiptItems.length})
                      </span>
                    </div>
                    <span className="text-xs font-extrabold text-indigo-900 tabular-nums">
                      Soma: {formatCurrencyBRL(multiReceiptCalculatedTotal)}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {multiReceiptItems.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="flex items-center gap-2 bg-white p-2 rounded-lg border border-indigo-100 shadow-2xs"
                      >
                        <Input
                          type="text"
                          value={item.label}
                          onChange={(e) => {
                            const newItems = [...multiReceiptItems]
                            newItems[idx] = { ...item, label: e.target.value }
                            setMultiReceiptItems(newItems)
                          }}
                          placeholder="Ex: Página 1, Cupom 1"
                          className="h-8 text-xs font-medium text-slate-700 w-1/2"
                        />

                        <div className="relative w-1/2">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                            R$
                          </span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.amount === 0 ? '' : item.amount}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0
                              const newItems = [...multiReceiptItems]
                              newItems[idx] = { ...item, amount: val }
                              setMultiReceiptItems(newItems)
                            }}
                            placeholder="0.00"
                            className="h-8 pl-7 text-xs font-bold text-slate-900 tabular-nums"
                          />
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const newItems = multiReceiptItems.filter((_, i) => i !== idx)
                            setMultiReceiptItems(newItems)
                          }}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                          title="Excluir comprovante"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-1 border-t border-indigo-100">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const nextIndex = multiReceiptItems.length + 1
                        setMultiReceiptItems([
                          ...multiReceiptItems,
                          {
                            id: `custom-${Date.now()}`,
                            label: `Recibo ${nextIndex}`,
                            amount: 0,
                          },
                        ])
                      }}
                      className="h-8 text-xs text-indigo-700 border-indigo-200 hover:bg-indigo-100/50 gap-1 w-full sm:w-auto"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Adicionar recibo manualmente</span>
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setAmountStr(multiReceiptCalculatedTotal.toFixed(2))
                        toast({
                          title: 'Soma total aplicada!',
                          description: `Valor total atualizado para ${formatCurrencyBRL(multiReceiptCalculatedTotal)}.`,
                        })
                      }}
                      className="h-8 text-xs bg-indigo-700 hover:bg-indigo-800 text-white font-semibold gap-1.5 w-full sm:w-auto"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        Aplicar Soma Total ({formatCurrencyBRL(multiReceiptCalculatedTotal)})
                      </span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Viagem Vinculada */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                    Viagem Vinculada *
                  </Label>
                  <button
                    type="button"
                    onClick={() => setCreateTripOpen(true)}
                    className="text-[11px] text-[#1e40af] hover:underline font-semibold"
                  >
                    + Criar nova viagem
                  </button>
                </div>
                <TripSelectorWithUnlock
                  value={assignedTripId}
                  onChange={(newId) => {
                    if (newId === 'new') {
                      setCreateTripOpen(true)
                    } else {
                      setAssignedTripId(newId)
                    }
                  }}
                  trips={trips}
                  allowCreateNew={true}
                  createNewText="+ Criar nova viagem"
                  placeholder="Selecione a viagem"
                  className="w-full text-sm h-10 bg-slate-50 focus:bg-white"
                  onUnlockClick={(tr) => {
                    setTripToUnlock(tr)
                    setUnlockModalOpen(true)
                  }}
                />
                {isAssignedTripLocked && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                    ⚠️ A viagem selecionada está com status bloqueado para adição/edição de
                    despesas. Desbloqueie a viagem pelo cadeado ou selecione outra viagem aberta.
                  </p>
                )}
              </div>

              {/* Action Buttons Row */}
              <div className="pt-4 border-t border-slate-200 space-y-2">
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  {isAssignedTripLocked ? (
                    <div
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-100 border border-slate-200 text-slate-500 text-xs font-medium cursor-not-allowed select-none"
                      title="Viagem fechada — exclusão bloqueada"
                    >
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                      <span>Viagem fechada — exclusão bloqueada</span>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDeleteDialogOpen(true)}
                      className="w-full sm:w-auto text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Descartar / Excluir</span>
                    </Button>
                  )}

                  <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleSave(false)}
                      className="w-1/2 sm:w-auto text-xs gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Salvar</span>
                    </Button>

                    <Button
                      type="button"
                      onClick={() => handleSave(true)}
                      className="w-1/2 sm:w-auto bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 font-semibold"
                    >
                      <span>Salvar & Próximo</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Direct link to trip audit if linked */}
                {assignedTripId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/trips/${assignedTripId}`)}
                    className="w-full text-xs text-slate-500 hover:text-blue-700 mt-2"
                  >
                    Ir para Auditoria desta Viagem (
                    {trips.find((t) => t.id === assignedTripId)?.destination || 'Viagem'})
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete / Discard Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Descartar e Excluir Comprovante?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-xs sm:text-sm space-y-2">
              <p>
                Tem certeza que deseja descartar este comprovante{' '}
                <strong>"{currentExpense.file_name}"</strong> (
                {formatCurrencyBRL(currentExpense.amount)} — {currentExpense.merchant_name})?
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900 text-xs space-y-1">
                <p className="font-semibold">Possibilidade de desfazer:</p>
                <p>
                  Esta ação excluirá os dados extraídos pelo OCR da fila de triagem. Você terá{' '}
                  <strong>10 segundos</strong> para desfazer a ação pelo aviso na tela.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteExpense}
              disabled={isDeleting}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isDeleting ? 'Excluindo...' : 'Sim, Excluir Comprovante e Arquivo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Trip Modal */}
      <CreateTripModal
        open={createTripOpen}
        onOpenChange={setCreateTripOpen}
        onCreated={(newTrip) => {
          setTrips((prev) => [newTrip, ...prev])
          setAssignedTripId(newTrip.id)
        }}
      />

      {/* Modal Compartilhado de Reabertura de Viagem */}
      <ReopenTripModal
        open={unlockModalOpen}
        onOpenChange={(open) => {
          setUnlockModalOpen(open)
          if (!open) setTripToUnlock(null)
        }}
        trip={tripToUnlock}
        onSuccess={(reopenedTrip) => {
          setTrips((prev) => prev.map((t) => (t.id === reopenedTrip.id ? reopenedTrip : t)))
          setAssignedTripId(reopenedTrip.id)
          toast({
            title: 'Viagem reaberta com sucesso!',
            description: `A viagem "${reopenedTrip.destination}" está desbloqueada e pronta para receber este comprovante.`,
          })
        }}
      />
    </div>
  )
}
