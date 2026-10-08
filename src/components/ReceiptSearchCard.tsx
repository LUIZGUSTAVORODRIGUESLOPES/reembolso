import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  UploadCloud,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Receipt,
  Building,
  Calendar,
  DollarSign,
  Tag,
  ExternalLink,
  Sparkles,
  Loader2,
  X,
  FileText,
  HelpCircle,
  Clock,
  ShieldCheck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  receiptSearchService,
  ExpenseSearchResult,
  DuplicateCheckResult,
} from '@/services/receiptSearchService'
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateRangeBR,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
} from '@/lib/formatters'
import { Progress } from '@/components/ui/progress'

interface ReceiptSearchCardProps {
  initialQuery?: string
  onClose?: () => void
}

export function ReceiptSearchCard({ initialQuery = '', onClose }: ReceiptSearchCardProps) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'params' | 'upload'>('params')

  // Data cache
  const [expenses, setExpenses] = useState<ExpenseSearchResult[]>([])
  const [loadingData, setLoadingData] = useState<boolean>(true)

  // Param Search State
  const [searchQuery, setSearchQuery] = useState(initialQuery)

  // Upload OCR & Duplicate Check State
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [ocrProgress, setOcrProgress] = useState({ progress: 0, status: '' })
  const [duplicateResult, setDuplicateResult] = useState<DuplicateCheckResult | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  // Manual check form (dentro da aba de upload ou parâmetros)
  const [manualDate, setManualDate] = useState('')
  const [manualAmount, setManualAmount] = useState('')

  // Load all expenses for fast client-side indexing
  const loadExpenses = async () => {
    setLoadingData(true)
    try {
      const all = await receiptSearchService.listAllExpensesWithTrips()
      setExpenses(all)
    } catch (err) {
      console.error('Erro ao indexar recibos para verificação anti-duplicidade:', err)
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    loadExpenses()
  }, [])

  // Sync initial query if passed
  useEffect(() => {
    if (initialQuery) {
      setSearchQuery(initialQuery)
      setActiveTab('params')
    }
  }, [initialQuery])

  // Results for text search (instant, client-side)
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    return receiptSearchService.searchByText(expenses, searchQuery)
  }, [expenses, searchQuery])

  // Process file upload and run OCR check
  const handleProcessFile = async (file: File) => {
    setSelectedFile(file)
    setAnalyzing(true)
    setDuplicateResult(null)
    setOcrProgress({ progress: 5, status: 'Iniciando leitura fiscal do comprovante...' })

    try {
      const res = await receiptSearchService.analyzeReceiptFileForDuplicates(
        file,
        expenses,
        (progress, status) => {
          setOcrProgress({ progress, status })
        },
      )
      setDuplicateResult(res)
      if (res.ocrData?.issue_date) setManualDate(res.ocrData.issue_date)
      if (res.ocrData?.amount) setManualAmount(String(res.ocrData.amount))
    } catch (err) {
      console.error('Erro ao analisar comprovante via OCR:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleProcessFile(file)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleProcessFile(file)
    }
  }

  // Handle manual duplicate re-check
  const handleManualCheck = () => {
    const parsedAmt = parseFloat(manualAmount.replace(',', '.'))
    if (isNaN(parsedAmt) || !manualDate) return

    const res = receiptSearchService.verifyDuplicate(expenses, {
      amount: parsedAmt,
      date: manualDate,
    })
    setDuplicateResult({
      ...res,
      ocrData: duplicateResult?.ocrData,
    })
  }

  const resetUpload = () => {
    setSelectedFile(null)
    setDuplicateResult(null)
    setManualDate('')
    setManualAmount('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <Card className="border border-blue-200/80 bg-gradient-to-b from-blue-50/40 via-white to-white shadow-md rounded-xl overflow-hidden">
      {/* Header with Title and Mode Switcher */}
      <CardHeader className="p-4 sm:p-5 border-b border-slate-100 bg-white/70">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base sm:text-lg font-bold text-slate-900">
                  Busca & Verificação Anti-Duplicidade de Recibos
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-blue-50 text-blue-700 border-blue-200"
                >
                  Compliance
                </Badge>
              </div>
              <CardDescription className="text-xs text-slate-500">
                Consulte qualquer despesa por parâmetros ou anexe um comprovante para checar se ele
                já foi cadastrado no sistema
              </CardDescription>
            </div>
          </div>

          {/* Tab Selector Buttons */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 shrink-0 self-start sm:self-auto">
            <button
              onClick={() => setActiveTab('params')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'params'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Por Parâmetros</span>
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'upload'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Consulta por Upload (OCR)</span>
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* ================= ABA 1: BUSCA POR PARÂMETROS ================= */}
        {activeTab === 'params' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Digite valor (ex: 150.00), data (2026-09-23 ou 23/09), categoria (combustível), empresa ou destino..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-9 h-10 text-xs sm:text-sm bg-white border-slate-200 focus-visible:ring-blue-500 shadow-sm"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {searchQuery && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                  className="text-xs h-10"
                >
                  Limpar
                </Button>
              )}
            </div>

            {/* Hint Chips */}
            {!searchQuery && (
              <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
                <span className="text-[11px] font-medium text-slate-400">Atalhos rápidos:</span>
                {['combustível', 'alimentação', 'uber', 'hospedagem', 'estacionamento'].map(
                  (tag) => (
                    <button
                      key={tag}
                      onClick={() => setSearchQuery(tag)}
                      className="px-2 py-0.5 rounded bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-[11px] text-slate-600 transition-colors"
                    >
                      {tag}
                    </button>
                  ),
                )}
              </div>
            )}

            {/* Results Section */}
            {searchQuery.trim() && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs text-slate-500 pb-1">
                  <span className="font-semibold text-slate-700">
                    {searchResults.length}{' '}
                    {searchResults.length === 1
                      ? 'recibo correspondente'
                      : 'recibos correspondentes'}
                  </span>
                  <span>Pesquisando em todas as viagens</span>
                </div>

                {searchResults.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-slate-800">
                      Nenhum recibo cadastrado com esses parâmetros
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Você pode lançar este comprovante com tranquilidade — não encontramos
                      duplicidades para "{searchQuery}".
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                    {searchResults.map(({ expense, trip }) => {
                      const catStyle = CATEGORY_COLORS[expense.category] || CATEGORY_COLORS.outros
                      return (
                        <div
                          key={expense.id}
                          className="p-3 bg-white hover:bg-blue-50/50 rounded-lg border border-slate-200 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-900 text-sm">
                                {expense.merchant_name || 'Estabelecimento não identificado'}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-2 py-0 font-medium ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}
                              >
                                {CATEGORY_LABELS[expense.category] || expense.category}
                              </Badge>
                              {expense.cnpj && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  CNPJ: {expense.cnpj}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                {formatDateBR(expense.issue_date)}
                              </span>

                              {trip ? (
                                <span className="flex items-center gap-1 font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px]">
                                  <Building className="w-3 h-3 text-blue-500" />
                                  Viagem: {trip.destination} (
                                  {formatDateRangeBR(trip.start_date, trip.end_date)})
                                </span>
                              ) : (
                                <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[10px]">
                                  Sem viagem vinculada (órfão)
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100">
                            <div className="text-right">
                              <span className="text-xs text-slate-400 block sm:hidden">Valor:</span>
                              <div className="text-sm sm:text-base font-extrabold text-[#10b981] tabular-nums">
                                {formatCurrencyBRL(expense.amount)}
                              </div>
                            </div>

                            {trip?.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(`/trips/${trip.id}`)}
                                className="text-xs h-8 px-2.5 gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                              >
                                <span>Ver Viagem</span>
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= ABA 2: CONSULTA POR UPLOAD COM OCR ================= */}
        {activeTab === 'upload' && (
          <div className="space-y-4">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Dropzone */}
            {!selectedFile ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragOver(true)
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all ${
                  isDragOver
                    ? 'border-blue-500 bg-blue-50/70 scale-[1.01]'
                    : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/20 bg-slate-50/50'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-slate-800 text-sm sm:text-base">
                  Arraste ou clique para anexar o comprovante fiscal
                </h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-3">
                  Suporta comprovantes em PDF, JPG e PNG. O sistema extrai data e valor via OCR para
                  auditar duplicidades instantaneamente.
                </p>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5 pointer-events-none"
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  Selecionar Comprovante
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* File summary bar */}
                <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {(selectedFile.size / 1024).toFixed(0)} KB • OCR Tesseract pt-BR
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetUpload}
                    className="text-xs h-8 text-slate-500 hover:text-slate-800"
                    disabled={analyzing}
                  >
                    Trocar Comprovante
                  </Button>
                </div>

                {/* Progress Bar during OCR */}
                {analyzing && (
                  <div className="p-4 bg-blue-50/80 rounded-lg border border-blue-200 space-y-2">
                    <div className="flex items-center justify-between text-xs text-blue-900 font-medium">
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                        {ocrProgress.status || 'Processando OCR do comprovante...'}
                      </span>
                      <span className="font-bold">{ocrProgress.progress}%</span>
                    </div>
                    <Progress value={ocrProgress.progress} className="h-2 bg-blue-100" />
                  </div>
                )}

                {/* ================= RESULTADO ANTI-DUPLICIDADE ================= */}
                {!analyzing && duplicateResult && (
                  <div className="space-y-4">
                    {/* Alerta Exato Pedido pelo Usuário se encontrar duplicidade */}
                    {duplicateResult.hasIdentical && duplicateResult.identicalMatch ? (
                      <div className="p-4 rounded-xl border-2 border-amber-400 bg-amber-50/90 shadow-sm space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                            <AlertTriangle className="w-5 h-5" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-sm font-bold text-amber-950 flex items-center gap-1.5">
                              ⚠️ Atenção: Um recibo com este valor e data já está vinculado à viagem{' '}
                              <span className="underline decoration-amber-600 underline-offset-2">
                                {duplicateResult.identicalMatch.trip?.destination || 'Sem Destino'}
                              </span>{' '}
                              em{' '}
                              <span>
                                {formatDateBR(duplicateResult.identicalMatch.expense.issue_date)}
                              </span>
                            </h4>
                            <p className="text-xs text-amber-800">
                              Detectamos um comprovante idêntico já registrado no sistema para este
                              colaborador ou viagem. Evite duplicidade acidental de reembolso.
                            </p>
                          </div>
                        </div>

                        {/* Detalhes do comprovante duplicado já existente */}
                        <div className="p-3 bg-white/90 rounded-lg border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div>
                            <span className="font-bold text-slate-800">
                              {duplicateResult.identicalMatch.expense.merchant_name ||
                                'Estabelecimento'}
                            </span>
                            <div className="text-[11px] text-slate-600 flex items-center gap-2 mt-0.5">
                              <span>
                                Valor:{' '}
                                <strong className="text-emerald-700">
                                  {formatCurrencyBRL(duplicateResult.identicalMatch.expense.amount)}
                                </strong>
                              </span>
                              <span>•</span>
                              <span>
                                Data:{' '}
                                <strong>
                                  {formatDateBR(duplicateResult.identicalMatch.expense.issue_date)}
                                </strong>
                              </span>
                            </div>
                          </div>

                          {duplicateResult.identicalMatch.trip?.id && (
                            <Button
                              size="sm"
                              onClick={() =>
                                navigate(`/trips/${duplicateResult.identicalMatch?.trip?.id}`)
                              }
                              className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-8 px-3 gap-1 shadow-sm self-end sm:self-auto"
                            >
                              <span>Acessar Viagem</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* Alerta Verde Positivo de Sucesso */
                      <div className="p-4 rounded-xl border border-emerald-300 bg-emerald-50/80 shadow-sm flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <div className="space-y-0.5">
                          <h4 className="text-sm font-bold text-emerald-950">
                            Nenhum recibo idêntico encontrado
                          </h4>
                          <p className="text-xs text-emerald-800">
                            Não encontramos nenhum comprovante cadastrado com valor de{' '}
                            <strong>
                              {formatCurrencyBRL(duplicateResult.searchedCriteria.amount || 0)}
                            </strong>{' '}
                            na data de{' '}
                            <strong>
                              {formatDateBR(duplicateResult.searchedCriteria.date || '')}
                            </strong>
                            . O comprovante está liberado para inclusão.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Alerta Secundário de Correspondências Próximas (mesmo valor, +- 2 dias) */}
                    {duplicateResult.nearMatches.length > 0 && (
                      <div className="p-3.5 rounded-lg border border-blue-200 bg-blue-50/60 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-blue-900">
                          <Clock className="w-4 h-4 text-blue-600" />
                          <span>
                            Possível duplicidade aproximada detectada (
                            {duplicateResult.nearMatches.length}):
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {duplicateResult.nearMatches.map(({ expense, trip }) => (
                            <div
                              key={expense.id}
                              className="p-2.5 bg-white rounded border border-blue-100 flex items-center justify-between text-xs"
                            >
                              <div>
                                <span className="font-semibold text-slate-800">
                                  {expense.merchant_name || 'Comprovante'}
                                </span>
                                <span className="text-slate-500 text-[11px] ml-2">
                                  {formatDateBR(expense.issue_date)} •{' '}
                                  {formatCurrencyBRL(expense.amount)}
                                </span>
                                {trip && (
                                  <span className="text-[10px] text-blue-600 block">
                                    Viagem: {trip.destination}
                                  </span>
                                )}
                              </div>
                              {trip?.id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => navigate(`/trips/${trip.id}`)}
                                  className="text-xs h-7 text-blue-700 hover:bg-blue-50 px-2"
                                >
                                  Verificar
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Resumo dos Dados Extraídos pelo OCR com opção de reajuste manual */}
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
                      <div className="flex items-center justify-between text-slate-700 font-semibold">
                        <span className="flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                          Dados Extraídos pelo OCR:
                        </span>
                        <span className="text-[10px] text-slate-500">
                          Confiança OCR: {duplicateResult.ocrData?.confidence_score ?? 80}%
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">
                            Data detectada
                          </label>
                          <Input
                            type="date"
                            value={manualDate}
                            onChange={(e) => setManualDate(e.target.value)}
                            className="h-8 text-xs bg-white"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">
                            Valor detectado (R$)
                          </label>
                          <Input
                            type="number"
                            step="0.01"
                            value={manualAmount}
                            onChange={(e) => setManualAmount(e.target.value)}
                            className="h-8 text-xs bg-white"
                          />
                        </div>

                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleManualCheck}
                            className="h-8 w-full text-xs font-semibold text-blue-700 border-blue-300 hover:bg-blue-50"
                          >
                            Reconferir Duplicidade
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
