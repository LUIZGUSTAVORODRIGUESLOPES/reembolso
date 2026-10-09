import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileSpreadsheet,
  FileText,
  Send,
  Package,
  Calendar,
  MapPin,
  CheckCircle2,
  Sparkles,
  Download,
  Mail,
  Eye,
  Check,
  ChevronRight,
  ShieldCheck,
  Building2,
  FileCheck2,
  Loader2,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { resolveReceiptUrl } from '@/services/receiptFileResolver'
import * as pdfjsLib from 'pdfjs-dist'
import { Trip, Expense } from '@/types/database'
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateRangeBR,
  normalizeSearchText,
  CATEGORY_LABELS,
  TRIP_STATUS_CONFIG,
} from '@/lib/formatters'
import { TripPhaseToggle } from '@/components/TripPhaseToggle'
import { TripPhase, getTripPhase, countTripsByPhase } from '@/lib/tripPhase'
import { exportTripToExcel, exportConsolidatedReportPdf } from '@/services/reportExportService'
import { reportEmailService, EmailProviderConfigStatus } from '@/services/reportEmailService'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'

export default function ReportsPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, profile, loading: authLoading } = useAuth()

  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros de fase e busca por texto
  const [phaseFilter, setPhaseFilter] = useState<TripPhase>('todas')
  const [searchQuery, setSearchQuery] = useState('')

  // Package / Preview modal state
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [tripExpenses, setTripExpenses] = useState<Expense[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfProgressText, setPdfProgressText] = useState('')
  const [cardExportingTripId, setCardExportingTripId] = useState<string | null>(null)
  const [cardExportingType, setCardExportingType] = useState<'excel' | 'pdf' | null>(null)
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({})
  const [loadingThumbnails, setLoadingThumbnails] = useState(false)

  // Email Modal State
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('financeiro@empresa.com.br')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [attachPdf, setAttachPdf] = useState(true)
  const [attachReceipts, setAttachReceipts] = useState(true)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSentSuccess, setEmailSentSuccess] = useState(false)
  const [checkingProvider, setCheckingProvider] = useState(false)
  const [providerStatus, setProviderStatus] = useState<EmailProviderConfigStatus>({
    configured: false,
    provider: null,
  })
  const [emailErrorMsg, setEmailErrorMsg] = useState<string | null>(null)
  const [emailErrorAction, setEmailErrorAction] = useState<string | null>(null)
  const [emailRawError, setEmailRawError] = useState<string | null>(null)
  const [emailSendingStep, setEmailSendingStep] = useState<string | null>(null)
  const [attachedFilesNames, setAttachedFilesNames] = useState<string[]>([])

  // Contagens por categoria de fase considerando a busca por texto atual
  const phaseCounts = React.useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery)
    const matchingTrips = trips.filter((t) => {
      if (!normalizedQuery) return true
      const destination = normalizeSearchText(t.destination)
      const motivo = normalizeSearchText(t.motivo)
      const notes = normalizeSearchText(t.notes)
      return (
        destination.includes(normalizedQuery) ||
        motivo.includes(normalizedQuery) ||
        notes.includes(normalizedQuery)
      )
    })
    return countTripsByPhase(matchingTrips)
  }, [trips, searchQuery])

  // Viagens filtradas por fase e busca textual
  const filteredTrips = React.useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery)

    return trips.filter((t) => {
      // Filtro de fase
      if (phaseFilter !== 'todas') {
        const phase = getTripPhase(t)
        if (phase !== phaseFilter) return false
      }

      // Filtro de busca textual (destino, motivo, notas)
      if (normalizedQuery) {
        const destination = normalizeSearchText(t.destination)
        const motivo = normalizeSearchText(t.motivo)
        const notes = normalizeSearchText(t.notes)
        const matches =
          destination.includes(normalizedQuery) ||
          motivo.includes(normalizedQuery) ||
          notes.includes(normalizedQuery)
        if (!matches) return false
      }

      return true
    })
  }, [trips, phaseFilter, searchQuery])

  const checkProviderConfig = async (notify: boolean = false) => {
    setCheckingProvider(true)
    try {
      const pStatus = await reportEmailService.checkConfig()
      setProviderStatus(pStatus)
      if (notify) {
        if (pStatus.configured) {
          toast({
            title: 'Provedor de e-mail conectado!',
            description: `O serviço ${pStatus.provider || 'Resend'} está configurado e pronto para envio direto.`,
          })
        } else {
          toast({
            title: 'Provedor ainda não configurado',
            description: 'A chave RESEND_API_KEY ainda não foi detectada no backend.',
            variant: 'destructive',
          })
        }
      }
      return pStatus
    } catch (err: any) {
      console.warn('Erro ao verificar provedor de e-mail:', err)
      if (notify) {
        toast({
          title: 'Erro ao verificar provedor',
          description: err?.message || 'Não foi possível consultar a Edge Function.',
          variant: 'destructive',
        })
      }
      return { configured: false, provider: null }
    } finally {
      setCheckingProvider(false)
    }
  }

  const loadTrips = async () => {
    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    setLoading(true)
    try {
      const [all, pStatus] = await Promise.all([
        storageService.listTrips(),
        reportEmailService.checkConfig(),
      ])
      setTrips(all)
      setProviderStatus(pStatus)
    } catch (err: any) {
      console.error('Falha ao carregar viagens em relatórios:', err)
      toast({
        title: 'Erro ao carregar relatórios',
        description: `Não foi possível carregar as viagens: ${err?.message || 'erro de conexão'}`,
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
    loadTrips()
  }, [authLoading, user?.id])

  const handleOpenPackageModal = async (trip: Trip) => {
    setSelectedTrip(trip)
    const exps = await storageService.listExpenses(trip.id)
    setTripExpenses(exps)
    setPreviewOpen(true)
    loadThumbnailsForExpenses(exps)
  }

  // Load preview thumbnails for each expense (handles images, base64, PDFs rendered to thumbnail canvas)
  const loadThumbnailsForExpenses = async (exps: Expense[]) => {
    setLoadingThumbnails(true)
    const thumbs: Record<string, string> = {}

    await Promise.all(
      exps.map(async (exp) => {
        try {
          const resolved = await resolveReceiptUrl(exp.file_url, exp.file_name)
          if (!resolved.url) return

          if (!resolved.isPdf) {
            thumbs[exp.id] = resolved.url
            return
          }

          // If PDF, render first page as thumbnail
          try {
            const loadingTask = pdfjsLib.getDocument({
              url: resolved.url,
              cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
              cMapPacked: true,
            })
            const pdf = await loadingTask.promise
            const page = await pdf.getPage(1)
            const viewport = page.getViewport({ scale: 0.5 })
            const canvas = document.createElement('canvas')
            canvas.width = viewport.width
            canvas.height = viewport.height
            const ctx = canvas.getContext('2d')
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport }).promise
              thumbs[exp.id] = canvas.toDataURL('image/jpeg', 0.8)
            }
          } catch (err) {
            console.warn(`Could not render thumbnail for PDF ${exp.file_name}:`, err)
          }
        } catch {
          // Ignore individual thumbnail failure
        }
      }),
    )

    setThumbnailUrls(thumbs)
    setLoadingThumbnails(false)
  }

  const handleExportExcel = () => {
    if (!selectedTrip) return
    exportTripToExcel(selectedTrip, tripExpenses)
    toast({
      title: 'Planilha gerada com sucesso!',
      description: 'O arquivo .csv estruturado para Excel foi baixado.',
    })
  }

  const handleExportPdf = async () => {
    if (!selectedTrip || generatingPdf) return
    setGeneratingPdf(true)
    setPdfProgressText('Iniciando processamento dos comprovantes...')

    try {
      const collaboratorName =
        selectedTrip.user_profile?.full_name ||
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        'Colaborador Solicitante'

      await exportConsolidatedReportPdf(
        selectedTrip,
        tripExpenses,
        (current, total, message) => {
          setPdfProgressText(`${message} (${Math.round((current / total) * 100)}%)`)
        },
        collaboratorName,
      )
      toast({
        title: 'Relatório consolidado gerado!',
        description:
          'O relatório e todos os comprovantes foram processados e abertos para impressão/PDF.',
      })
    } catch (err: any) {
      console.error('Error generating consolidated PDF:', err)
      toast({
        title: 'Erro na geração do relatório',
        description: err?.message || 'Houve uma falha ao compilar o PDF com os comprovantes.',
        variant: 'destructive',
      })
    } finally {
      setGeneratingPdf(false)
      setPdfProgressText('')
    }
  }

  // Exportação rápida de Excel direto pelo card da viagem
  const handleQuickExportExcel = async (trip: Trip) => {
    setCardExportingTripId(trip.id)
    setCardExportingType('excel')
    try {
      const exps = await storageService.listExpenses(trip.id)
      exportTripToExcel(trip, exps)
      toast({
        title: 'Planilha baixada!',
        description: `Planilha Excel gerada com sucesso para a viagem ${trip.destination}.`,
      })
    } catch (err: any) {
      console.error('Erro ao exportar Excel do card:', err)
      toast({
        title: 'Erro ao gerar planilha',
        description: err?.message || 'Não foi possível exportar os dados da viagem.',
        variant: 'destructive',
      })
    } finally {
      setCardExportingTripId(null)
      setCardExportingType(null)
    }
  }

  // Exportação rápida de PDF Consolidado direto pelo card da viagem
  const handleQuickExportPdf = async (trip: Trip) => {
    setCardExportingTripId(trip.id)
    setCardExportingType('pdf')
    try {
      const exps = await storageService.listExpenses(trip.id)
      const collaboratorName =
        trip.user_profile?.full_name ||
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        'Colaborador Solicitante'

      await exportConsolidatedReportPdf(trip, exps, undefined, collaboratorName)
      toast({
        title: 'PDF consolidado gerado!',
        description: `O relatório consolidado de ${trip.destination} foi aberto em nova aba.`,
      })
    } catch (err: any) {
      console.error('Erro ao exportar PDF consolidado do card:', err)
      toast({
        title: 'Erro ao gerar PDF',
        description: err?.message || 'Falha ao processar os comprovantes da viagem.',
        variant: 'destructive',
      })
    } finally {
      setCardExportingTripId(null)
      setCardExportingType(null)
    }
  }

  const handleOpenEmailModal = () => {
    if (!selectedTrip) return
    const collaboratorName =
      selectedTrip.user_profile?.full_name ||
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      'Colaborador Solicitante'

    if (selectedTrip.report_sent_to) {
      setEmailTo(selectedTrip.report_sent_to)
    }

    setEmailSubject(
      `${selectedTrip.report_sent_at ? 'Reenvio: ' : ''}Prestação de Contas — ${selectedTrip.destination} (${formatDateRangeBR(
        selectedTrip.start_date,
        selectedTrip.end_date,
      )})`,
    )
    setEmailBody(
      `Prezada equipe de Controladoria e Contas a Pagar,\n\nEncaminho a prestação de contas consolidada referente ao deslocamento para ${selectedTrip.destination}, realizado no período de ${formatDateRangeBR(selectedTrip.start_date, selectedTrip.end_date)}.\n\nMotivo da Viagem: ${selectedTrip.motivo}\nTotal Solicitado: ${formatCurrencyBRL(selectedTrip.total_amount)}\nTotal de Comprovantes Auditados: ${tripExpenses.length}\n\nTodos os comprovantes foram conferidos via OCR e auditados pelo motor de compliance.\n\nAtenciosamente,\n${collaboratorName}`,
    )
    setEmailSentSuccess(false)
    setEmailErrorMsg(null)
    setEmailErrorAction(null)
    setEmailRawError(null)
    setEmailSendingStep(null)
    setAttachedFilesNames([])
    setEmailModalOpen(true)
    // Revalida em segundo plano ao abrir o modal para garantir status atualizado
    checkProviderConfig(false)
  }

  const handleSendRealEmail = async () => {
    if (!selectedTrip) return
    setSendingEmail(true)
    setEmailErrorMsg(null)
    setEmailErrorAction(null)
    setEmailRawError(null)
    setEmailSendingStep('Validando configuração do serviço...')

    // Revalidar o status do provedor na hora do envio (não confiar apenas no mount)
    const currentConfig = await checkProviderConfig(false)

    const collaboratorName =
      selectedTrip.user_profile?.full_name ||
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      'Colaborador Solicitante'

    try {
      const result = await reportEmailService.sendReportEmail({
        to: emailTo.trim(),
        subject: emailSubject.trim(),
        body: emailBody.trim(),
        trip: selectedTrip,
        expenses: tripExpenses,
        collaboratorName,
        attachPdf,
        attachReceipts,
        onProgress: (stepText) => {
          setEmailSendingStep(stepText)
        },
      })

      if (result.success) {
        setEmailSentSuccess(true)
        setAttachedFilesNames(
          result.attachedFiles || (attachPdf ? ['relatorio_prestacao_contas.pdf'] : []),
        )

        // Registrar no banco de dados que o relatório desta viagem foi enviado por e-mail
        try {
          const currentUserName =
            profile?.full_name ||
            user?.user_metadata?.full_name ||
            user?.email?.split('@')[0] ||
            'Usuário'
          const updatedTrip = await storageService.markReportEmailSent(
            selectedTrip.id,
            emailTo.trim(),
            user ? { id: user.id, name: currentUserName } : null,
          )
          if (updatedTrip) {
            setSelectedTrip(updatedTrip)
            setTrips((prev) => prev.map((t) => (t.id === updatedTrip.id ? updatedTrip : t)))
          }
        } catch (markErr) {
          console.warn('Falha ao registrar marcação de e-mail enviado na viagem:', markErr)
        }

        toast({
          title: 'E-mail enviado com sucesso!',
          description: `A prestação de contas foi entregue com o PDF consolidado para ${emailTo}.`,
        })
        setTimeout(() => {
          setEmailModalOpen(false)
          setEmailSentSuccess(false)
          setEmailSendingStep(null)
        }, 2200)
      } else {
        // Did not succeed — either provider not configured or provider error
        setEmailErrorMsg(
          result.error ||
            result.message ||
            'Não foi possível concluir o envio automático pelo servidor.',
        )
        setEmailErrorAction(result.errorAction || null)
        setEmailRawError(result.rawError || null)
        toast({
          title:
            result.configured || currentConfig.configured
              ? 'Erro no envio de e-mail'
              : 'Provedor de e-mail pendente',
          description: result.error || result.message || 'Verifique as instruções no modal.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('Falha ao enviar e-mail:', err)
      setEmailErrorMsg(err?.message || 'Falha inesperada ao tentar despachar o e-mail.')
      setEmailErrorAction(
        'Verifique sua conexão e tente novamente ou utilize o cliente de e-mail local.',
      )
      setEmailRawError(err?.message || null)
      toast({
        title: 'Erro inesperado no envio',
        description: err?.message || 'Tente novamente ou utilize o cliente de e-mail local.',
        variant: 'destructive',
      })
    } finally {
      setSendingEmail(false)
    }
  }

  const handleOpenClientMailTo = async () => {
    if (selectedTrip) {
      try {
        const currentUserName =
          profile?.full_name ||
          user?.user_metadata?.full_name ||
          user?.email?.split('@')[0] ||
          'Usuário'
        const updatedTrip = await storageService.markReportEmailSent(
          selectedTrip.id,
          emailTo.trim() || 'cliente_email_local',
          user ? { id: user.id, name: currentUserName } : null,
        )
        if (updatedTrip) {
          setSelectedTrip(updatedTrip)
          setTrips((prev) => prev.map((t) => (t.id === updatedTrip.id ? updatedTrip : t)))
        }
      } catch (markErr) {
        console.warn('Falha ao registrar marcação de envio via mailto:', markErr)
      }
    }
    const link = reportEmailService.createMailToLink(emailTo, emailSubject, emailBody)
    window.location.href = link
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Relatórios & Prestação de Contas
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">
            Envie processos de viagem concluídos ou auditados em relatórios consolidados unificados
            (Excel, PDF consolidado com todos os comprovantes em sequência e envio direto por
            e-mail).
          </p>
        </div>

        {/* Status of Email Service Badge */}
        <div className="shrink-0 flex items-center gap-2">
          {providerStatus.configured ? (
            <Badge
              variant="outline"
              className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs py-1 px-2.5 gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Envio de E-mail: Conectado ({providerStatus.provider || 'Resend'})</span>
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="bg-amber-50 text-amber-800 border-amber-200 text-xs py-1 px-2.5 gap-1.5"
              title="Para envios diretos via servidor, configure a chave RESEND_API_KEY no backend Supabase. O envio manual via app de e-mail e download de PDF continuam 100% funcionais."
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              <span>Provedor de E-mail: Pendente de Configuração</span>
            </Badge>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => checkProviderConfig(true)}
            disabled={checkingProvider}
            title="Revalidar status do serviço de e-mail"
            className="h-8 px-2 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 gap-1"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${checkingProvider ? 'animate-spin text-blue-600' : ''}`}
            />
            <span className="hidden sm:inline">Verificar novamente</span>
          </Button>
        </div>
      </div>

      {/* Filtros da Central de Relatórios: Alternador de Fase e Busca por Texto */}
      <Card className="border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Alternador de Fase (Em Aberto / Enviadas / Quitadas) */}
          <div className="flex items-center gap-2 flex-wrap">
            <TripPhaseToggle
              value={phaseFilter}
              onChange={setPhaseFilter}
              counts={phaseCounts}
              showAllOption={true}
            />
          </div>

          {/* Busca por texto e contadores */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Buscar destino, motivo ou notas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-7 h-8 text-xs bg-slate-50 border-slate-200 focus:bg-white"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  title="Limpar filtro"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <span className="text-xs text-slate-500 font-medium">
              Mostrando <strong>{filteredTrips.length}</strong> de <strong>{trips.length}</strong>
            </span>
          </div>
        </div>
      </Card>

      {/* Trips list ready for packaging */}
      <div className="space-y-3">
        {authLoading || loading ? (
          <div className="p-12 text-center text-slate-500">
            Carregando viagens para prestação de contas...
          </div>
        ) : filteredTrips.length === 0 ? (
          <div className="p-12 text-center bg-white border border-slate-200 rounded-xl">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="font-semibold text-slate-700 text-sm">
              {trips.length === 0
                ? 'Nenhuma viagem disponível'
                : 'Nenhuma viagem encontrada com os filtros selecionados'}
            </h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {trips.length === 0
                ? 'Cadastre viagens no painel principal para gerar e despachar relatórios.'
                : 'Tente alterar o filtro de fase ou limpar a busca textual para visualizar outros relatórios.'}
            </p>
            {trips.length > 0 && (phaseFilter !== 'todas' || searchQuery) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPhaseFilter('todas')
                  setSearchQuery('')
                }}
                className="mt-3 text-xs border-slate-300"
              >
                Limpar Filtros
              </Button>
            )}
            {trips.length === 0 && (
              <Button
                size="sm"
                onClick={() => navigate('/')}
                className="mt-3 bg-[#1e40af] text-white text-xs"
              >
                Ir ao Dashboard
              </Button>
            )}
          </div>
        ) : (
          filteredTrips.map((trip) => {
            const statusConf = TRIP_STATUS_CONFIG[trip.status]
            return (
              <Card
                key={trip.id}
                className="border border-slate-200 bg-white hover:border-blue-300 transition-all shadow-sm"
              >
                <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-600" />
                        {trip.destination}
                      </h3>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusConf.badgeClass}`}
                      >
                        {statusConf.label}
                      </span>
                      {trip.report_sent_at && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200"
                          title={`Enviado para ${trip.report_sent_to || 'destinatário'} em ${new Date(trip.report_sent_at).toLocaleString('pt-BR')}${trip.report_sent_by_name ? ` por ${trip.report_sent_by_name}` : ''}`}
                        >
                          <Mail className="w-3 h-3 text-blue-600" />
                          <span>
                            Enviado ({new Date(trip.report_sent_at).toLocaleDateString('pt-BR')})
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {formatDateRangeBR(trip.start_date, trip.end_date)}
                      </span>
                      <span>•</span>
                      <span>
                        Transporte: <strong>{trip.transport_type}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Mês Fiscal: <strong>{formatDateBR(trip.start_date).slice(3)}</strong>
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-1 max-w-xl">
                      <strong>Motivo:</strong> {trip.motivo}
                    </p>
                  </div>

                  {/* Actions & Total */}
                  <div className="flex items-center gap-4 justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 flex-wrap">
                    <div className="text-right">
                      <span className="text-[11px] text-slate-400 block uppercase font-medium">
                        Valor Total
                      </span>
                      <div className="text-xl font-black text-[#10b981] tabular-nums">
                        {formatCurrencyBRL(trip.total_amount)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Ações de Exportação Rápida Direta no Card */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={cardExportingTripId === trip.id}
                        onClick={() => handleQuickExportPdf(trip)}
                        className="text-xs h-9 px-2.5 border-slate-200 text-rose-700 hover:bg-rose-50 hover:border-rose-200 gap-1.5"
                        title="Gerar e abrir PDF Consolidado com todos os comprovantes"
                      >
                        {cardExportingTripId === trip.id && cardExportingType === 'pdf' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-rose-600" />
                        )}
                        <span className="hidden sm:inline">PDF</span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={cardExportingTripId === trip.id}
                        onClick={() => handleQuickExportExcel(trip)}
                        className="text-xs h-9 px-2.5 border-slate-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-200 gap-1.5"
                        title="Baixar planilha Excel estruturada (.csv)"
                      >
                        {cardExportingTripId === trip.id && cardExportingType === 'excel' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                        ) : (
                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                        <span className="hidden sm:inline">Excel</span>
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/trips/${trip.id}`)}
                        className="text-xs h-9 px-3 border-slate-200 text-slate-700 hover:bg-slate-50"
                      >
                        Ver Detalhes
                      </Button>

                      <Button
                        onClick={() => handleOpenPackageModal(trip)}
                        className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 shadow-sm font-semibold h-9 px-3.5"
                      >
                        <Package className="w-4 h-4" />
                        <span>Enviar Relatório</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Report Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
          {selectedTrip && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-slate-900 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-blue-600" />
                    Prévia do Relatório Consolidado
                  </span>
                  <span className="text-base font-extrabold text-[#10b981] tabular-nums">
                    {formatCurrencyBRL(selectedTrip.total_amount)}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  {selectedTrip.destination} •{' '}
                  {formatDateRangeBR(selectedTrip.start_date, selectedTrip.end_date)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                {/* Header preview box */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-2">
                  <div className="flex justify-between items-start border-b border-slate-200 pb-2">
                    <div>
                      <span className="font-bold text-slate-900 block text-sm">
                        REEMBOLSO.AI CORPORATIVO
                      </span>
                      <span className="text-slate-500">
                        Prestação de Contas de Despesas de Viagem
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 text-emerald-700 border-emerald-200"
                    >
                      Auditado & Conforme
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-slate-600">
                    <div>
                      <strong>Destino:</strong> {selectedTrip.destination}
                      <br />
                      <strong>Período:</strong>{' '}
                      {formatDateRangeBR(selectedTrip.start_date, selectedTrip.end_date)}
                    </div>
                    <div>
                      <strong>Colaborador:</strong>{' '}
                      {selectedTrip.user_profile?.full_name ||
                        profile?.full_name ||
                        user?.user_metadata?.full_name ||
                        'Colaborador Solicitante'}
                      <br />
                      <strong>Motivo:</strong> {selectedTrip.motivo}
                    </div>
                  </div>
                </div>

                {/* Table of expenses mockup */}
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 uppercase text-[10px] font-semibold text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3">Data</th>
                        <th className="py-2.5 px-3">Classificação</th>
                        <th className="py-2.5 px-3">Estabelecimento</th>
                        <th className="py-2.5 px-3 text-right">Valor Unitário</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tripExpenses.map((exp) => (
                        <tr key={exp.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 text-slate-600">
                            {formatDateBR(exp.issue_date)}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-800">
                            {CATEGORY_LABELS[exp.category]}
                          </td>
                          <td className="py-2 px-3 text-slate-700">{exp.merchant_name}</td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-600 tabular-nums">
                            {formatCurrencyBRL(exp.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                      <tr>
                        <td
                          colSpan={3}
                          className="py-2.5 px-3 text-slate-700 text-right uppercase text-[11px]"
                        >
                          Valor Total do Período:
                        </td>
                        <td className="py-2.5 px-3 text-right text-sm text-[#10b981] tabular-nums">
                          {formatCurrencyBRL(selectedTrip.total_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Attached Receipts Thumbnails Section */}
                <div>
                  <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5 mb-2">
                    <FileCheck2 className="w-3.5 h-3.5 text-blue-600" />
                    Comprovantes Anexados ({tripExpenses.length})
                  </h4>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {tripExpenses.map((exp, idx) => {
                      const thumb = thumbnailUrls[exp.id]
                      const isPdf =
                        exp.file_name.toLowerCase().endsWith('.pdf') ||
                        exp.file_url.toLowerCase().includes('.pdf')

                      return (
                        <div
                          key={exp.id}
                          className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center space-y-1 hover:border-blue-400 transition-colors"
                        >
                          <div className="h-20 bg-white rounded border border-slate-200 flex items-center justify-center overflow-hidden relative">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={exp.file_name}
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : loadingThumbnails ? (
                              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                            ) : isPdf ? (
                              <div className="flex flex-col items-center justify-center gap-1 text-slate-500">
                                <FileText className="w-6 h-6 text-rose-500" />
                                <span className="text-[9px] font-semibold">PDF Anexo</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center gap-1 text-slate-400">
                                <FileCheck2 className="w-5 h-5" />
                                <span className="text-[9px]">Comprovante</span>
                              </div>
                            )}
                          </div>
                          <p
                            className="text-[10px] font-semibold text-slate-700 truncate"
                            title={exp.merchant_name}
                          >
                            {idx + 1}. {exp.merchant_name}
                          </p>
                          <p className="text-[10px] font-bold text-emerald-600 tabular-nums">
                            {formatCurrencyBRL(exp.amount)}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Export Options & Actions: Separação Clara entre Baixar Arquivos Diretamente e Despachar por E-mail */}
                <div className="pt-4 border-t border-slate-200 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Bloco 1: Baixar arquivos diretamente */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col justify-between gap-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wide block flex items-center gap-1.5">
                          <Download className="w-3.5 h-3.5 text-blue-600" />
                          Baixar arquivos diretamente
                        </span>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Gere e baixe a planilha Excel ou abra o PDF consolidado com todos os
                          comprovantes.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Consolidated PDF */}
                        <Button
                          size="sm"
                          disabled={generatingPdf}
                          onClick={handleExportPdf}
                          className="bg-rose-600 hover:bg-rose-700 text-white text-xs gap-1.5 flex-1 min-w-[160px]"
                        >
                          {generatingPdf ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Processando Anexos...</span>
                            </>
                          ) : (
                            <>
                              <FileText className="w-3.5 h-3.5" />
                              <span>PDF Consolidado</span>
                            </>
                          )}
                        </Button>

                        {/* Excel */}
                        <Button
                          size="sm"
                          onClick={handleExportExcel}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 flex-1 min-w-[130px]"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Planilha Excel</span>
                        </Button>
                      </div>
                    </div>

                    {/* Bloco 2: Despachar por e-mail */}
                    <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg flex flex-col justify-between gap-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wide block flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-blue-700" />
                          Despachar por e-mail
                        </span>
                        <p className="text-[11px] text-blue-800 mt-0.5">
                          {selectedTrip?.report_sent_at
                            ? 'Relatório já enviado anteriormente. Você pode reenviar com anexo atualizado.'
                            : 'Envie a prestação de contas com o PDF consolidado direto para a controladoria.'}
                        </p>
                      </div>
                      <div>
                        <Button
                          size="sm"
                          onClick={handleOpenEmailModal}
                          className={`w-full text-white text-xs gap-1.5 font-semibold ${
                            selectedTrip?.report_sent_at
                              ? 'bg-blue-700 hover:bg-blue-800'
                              : 'bg-[#1e40af] hover:bg-[#1d3d9e]'
                          }`}
                        >
                          {selectedTrip?.report_sent_at ? (
                            <RotateCcw className="w-3.5 h-3.5" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {selectedTrip?.report_sent_at
                              ? 'Reenviar por E-mail'
                              : 'Enviar por E-mail'}
                          </span>
                        </Button>
                      </div>
                    </div>
                  </div>

                  {generatingPdf && pdfProgressText && (
                    <div className="w-full text-center py-1">
                      <p className="text-[11px] text-blue-700 font-medium animate-pulse">
                        {pdfProgressText}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Send by Email Modal */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              {selectedTrip?.report_sent_at ? (
                <RotateCcw className="w-4 h-4 text-blue-600" />
              ) : (
                <Mail className="w-4 h-4 text-blue-600" />
              )}
              <span>
                {selectedTrip?.report_sent_at
                  ? 'Reenviar Prestação de Contas por E-mail'
                  : 'Enviar Prestação de Contas por E-mail'}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {selectedTrip?.report_sent_at
                ? 'Esta viagem já teve relatório enviado. Você pode reenviar o relatório consolidado atualizado para o mesmo ou outro destinatário.'
                : 'Dispare o relatório consolidado diretamente para a controladoria ou gestor.'}
            </DialogDescription>
          </DialogHeader>

          {/* Banner de último envio caso já tenha sido enviado */}
          {selectedTrip?.report_sent_at && (
            <div className="p-2.5 bg-blue-50/80 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5 leading-snug">
                <span className="font-semibold block">Último envio registrado:</span>
                <p className="text-[11px] text-blue-800">
                  Enviado em{' '}
                  <strong>
                    {new Date(selectedTrip.report_sent_at).toLocaleDateString('pt-BR')} às{' '}
                    {new Date(selectedTrip.report_sent_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>
                  {selectedTrip.report_sent_to && (
                    <span>
                      {' '}
                      para <strong>{selectedTrip.report_sent_to}</strong>
                    </span>
                  )}
                  {selectedTrip.report_sent_by_name && (
                    <span>
                      {' '}
                      por <strong>{selectedTrip.report_sent_by_name}</strong>
                    </span>
                  )}
                  .
                </p>
                <p className="text-[10px] text-blue-700 italic">
                  O novo envio atualizará a data, horário e destinatário do último relatório.
                </p>
              </div>
            </div>
          )}

          {emailSentSuccess ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 animate-in zoom-in-75 duration-300" />
              </div>
              <h4 className="font-bold text-slate-900 text-base">E-mail enviado com sucesso!</h4>
              <p className="text-xs text-slate-600 max-w-sm mx-auto">
                A prestação de contas foi despachada para <strong>{emailTo}</strong> acompanhada do{' '}
                <strong>relatório consolidado em PDF</strong> com todos os comprovantes anexados.
              </p>
              {attachedFilesNames.length > 0 && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md text-xs font-medium">
                  <FileText className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Anexo enviado: {attachedFilesNames.join(', ')}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Para *</Label>
                <Input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="destinatario@empresa.com.br"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Assunto *</Label>
                <Input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="text-xs font-medium"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Mensagem</Label>
                <Textarea
                  rows={4}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="text-xs resize-none"
                />
              </div>

              {/* Attachments checkboxes */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide block">
                  Anexos da Mensagem
                </span>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="attach_pdf"
                    checked={attachPdf}
                    disabled={sendingEmail}
                    onCheckedChange={(checked) => setAttachPdf(!!checked)}
                  />
                  <Label
                    htmlFor="attach_pdf"
                    className="text-xs text-slate-700 cursor-pointer font-medium"
                  >
                    Anexar PDF consolidado do relatório (inclui todos os comprovantes rasterizados)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="attach_receipts"
                    checked={attachReceipts}
                    onCheckedChange={(checked) => setAttachReceipts(!!checked)}
                  />
                  <Label
                    htmlFor="attach_receipts"
                    className="text-xs text-slate-600 cursor-pointer"
                  >
                    Incluir sumário detalhado dos comprovantes ({tripExpenses.length} itens)
                  </Label>
                </div>
              </div>

              {/* Provider Status or Error Banner */}
              {emailErrorMsg ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 text-amber-900 font-semibold">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>
                        {providerStatus.configured
                          ? 'Falha no envio pelo servidor de e-mail'
                          : 'Envio direto pelo servidor indisponível'}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => checkProviderConfig(true)}
                      disabled={checkingProvider}
                      className="h-6 px-1.5 text-[11px] text-amber-800 hover:text-amber-950 hover:bg-amber-100 gap-1"
                      title="Reconsultar status do provedor"
                    >
                      <RefreshCw className={`w-3 h-3 ${checkingProvider ? 'animate-spin' : ''}`} />
                      <span>Reverificar</span>
                    </Button>
                  </div>

                  <p className="text-amber-900 text-xs font-medium leading-relaxed">
                    {emailErrorMsg}
                  </p>

                  {emailErrorAction && (
                    <div className="p-2 bg-white/70 rounded border border-amber-200 text-[11px] text-amber-800">
                      <strong>Como resolver:</strong> {emailErrorAction}
                    </div>
                  )}

                  {emailRawError && emailRawError !== emailErrorMsg && (
                    <details className="text-[10px] text-amber-700 cursor-pointer pt-0.5">
                      <summary className="font-semibold">Ver detalhes técnicos do erro</summary>
                      <pre className="mt-1 p-1.5 bg-amber-100/60 rounded text-[10px] overflow-x-auto whitespace-pre-wrap font-mono">
                        {emailRawError}
                      </pre>
                    </details>
                  )}

                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleOpenClientMailTo}
                      className="bg-white border-amber-300 text-amber-900 hover:bg-amber-100 text-[11px] h-7"
                    >
                      <Mail className="w-3 h-3 mr-1.5" />
                      Abrir no meu aplicativo de e-mail (Outlook / Mail)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleExportPdf}
                      className="bg-white border-amber-300 text-amber-900 hover:bg-amber-100 text-[11px] h-7"
                    >
                      <Download className="w-3 h-3 mr-1.5" />
                      Baixar PDF para anexar
                    </Button>
                  </div>
                </div>
              ) : !providerStatus.configured ? (
                <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-2.5 text-[11px] text-blue-900 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block">
                        Configuração de Provedor de E-mail
                      </span>
                      <span>
                        Para envio automatizado direto pelo servidor, configure a chave{' '}
                        <code className="bg-blue-100 px-1 py-0.5 rounded text-[10px] font-mono">
                          RESEND_API_KEY
                        </code>{' '}
                        no backend. Você também pode disparar via cliente de e-mail local.
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => checkProviderConfig(true)}
                    disabled={checkingProvider}
                    className="h-6 px-1.5 text-[11px] text-blue-800 hover:text-blue-950 hover:bg-blue-100 shrink-0 gap-1"
                    title="Reconsultar status do provedor"
                  >
                    <RefreshCw className={`w-3 h-3 ${checkingProvider ? 'animate-spin' : ''}`} />
                    <span>Verificar</span>
                  </Button>
                </div>
              ) : (
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5 text-[11px] text-emerald-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Servidor de e-mail conectado via{' '}
                      <strong>{providerStatus.provider || 'Resend'}</strong>
                      {providerStatus.sender ? ` (remetente: ${providerStatus.sender})` : ''}.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => checkProviderConfig(true)}
                    disabled={checkingProvider}
                    className="h-6 px-1.5 text-[11px] text-emerald-800 hover:text-emerald-950 hover:bg-emerald-100 shrink-0 gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${checkingProvider ? 'animate-spin' : ''}`} />
                    <span>Reverificar</span>
                  </Button>
                </div>
              )}

              {sendingEmail && emailSendingStep && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs space-y-1.5">
                  <div className="flex items-center gap-2 text-blue-900 font-semibold">
                    <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                    <span>Processando envio com anexo PDF...</span>
                  </div>
                  <p className="text-[11px] text-blue-700 leading-snug pl-5">{emailSendingStep}</p>
                </div>
              )}

              <DialogFooter className="pt-2 gap-2">
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
                  onClick={handleSendRealEmail}
                  disabled={sendingEmail || !emailTo.trim()}
                  className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5"
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>
                        {selectedTrip?.report_sent_at
                          ? 'Reenviando pelo Servidor...'
                          : 'Enviando pelo Servidor...'}
                      </span>
                    </>
                  ) : (
                    <>
                      {selectedTrip?.report_sent_at ? (
                        <RotateCcw className="w-3.5 h-3.5" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {selectedTrip?.report_sent_at
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
