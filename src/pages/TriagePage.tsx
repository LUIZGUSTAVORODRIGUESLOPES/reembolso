import React, { useState, useEffect } from 'react'
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
import { parseBrazilianReceiptText } from '@/services/ocrService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
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

  // Dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)

  const loadData = async () => {
    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    setLoading(true)
    try {
      const allTrips = await storageService.listTrips()
      const allExpenses = await storageService.listExpenses()
      // Filter unverified first, or fall back to all if all are verified
      const unverified = allExpenses.filter((e) => !e.is_verified)
      // Sort with oldest created first so receipts upload sequence is respected
      const listToReview = (unverified.length > 0 ? unverified : allExpenses)
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
      return
    }

    // If the record has raw OCR text, extract any fields that might be missing or generic
    const parsedFallback =
      currentExpense.ocr_raw_text &&
      currentExpense.ocr_raw_text !== 'Arquivo sem texto extraído' &&
      currentExpense.ocr_raw_text !== 'Nenhum texto legível detectado.'
        ? parseBrazilianReceiptText(currentExpense.ocr_raw_text)
        : null

    // Determine issue_date: prefer stored date unless it matches upload fallback (e.g. today) and fallback has better date
    const initialDate = currentExpense.issue_date || parsedFallback?.issue_date || ''
    setIssueDate(initialDate)

    // Determine issue_time
    const initialTime = currentExpense.issue_time || parsedFallback?.issue_time || ''
    setIssueTime(initialTime)

    // Determine merchant_name: if stored is generic "Estabelecimento a identificar", check fallback
    let initialMerchant = currentExpense.merchant_name || ''
    if (
      (!initialMerchant || initialMerchant === 'Estabelecimento a identificar') &&
      parsedFallback?.merchant_name
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

    // Assigned trip: preserve expense trip_id or select first available trip
    setAssignedTripId(currentExpense.trip_id || (trips[0]?.id ?? ''))
  }, [currentIndex, currentExpense, trips])

  // Duplicate match details if flagged
  const isDuplicate = currentExpense?.audit_flags?.includes('comprovante_duplicado') || false

  const handleSave = async (advanceNext = false) => {
    if (!currentExpense) return

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
      const updated = await storageService.updateExpense(currentExpense.id, {
        issue_date: issueDate,
        issue_time: issueTime || null,
        merchant_name: merchantName,
        cnpj: cnpj || null,
        category,
        amount: parsedAmount,
        trip_id: assignedTripId || null,
        is_verified: true,
      })

      toast({
        title: 'Comprovante verificado e salvo!',
        description: `Dados de ${merchantName} confirmados para auditoria.`,
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
  const isAssignedTripLocked = assignedTrip
    ? storageService.isTripLocked(assignedTrip.status)
    : false

  const handleDeleteExpense = async () => {
    if (!currentExpense) return
    const deletedExp = { ...currentExpense }
    setIsDeleting(true)
    try {
      // Exclui sem apagar o arquivo do Storage imediatamente para permitir Desfazer
      await storageService.deleteExpense(deletedExp.id, false)
      setDeleteDialogOpen(false)

      const remaining = expenses.filter((e) => e.id !== deletedExp.id)
      setExpenses(remaining)
      if (currentIndex >= remaining.length && remaining.length > 0) {
        setCurrentIndex(remaining.length - 1)
      } else if (remaining.length === 0) {
        navigate('/')
      }

      showExpenseDeletedUndoToast({
        expense: deletedExp,
        onRestored: (restored) => {
          setExpenses((prev) => [restored, ...prev])
        },
      })
    } catch (err: any) {
      toast({
        title: 'Exclusão bloqueada',
        description: storageService.formatDatabaseError(err),
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
                  ⚠️ Atenção: Este comprovante parece ser duplicado de outra despesa cadastrada em{' '}
                  {formatDateBR(currentExpense.issue_date)} — {currentExpense.merchant_name} (
                  {formatCurrencyBRL(currentExpense.amount)})
                </span>
              </div>
            </div>
          )}

          {/* Document Viewer Frame with full PDF / Image / Fallback support */}
          <DocumentViewer
            fileName={currentExpense.file_name}
            fileUrl={currentExpense.file_url}
            ocrRawText={currentExpense.ocr_raw_text}
          />
        </div>

        {/* RIGHT PANEL: Confirmation Form */}
        <div className={`space-y-4 ${activeTabMobile === 'form' ? 'block' : 'hidden md:block'}`}>
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardContent className="p-5 sm:p-6 space-y-4">
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

              {/* Valor (R$) */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="amount"
                  className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                >
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  Valor Total (R$) *
                </Label>
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
                <Select value={assignedTripId} onValueChange={setAssignedTripId}>
                  <SelectTrigger className="text-sm bg-slate-50 focus:bg-white">
                    <SelectValue placeholder="Selecione a viagem" />
                  </SelectTrigger>
                  <SelectContent>
                    {trips.map((tr) => {
                      const locked = storageService.isTripLocked(tr.status)
                      return (
                        <SelectItem key={tr.id} value={tr.id} disabled={locked}>
                          {tr.destination} ({formatDateBR(tr.start_date)})
                          {locked ? ' 🔒 (Bloqueada)' : ''}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {isAssignedTripLocked && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                    ⚠️ A viagem selecionada está com status bloqueado para adição/edição de
                    despesas. Selecione outra viagem aberta.
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
    </div>
  )
}
