import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Trash2,
  Save,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Building2,
  FileText,
  DollarSign,
  Briefcase,
  Layers,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Tag,
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { Expense, Trip, ExpenseCategory } from '@/types/database'
import { formatCurrencyBRL, formatDateBR, CATEGORY_LABELS } from '@/lib/formatters'
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
import { CreateTripModal } from '@/components/CreateTripModal'

export default function TriagePage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  // Document Viewer state
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [activeTabMobile, setActiveTabMobile] = useState<'document' | 'form'>('document')

  // Form edit state for current expense
  const [issueDate, setIssueDate] = useState('')
  const [merchantName, setMerchantName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('outros')
  const [amountStr, setAmountStr] = useState('')
  const [assignedTripId, setAssignedTripId] = useState<string>('')

  // Dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const allTrips = await storageService.listTrips()
      const allExpenses = await storageService.listExpenses()
      // Filter unverified first, or fall back to all if all are verified
      const unverified = allExpenses.filter((e) => !e.is_verified)
      const listToReview = unverified.length > 0 ? unverified : allExpenses

      setTrips(allTrips)
      setExpenses(listToReview)
      setCurrentIndex(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Sync current expense to form inputs
  const currentExpense = expenses[currentIndex] || null

  useEffect(() => {
    if (currentExpense) {
      setIssueDate(currentExpense.issue_date || '')
      setMerchantName(currentExpense.merchant_name || '')
      setCnpj(currentExpense.cnpj || '')
      setCategory(currentExpense.category || 'outros')
      setAmountStr(String(currentExpense.amount || '0'))
      setAssignedTripId(currentExpense.trip_id || (trips[0]?.id ?? ''))
      setZoom(100)
      setRotation(0)
    }
  }, [currentIndex, currentExpense, trips])

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 25, 200))
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 25, 50))
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360)

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
        merchant_name: merchantName,
        cnpj,
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
    } catch {
      toast({
        title: 'Erro ao salvar',
        description: 'Não foi possível atualizar os dados do comprovante.',
        variant: 'destructive',
      })
    }
  }

  const handleDeleteExpense = async () => {
    if (!currentExpense) return
    try {
      await storageService.deleteExpense(currentExpense.id)
      toast({
        title: 'Comprovante excluído',
        description: 'O item foi removido com sucesso.',
      })
      setDeleteDialogOpen(false)

      const remaining = expenses.filter((e) => e.id !== currentExpense.id)
      setExpenses(remaining)
      if (currentIndex >= remaining.length && remaining.length > 0) {
        setCurrentIndex(remaining.length - 1)
      } else if (remaining.length === 0) {
        navigate('/')
      }
    } catch {
      toast({
        title: 'Erro ao excluir',
        description: 'Não foi possível remover o comprovante.',
        variant: 'destructive',
      })
    }
  }

  if (loading) {
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

          {/* Document Viewer Frame */}
          <Card className="border border-slate-200 bg-white overflow-hidden shadow-sm">
            {/* Viewer Toolbar */}
            <div className="bg-slate-100/80 border-b border-slate-200 px-3 py-2 flex items-center justify-between text-xs text-slate-700">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-slate-800 truncate max-w-[180px]">
                  {currentExpense.file_name}
                </span>
                <span className="text-slate-400">|</span>
                <span className="text-[11px] text-slate-500">Página 1 de 1</span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomOut}
                  className="h-7 w-7 p-0"
                  title="Diminuir zoom"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="text-[11px] font-bold tabular-nums w-10 text-center">{zoom}%</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomIn}
                  className="h-7 w-7 p-0"
                  title="Aumentar zoom"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRotate}
                  className="h-7 w-7 p-0"
                  title="Rotacionar 90°"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Document Paper Display Area */}
            <div className="bg-slate-200/60 p-4 sm:p-6 min-h-[480px] max-h-[640px] flex items-center justify-center overflow-auto">
              <div
                className="bg-white rounded shadow-lg border border-slate-300 transition-transform duration-200 ease-out origin-center"
                style={{
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                }}
              >
                <img
                  src={currentExpense.file_url}
                  alt={`Comprovante ${currentExpense.file_name}`}
                  className="max-w-[420px] w-full h-auto object-contain select-none"
                  draggable={false}
                />
              </div>
            </div>

            {/* OCR raw text snippet */}
            {currentExpense.ocr_raw_text && (
              <div className="bg-slate-50 border-t border-slate-200 p-3 text-[11px] text-slate-500 font-mono">
                <span className="font-bold text-slate-700 block mb-0.5">
                  OCR RAW EXTRACTION (Simulado):
                </span>
                <p className="line-clamp-2 text-slate-600">{currentExpense.ocr_raw_text}</p>
              </div>
            )}
          </Card>
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

              {/* Data Real de Emissão */}
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
                <p className="text-[11px] text-slate-400">
                  Prevalece sobre a data de upload para todos os fins contábeis.
                </p>
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
                    {trips.map((tr) => (
                      <SelectItem key={tr.id} value={tr.id}>
                        {tr.destination} ({formatDateBR(tr.start_date)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Action Buttons Row */}
              <div className="pt-4 border-t border-slate-200 space-y-2">
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDeleteDialogOpen(true)}
                    className="w-full sm:w-auto text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Descartar / Excluir</span>
                  </Button>

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
              Descartar Comprovante?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-xs sm:text-sm">
              Tem certeza que deseja descartar este comprovante{' '}
              <strong>"{currentExpense.file_name}"</strong>? Esta ação excluirá os dados extraídos
              pelo OCR e não poderá ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteExpense}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              Sim, Excluir Comprovante
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
