import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UploadCloud,
  FileText,
  FileImage,
  X,
  ScanText,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Calendar,
  Building2,
  FileCheck,
  FileSpreadsheet,
  HelpCircle,
  Cpu,
  Layers,
} from 'lucide-react'
import { processRealReceiptOcr, ProcessedReceiptOcr } from '@/services/ocrService'
import {
  SpreadsheetParseResult,
  isSpreadsheetFile,
  parseSpreadsheetFile,
  evaluateReceiptAgainstSpreadsheet,
  MatchEvaluationResult,
} from '@/services/batchSpreadsheetService'
import { appSettingsService } from '@/services/appSettingsService'
import { storageService } from '@/services/storageService'
import { Expense, Trip } from '@/types/database'
import { formatCurrencyBRL, formatDateBR, CATEGORY_LABELS, CATEGORY_COLORS } from '@/lib/formatters'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { useAuth, useSessionGuard } from '@/hooks/use-auth'
import { TripSelectorWithUnlock } from '@/components/TripSelectorWithUnlock'
import { ReopenTripModal } from '@/components/ReopenTripModal'

interface QueueFile {
  id: string
  file: File
  status: 'pending' | 'processing' | 'processed' | 'duplicate_warning' | 'error'
  progress: number
  statusMessage?: string
  extracted?: ProcessedReceiptOcr
  duplicateMatch?: Expense | null
  keepDuplicate?: boolean
  assignedTripId?: string // assigned trip id or 'new'
  sheetEvaluation?: MatchEvaluationResult
}

interface AiTripSuggestion {
  tripKey: string
  destination: string
  startDate: string
  endDate: string
  receiptCount: number
  totalAmount: number
}

export default function UploadPage() {
  useSessionGuard()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, loading: authLoading } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [queue, setQueue] = useState<QueueFile[]>([])
  const [existingTrips, setExistingTrips] = useState<Trip[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [overallProgress, setOverallProgress] = useState(0)
  const [currentProcessingFile, setCurrentProcessingFile] = useState<string | null>(null)
  const [currentStepMessage, setCurrentStepMessage] = useState<string>('')
  const [aiSuggestions, setAiSuggestions] = useState<AiTripSuggestion[]>([])

  // Carrega configurações gerais do sistema (como a taxa Azul) ao montar
  useEffect(() => {
    appSettingsService.getAzulPointRate().catch(() => {})
  }, [])

  // Estado para detecção de planilha de referência no lote
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null)
  const [spreadsheetData, setSpreadsheetData] = useState<SpreadsheetParseResult | null>(null)
  const [spreadsheetParsing, setSpreadsheetParsing] = useState(false)

  // Modal de desbloqueio de viagem a partir do seletor
  const [tripToUnlock, setTripToUnlock] = useState<Trip | null>(null)
  const [unlockModalOpen, setUnlockModalOpen] = useState(false)
  const [targetQueueItemId, setTargetQueueItemId] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    storageService
      .listTrips()
      .then(setExistingTrips)
      .catch((err) => {
        console.error('Falha ao carregar viagens para upload:', err)
      })
  }, [authLoading, user?.id])

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const fileList = Array.from(files)
    const spreadsheetCandidate = fileList.find((f) => isSpreadsheetFile(f))
    const receiptFiles = fileList.filter((f) => !isSpreadsheetFile(f))

    if (spreadsheetCandidate) {
      setSpreadsheetFile(spreadsheetCandidate)
      setSpreadsheetParsing(true)
      try {
        const parsed = await parseSpreadsheetFile(spreadsheetCandidate)
        setSpreadsheetData(parsed)
        if (parsed.errors.length > 0) {
          toast({
            title: 'Aviso na planilha de referência',
            description: parsed.errors[0],
            variant: 'destructive',
          })
        } else {
          toast({
            title: 'Planilha de referência detectada!',
            description: `${parsed.rows.length} itens encontrados em ${spreadsheetCandidate.name}.`,
          })
        }
      } catch (err: any) {
        console.error('Falha ao processar planilha:', err)
        toast({
          title: 'Erro ao ler planilha',
          description: err?.message || 'Não foi possível carregar os dados da planilha.',
          variant: 'destructive',
        })
      } finally {
        setSpreadsheetParsing(false)
      }
    }

    if (receiptFiles.length > 0) {
      const newItems: QueueFile[] = receiptFiles.map((file, idx) => ({
        id: `file-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        file,
        status: 'pending',
        progress: 0,
        statusMessage: 'Pendente de processamento OCR',
      }))

      setQueue((prev) => [...prev, ...newItems])
      toast({
        title: `${newItems.length} comprovante(s) adicionado(s)`,
        description:
          'Clique em "Iniciar OCR Real" para processar o texto e conciliar com a planilha.',
      })
    }
  }

  const removeFile = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files) {
      handleFilesSelected(e.dataTransfer.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  // Process all files with REAL OCR pipeline sequentially
  const processAllFiles = async () => {
    if (queue.length === 0 || isProcessing) return

    setIsProcessing(true)
    setOverallProgress(2)

    const updatedQueue = [...queue]
    const totalFiles = updatedQueue.length

    for (let i = 0; i < totalFiles; i++) {
      const item = updatedQueue[i]
      if (item.status === 'processed') continue

      item.status = 'processing'
      item.progress = 10
      item.statusMessage = 'Iniciando leitura...'
      setCurrentProcessingFile(item.file.name)
      setCurrentStepMessage(`Processando ${i + 1} de ${totalFiles}: ${item.file.name}`)
      setQueue([...updatedQueue])

      try {
        // Run REAL OCR (PDF text layer / raster OCR / image neural OCR)
        const extracted = await processRealReceiptOcr(item.file, (subProgress, subStatus) => {
          item.progress = subProgress
          item.statusMessage = subStatus
          setCurrentStepMessage(subStatus)
          setQueue([...updatedQueue])
        })

        item.extracted = extracted
        item.progress = 85
        item.statusMessage = 'Verificando duplicidades...'
        setQueue([...updatedQueue])

        // Anti-duplicate check (sem trava de data nula: dispara se amount > 0)
        let duplicate: Expense | null = null
        if (extracted.amount && extracted.amount > 0) {
          const targetTripId = findBestTripForDate(extracted.issue_date, existingTrips)
          duplicate = await storageService.findDuplicate({
            issue_date: extracted.issue_date,
            amount: extracted.amount,
            merchant_name: extracted.merchant_name || '',
            trip_id: targetTripId && targetTripId !== 'new' ? targetTripId : null,
            cnpj: extracted.cnpj || undefined,
            category: extracted.category,
          })
        }

        if (duplicate) {
          item.status = 'duplicate_warning'
          item.duplicateMatch = duplicate
          item.statusMessage = 'Alerta: duplicata detectada na base'
        } else {
          item.status = 'processed'
          item.statusMessage =
            extracted.confidence_score > 50
              ? 'OCR realizado com sucesso'
              : 'OCR parcial — requer revisão manual'
        }

        // Default assignment: associate to trip closest to date or triage trip
        item.assignedTripId = findBestTripForDate(extracted.issue_date, existingTrips)

        // Conciliação assistida por planilha de referência se houver planilha no lote
        if (spreadsheetData && spreadsheetData.rows.length > 0) {
          const assignedTrip = existingTrips.find((t) => t.id === item.assignedTripId)
          const tripPeriod =
            assignedTrip && assignedTrip.start_date && assignedTrip.end_date
              ? { startDate: assignedTrip.start_date, endDate: assignedTrip.end_date }
              : undefined

          const evaluation = evaluateReceiptAgainstSpreadsheet({
            receiptFileName: item.file.name,
            ocrData: {
              issue_date: extracted.issue_date,
              amount: extracted.amount,
              category: extracted.category,
              merchant_name: extracted.merchant_name,
              cnpj: extracted.cnpj,
            },
            spreadsheetRows: spreadsheetData.rows,
            tripPeriod,
          })

          item.sheetEvaluation = evaluation

          if (evaluation.hasSheetMatch) {
            if (evaluation.is100PercentMatch) {
              item.statusMessage = '100% Compatível com Planilha (Aprovação Automática)'
            } else {
              item.statusMessage = `Divergência detectada com a planilha (${evaluation.discrepancies.length} campo(s))`
            }
          }
        }

        item.progress = 100
      } catch (err: any) {
        console.error(`Error processing file ${item.file.name}:`, err)
        item.status = 'error'
        item.progress = 100
        item.statusMessage = 'Falha no processamento. Preenchimento manual necessário.'
      }

      const overall = Math.round(((i + 1) / totalFiles) * 100)
      setOverallProgress(overall)
      setQueue([...updatedQueue])
    }

    // AI Grouping Suggestion Logic based on REAL extracted dates
    computeAiGroupingSuggestions(updatedQueue)

    setIsProcessing(false)
    setCurrentProcessingFile(null)
    setCurrentStepMessage('')
    toast({
      title: 'Processamento OCR concluído!',
      description:
        'Dados reais extraídos dos comprovantes. Verifique os campos reconhecidos e complete na triagem se necessário.',
    })
  }

  const findBestTripForDate = (dateStr: string | null, trips: Trip[]): string => {
    // Filtrar apenas viagens abertas (em_triagem ou com_pendencias)
    const openTrips = trips.filter((t) => !storageService.isTripLocked(t))

    if (!dateStr) {
      const triage = openTrips.find((t) => t.status === 'em_triagem')
      return triage ? triage.id : openTrips[0]?.id || 'new'
    }

    // If a trip range includes this date, use it (se a viagem estiver aberta)
    for (const trip of openTrips) {
      if (dateStr >= trip.start_date && dateStr <= trip.end_date) {
        return trip.id
      }
    }
    const triage = openTrips.find((t) => t.status === 'em_triagem')
    if (triage) return triage.id
    if (openTrips.length > 0) return openTrips[0].id
    return 'new'
  }

  const computeAiGroupingSuggestions = (items: QueueFile[]) => {
    const validItems = items.filter((i) => i.extracted)
    if (validItems.length === 0) return

    // Group items by trip or date
    const tripMap = new Map<string, { count: number; total: number; dates: string[] }>()

    validItems.forEach((it) => {
      const tripId = it.assignedTripId || 'new'
      const prev = tripMap.get(tripId) || { count: 0, total: 0, dates: [] }
      prev.count += 1
      prev.total += it.extracted?.amount || 0
      if (it.extracted?.issue_date) prev.dates.push(it.extracted.issue_date)
      tripMap.set(tripId, prev)
    })

    const suggestions: AiTripSuggestion[] = []

    tripMap.forEach((val, tripId) => {
      const trip = existingTrips.find((t) => t.id === tripId)
      val.dates.sort()
      const todayIso = new Date().toISOString().split('T')[0]
      const minDate = val.dates[0] || todayIso
      const maxDate = val.dates[val.dates.length - 1] || minDate

      suggestions.push({
        tripKey: tripId,
        destination: trip ? trip.destination : 'Nova Viagem Sugerida pela IA',
        startDate: trip ? trip.start_date : minDate,
        endDate: trip ? trip.end_date : maxDate,
        receiptCount: val.count,
        totalAmount: Number(val.total.toFixed(2)),
      })
    })

    setAiSuggestions(suggestions)
  }

  const handleKeepDuplicate = (id: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: 'processed', keepDuplicate: true } : item,
      ),
    )
    toast({
      title: 'Comprovante mantido',
      description: 'O item continuará marcado com a flag de duplicidade para revisão do auditor.',
    })
  }

  const handleDiscardDuplicate = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id))
    toast({
      title: 'Duplicata descartada',
      description: 'O arquivo duplicado foi removido da fila de envio.',
    })
  }

  const handleTripAssignmentChange = (fileId: string, tripId: string) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === fileId ? { ...item, assignedTripId: tripId } : item)),
    )
  }

  const handleOpenUnlockModal = (trip: Trip, queueItemId?: string) => {
    setTripToUnlock(trip)
    setTargetQueueItemId(queueItemId || null)
    setUnlockModalOpen(true)
  }

  const handleTripUnlockedSuccess = (reopenedTrip: Trip) => {
    // Atualiza a lista de viagens existentes em memória para refletir status 'em_triagem'
    setExistingTrips((prev) => prev.map((t) => (t.id === reopenedTrip.id ? reopenedTrip : t)))

    // Se o desbloqueio veio de um item específico da fila, já seleciona automaticamente essa viagem desbloqueada para ele
    if (targetQueueItemId) {
      setQueue((prev) =>
        prev.map((item) =>
          item.id === targetQueueItemId ? { ...item, assignedTripId: reopenedTrip.id } : item,
        ),
      )
    }

    toast({
      title: 'Viagem reaberta com sucesso!',
      description: `A viagem "${reopenedTrip.destination}" está desbloqueada. Você já pode incluir o comprovante nela.`,
    })
  }

  // Save all processed receipts to Supabase storage and navigate to Triage
  const handleSaveAndGoToTriage = async () => {
    // Save all items that have finished (processed, duplicate_warning, error/unrecognized)
    const finishedItems = queue.filter(
      (i) => i.status === 'processed' || i.status === 'duplicate_warning' || i.status === 'error',
    )

    if (finishedItems.length === 0) {
      toast({
        title: 'Nenhum comprovante processado',
        description: 'Selecione e processe os arquivos antes de salvar.',
        variant: 'destructive',
      })
      return
    }

    try {
      toast({
        title: 'Enviando comprovantes...',
        description: 'Fazendo upload seguro para o Supabase Storage.',
      })

      for (const item of finishedItems) {
        let uploadedFileUrl = ''

        // Upload original file to Supabase Storage with 1 automatic retry
        let uploadSuccess = false
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            uploadedFileUrl = await storageService.uploadReceiptFile(item.file)
            uploadSuccess = true
            break
          } catch (uploadErr) {
            console.warn(`Tentativa ${attempt} de upload do comprovante falhou:`, uploadErr)
            if (attempt === 1) {
              await new Promise((resolve) => setTimeout(resolve, 800))
            }
          }
        }

        if (!uploadSuccess || !uploadedFileUrl) {
          toast({
            title: 'Erro de conexão no envio',
            description: `Falha ao enviar o arquivo "${item.file.name}" para o armazenamento seguro. O registro NÃO foi salvo para evitar arquivo corrompido. Verifique sua conexão e clique em Salvar novamente.`,
            variant: 'destructive',
          })
          return
        }

        let finalTripId = item.assignedTripId
        if (finalTripId === 'new') {
          // Create auto-trip
          const tripDate = item.extracted?.issue_date || new Date().toISOString().split('T')[0]
          const createdTrip = await storageService.createTrip({
            destination: 'Nova Viagem (Agrupamento IA)',
            start_date: tripDate,
            end_date: tripDate,
            transport_type: item.extracted?.category === 'transporte' ? 'aéreo' : 'outros',
            status: 'em_triagem',
            motivo: 'Processo gerado via upload em lote inteligente',
          })
          finalTripId = createdTrip.id
        }

        const auditFlags: string[] = []
        if (item.duplicateMatch || item.keepDuplicate) {
          auditFlags.push('comprovante_duplicado')
        }

        const ext = item.extracted
        const sheetEval = item.sheetEvaluation

        let issueDate = ext?.issue_date || new Date().toISOString().split('T')[0]
        let category = ext?.category || 'outros'
        let merchantName = ext?.merchant_name
          ? ext.merchant_name.trim()
          : 'Estabelecimento a identificar'
        let amount = ext?.amount !== null && ext?.amount !== undefined ? Number(ext.amount) : 0
        let cnpj = ext?.cnpj || null
        let isVerified = false
        let auditStatus: 'pendente' | 'conforme' | 'com_ressalvas' = 'pendente'

        // Se houver vinculação com a planilha:
        if (sheetEval && sheetEval.hasSheetMatch) {
          // A Planilha é a sugestão principal
          if (sheetEval.suggestedValues.issue_date) {
            issueDate = sheetEval.suggestedValues.issue_date
          }
          if (sheetEval.suggestedValues.merchant_name) {
            merchantName = sheetEval.suggestedValues.merchant_name
          }
          if (sheetEval.suggestedValues.cnpj) {
            cnpj = sheetEval.suggestedValues.cnpj
          }
          if (sheetEval.suggestedValues.category) {
            category = sheetEval.suggestedValues.category
          }
          if (
            sheetEval.suggestedValues.amount !== undefined &&
            sheetEval.suggestedValues.amount !== null
          ) {
            amount = sheetEval.suggestedValues.amount
          }

          // Agrega auditFlags da avaliação (divergências, pontos, período, duplicidade)
          sheetEval.auditFlags.forEach((flag) => {
            if (!auditFlags.includes(flag)) {
              auditFlags.push(flag)
            }
          })

          // Decisão Automática de Status:
          // 100% Compatível (Match nos 3 campos): Marque automaticamente a despesa como Conferida
          if (sheetEval.is100PercentMatch) {
            isVerified = true
            auditStatus = 'conforme'
            auditFlags.push('planilha_conferida_100_compativel')
          } else {
            // Divergência Detectada: Mantenha na fila de Triagem Manual (is_verified = false)
            isVerified = false
            auditStatus = 'pendente'
            auditFlags.push('planilha_divergencia_revisao_necessaria')
          }
        }

        await storageService.createExpense({
          trip_id: finalTripId,
          file_name: item.file.name,
          file_url: uploadedFileUrl,
          issue_date: issueDate,
          issue_time: ext?.issue_time || null,
          category,
          merchant_name: merchantName,
          amount,
          ocr_raw_text: ext?.ocr_raw_text || 'Arquivo sem texto extraído',
          is_verified: isVerified,
          audit_flags: auditFlags,
          audit_status: auditStatus,
          cnpj,
        })
      }

      // Contagem para o resumo final solicitado
      const autoVerifiedCount = finishedItems.filter(
        (i) => i.sheetEvaluation?.hasSheetMatch && i.sheetEvaluation.is100PercentMatch,
      ).length
      const divergenceCount = finishedItems.filter(
        (i) => i.sheetEvaluation?.hasSheetMatch && !i.sheetEvaluation.is100PercentMatch,
      ).length

      if (spreadsheetData && (autoVerifiedCount > 0 || divergenceCount > 0)) {
        toast({
          title: 'Lote com planilha finalizado!',
          description: `${autoVerifiedCount} comprovantes conferidos automaticamente (100% compatíveis com a planilha) e ${divergenceCount} enviados para triagem por divergência.`,
        })
      } else {
        toast({
          title: 'Comprovantes gravados com sucesso!',
          description: 'Todos os arquivos foram salvos. Redirecionando para Triagem...',
        })
      }

      setTimeout(() => {
        navigate('/triage')
      }, 700)
    } catch (saveErr: any) {
      console.error('Error saving expenses:', saveErr)
      toast({
        title: 'Erro ao salvar comprovantes',
        description: storageService.formatDatabaseError(saveErr),
        variant: 'destructive',
      })
    }
  }

  const processedCount = queue.filter(
    (q) => q.status === 'processed' || q.status === 'duplicate_warning' || q.status === 'error',
  ).length
  const duplicateCount = queue.filter((q) => q.status === 'duplicate_warning').length

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
          <span>Upload em Lote com OCR Real</span>
          <Badge className="bg-emerald-600 text-white font-medium text-xs">
            Motor Real (PDF.js + Tesseract)
          </Badge>
        </h2>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          Envie PDFs fiscais (NFC-e, faturas) ou imagens reais de recibos. O sistema extrai o texto
          nativo dos PDFs ou rasteriza páginas escaneadas via OCR neural. Campos não reconhecidos
          com certeza absoluta ficam vazios para conferência honesta na triagem.
        </p>
      </div>

      {/* Dropzone */}
      <Card
        className={`border-2 border-dashed transition-all rounded-xl ${
          isDragging
            ? 'border-blue-600 bg-blue-50/50 scale-[1.005]'
            : 'border-slate-300 hover:border-blue-400 bg-white'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <CardContent className="p-8 sm:p-12 flex flex-col items-center justify-center text-center">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.csv,.xls"
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />

          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-transform ${
              isDragging ? 'bg-blue-600 text-white scale-110' : 'bg-blue-50 text-blue-600'
            }`}
          >
            <UploadCloud className="w-8 h-8 animate-bounce" />
          </div>

          <h3 className="text-base sm:text-lg font-bold text-slate-800">
            Arraste seus comprovantes reais aqui ou{' '}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[#1e40af] underline hover:text-blue-800 inline cursor-pointer font-semibold"
            >
              selecionar do computador
            </button>
          </h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md">
            Múltiplos arquivos suportados (PDF digital ou escaneado, PNG, JPG, JPEG, WEBP) e
            planilhas de referência (.xlsx ou .csv).
          </p>

          <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
            <span className="text-[11px] bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-full font-semibold border border-emerald-300 flex items-center gap-1">
              <FileSpreadsheet className="w-3 h-3 text-emerald-600" /> Planilhas .xlsx / .csv
            </span>
            <span className="text-[11px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium border border-slate-200">
              PDFs Fiscais & Imagens
            </span>
            <span className="text-[11px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium border border-blue-200 flex items-center gap-1">
              <Cpu className="w-3 h-3" /> OCR Real em Português
            </span>
            <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-medium border border-emerald-200">
              100% Sem Dados Inventados
            </span>
            <span className="text-[11px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium border border-slate-200">
              Cruzamento Anti-Duplicidade
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Queue & Processing Actions */}
      {(queue.length > 0 || spreadsheetFile) && (
        <div className="space-y-4">
          {/* Badge / Banner Informativo de Planilha de Referência */}
          {spreadsheetFile && (
            <div className="bg-emerald-50 border border-emerald-300 p-3.5 rounded-xl flex items-center justify-between gap-3 text-emerald-900 shadow-2xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold truncate">{spreadsheetFile.name}</span>
                    <Badge className="bg-emerald-600 text-white font-semibold text-[11px]">
                      Planilha de referência detectada ({spreadsheetData?.rows.length || 0} itens
                      vinculados)
                    </Badge>
                  </div>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    Os dados da planilha serão usados como sugestão prioritária e validados pelo OCR
                    interno.
                  </p>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSpreadsheetFile(null)
                  setSpreadsheetData(null)
                  toast({
                    title: 'Planilha removida do lote',
                    description: 'O lote voltará a processar apenas pelo OCR nativo.',
                  })
                }}
                className="text-xs text-emerald-800 hover:text-rose-600 hover:bg-emerald-100 shrink-0 h-7"
              >
                Remover Planilha
              </Button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                <span>Fila de Arquivos ({queue.length})</span>
                {processedCount > 0 && (
                  <Badge
                    variant="outline"
                    className="text-emerald-700 bg-emerald-50 border-emerald-200 text-xs"
                  >
                    {processedCount} de {queue.length} processados
                  </Badge>
                )}
                {duplicateCount > 0 && (
                  <Badge
                    variant="outline"
                    className="text-amber-700 bg-amber-50 border-amber-200 text-xs"
                  >
                    {duplicateCount} alerta(s) de duplicidade
                  </Badge>
                )}
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Revise os dados antes de consolidar na triagem corporativa.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQueue([])}
                disabled={isProcessing}
                className="text-xs text-slate-600 hover:text-rose-600"
              >
                Limpar Fila
              </Button>

              <Button
                size="sm"
                onClick={processAllFiles}
                disabled={isProcessing || processedCount === queue.length}
                className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 shadow-sm"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Processando OCR Real...
                  </>
                ) : (
                  <>
                    <ScanText className="w-3.5 h-3.5" />
                    Iniciar OCR Real
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Overall Progress Bar during processing */}
          {isProcessing && (
            <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-xs space-y-2">
              <div className="flex justify-between text-xs text-slate-700 font-medium">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                  <span>
                    {currentStepMessage || 'Processando OCR e cruzando base anti-duplicidade...'}
                  </span>
                </span>
                <span className="font-bold tabular-nums text-blue-700">{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
              {currentProcessingFile && (
                <p className="text-[11px] text-slate-500 italic">
                  Arquivo atual: {currentProcessingFile}
                </p>
              )}
            </div>
          )}

          {/* AI Trip Grouping Suggestion Card (if processed) */}
          {aiSuggestions.length > 0 && (
            <Card className="border border-blue-200 bg-blue-50/40 shadow-sm overflow-hidden">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <h4 className="font-bold text-slate-900 text-sm">
                      Sugestão Inteligente da IA: Fracionamento em {aiSuggestions.length}{' '}
                      Processo(s)
                    </h4>
                    <p className="text-xs text-slate-600">
                      Com base nas datas reais extraídas pelo OCR, sugerimos o agrupamento abaixo.
                      Comprovantes sem data identificada ficam vinculados à triagem aberta para
                      conferência.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
                      {aiSuggestions.map((sug) => (
                        <div
                          key={sug.tripKey}
                          className="bg-white p-3 rounded-lg border border-blue-200 shadow-2xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {sug.destination}
                            </span>
                            <Badge className="bg-blue-100 text-blue-800 text-[10px]">
                              {sug.receiptCount} recibos
                            </Badge>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            <span>
                              {formatDateBR(sug.startDate)} até {formatDateBR(sug.endDate)}
                            </span>
                          </div>
                          <div className="text-xs font-extrabold text-[#10b981] tabular-nums pt-0.5">
                            Subtotal:{' '}
                            {sug.totalAmount > 0
                              ? formatCurrencyBRL(sug.totalAmount)
                              : 'A calcular na triagem'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* List of Receipts / Extraction Cards */}
          <div className="space-y-3">
            {queue.map((item) => {
              const isPdf = item.file.name.toLowerCase().endsWith('.pdf')
              const isDuplicate = item.status === 'duplicate_warning'
              const ext = item.extracted
              const categoryColor = ext ? CATEGORY_COLORS[ext.category] : null

              return (
                <Card
                  key={item.id}
                  className={`border transition-all overflow-hidden ${
                    isDuplicate
                      ? 'border-amber-300 bg-amber-50/20'
                      : item.status === 'processed'
                        ? 'border-slate-200 bg-white'
                        : item.status === 'error'
                          ? 'border-rose-200 bg-rose-50/20'
                          : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  {/* Duplicate Alert Banner */}
                  {isDuplicate && item.duplicateMatch && (
                    <div className="bg-amber-100/90 border-b border-amber-200 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-shake">
                      <div className="flex items-center gap-2 text-amber-900 text-xs font-semibold">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          ⚠️ Atenção: Comprovante coincide com outra despesa registrada em{' '}
                          <strong>{formatDateBR(item.duplicateMatch.issue_date)}</strong> —{' '}
                          {item.duplicateMatch.merchant_name} (
                          {formatCurrencyBRL(item.duplicateMatch.amount)})
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleKeepDuplicate(item.id)}
                          className="h-7 text-[11px] bg-white text-slate-700 hover:bg-slate-100 border-amber-300"
                        >
                          Continuar Assim
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleDiscardDuplicate(item.id)}
                          className="h-7 text-[11px] bg-rose-600 hover:bg-rose-700 text-white"
                        >
                          Descartar Duplicata
                        </Button>
                      </div>
                    </div>
                  )}

                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* File Identity */}
                      <div className="flex items-start gap-3 min-w-0 md:max-w-xs">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            isPdf
                              ? 'bg-red-50 text-red-600 border border-red-200'
                              : 'bg-blue-50 text-blue-600 border border-blue-200'
                          }`}
                        >
                          {isPdf ? (
                            <FileText className="w-5 h-5" />
                          ) : (
                            <FileImage className="w-5 h-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-xs sm:text-sm text-slate-900 truncate">
                            {item.file.name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {(item.file.size / 1024).toFixed(1)} KB •{' '}
                            {item.statusMessage || 'Aguardando processamento'}
                          </p>
                          {ext && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 h-4 border-slate-300 text-slate-600"
                              >
                                {ext.extraction_method === 'pdf_text'
                                  ? 'PDF Texto Nativo'
                                  : ext.extraction_method === 'pdf_raster_ocr'
                                    ? 'PDF OCR Rasterizado'
                                    : 'OCR Neural Imagem'}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sheet Evaluation Preview Badge */}
                      {item.sheetEvaluation?.hasSheetMatch && (
                        <div className="shrink-0">
                          {item.sheetEvaluation.is100PercentMatch ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[11px] gap-1 py-1 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              100% Compatível com Planilha
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-[11px] gap-1 py-1 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              Divergência ({item.sheetEvaluation.discrepancies.length})
                            </Badge>
                          )}
                        </div>
                      )}

                      {/* Extracted preview values (HONEST: displays what was found or warning) */}
                      {ext ? (
                        <div className="flex items-center gap-3.5 flex-wrap text-xs flex-1 justify-start md:justify-end">
                          {/* Category Tag */}
                          {categoryColor && (
                            <span
                              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${categoryColor.bg} ${categoryColor.text} ${categoryColor.border}`}
                            >
                              {CATEGORY_LABELS[ext.category]}
                            </span>
                          )}

                          {/* Data de Emissão */}
                          <div className="flex items-center gap-1 text-slate-600">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            {ext.issue_date ? (
                              <span className="font-medium text-slate-800">
                                {formatDateBR(ext.issue_date)}
                              </span>
                            ) : (
                              <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[11px] border border-amber-200">
                                Data não identificada
                              </span>
                            )}
                          </div>

                          {/* Estabelecimento */}
                          <div className="flex items-center gap-1 max-w-[200px] truncate">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {ext.merchant_name ? (
                              <span
                                className="font-semibold text-slate-800 truncate"
                                title={ext.merchant_name}
                              >
                                {ext.merchant_name}
                              </span>
                            ) : (
                              <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[11px] border border-amber-200">
                                Estabelecimento não identificado
                              </span>
                            )}
                          </div>

                          {/* CNPJ */}
                          {ext.cnpj && (
                            <div className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              {ext.cnpj}
                            </div>
                          )}

                          {/* Valor */}
                          <div>
                            {ext.amount !== null ? (
                              <div className="text-sm font-extrabold text-[#10b981] tabular-nums">
                                {formatCurrencyBRL(ext.amount)}
                              </div>
                            ) : (
                              <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-xs font-semibold border border-amber-200">
                                Valor a preencher
                              </span>
                            )}
                            {ext.category === 'transporte' &&
                              ext.points_applied &&
                              ext.points_applied > 0 && (
                                <span className="text-[10px] bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded-full border border-purple-200 block text-center mt-0.5">
                                  + {ext.points_applied.toLocaleString('pt-BR')} pts
                                </span>
                              )}
                          </div>

                          {/* Trip link dropdown com atalho de desbloqueio */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-slate-400">Viagem:</span>
                            <TripSelectorWithUnlock
                              value={item.assignedTripId || 'new'}
                              onChange={(val) => handleTripAssignmentChange(item.id, val)}
                              trips={existingTrips}
                              onUnlockClick={(tr) => handleOpenUnlockModal(tr, item.id)}
                              className="w-[200px]"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 italic">
                          {item.status === 'processing' ? (
                            <span className="flex items-center gap-1 text-blue-600">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              Processando OCR...
                            </span>
                          ) : (
                            'Aguardando clique em "Iniciar OCR Real"...'
                          )}
                        </div>
                      )}

                      {/* Remove Button */}
                      {!isProcessing && (
                        <button
                          onClick={() => removeFile(item.id)}
                          className="text-slate-400 hover:text-rose-600 p-1.5 rounded-md hover:bg-slate-100 transition-colors self-end md:self-center"
                          title="Remover arquivo"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Bottom Save CTA Bar */}
          {processedCount > 0 && (
            <div className="sticky bottom-4 bg-white/95 backdrop-blur-md p-4 rounded-xl border border-slate-300 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3 z-20">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <FileCheck className="w-4 h-4 text-emerald-600" />
                <span>
                  <strong>{processedCount}</strong> comprovante(s) processado(s) com OCR real.
                  Prontos para salvar e conferir na triagem.
                </span>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/')}
                  className="w-1/2 sm:w-auto text-xs"
                >
                  Voltar ao Dashboard
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveAndGoToTriage}
                  className="w-1/2 sm:w-auto bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 shadow-sm font-semibold"
                >
                  <span>Salvar Recibos e Ir para Triagem</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Modal Compartilhado de Reabertura de Viagem (Governança) */}
      <ReopenTripModal
        open={unlockModalOpen}
        onOpenChange={(open) => {
          setUnlockModalOpen(open)
          if (!open) {
            setTripToUnlock(null)
            setTargetQueueItemId(null)
          }
        }}
        trip={tripToUnlock}
        onSuccess={handleTripUnlockedSuccess}
      />
    </div>
  )
}
