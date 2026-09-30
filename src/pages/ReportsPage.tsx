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
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { resolveReceiptUrl } from '@/services/receiptFileResolver'
import * as pdfjsLib from 'pdfjs-dist'
import { Trip, Expense } from '@/types/database'
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateRangeBR,
  CATEGORY_LABELS,
  TRIP_STATUS_CONFIG,
} from '@/lib/formatters'
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

  // Package / Preview modal state
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [tripExpenses, setTripExpenses] = useState<Expense[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfProgressText, setPdfProgressText] = useState('')
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
  const [providerStatus, setProviderStatus] = useState<EmailProviderConfigStatus>({
    configured: false,
    provider: null,
  })
  const [emailErrorMsg, setEmailErrorMsg] = useState<string | null>(null)

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

  const handleOpenEmailModal = () => {
    if (!selectedTrip) return
    const collaboratorName =
      selectedTrip.user_profile?.full_name ||
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      'Colaborador Solicitante'

    setEmailSubject(
      `Prestação de Contas — ${selectedTrip.destination} (${formatDateRangeBR(
        selectedTrip.start_date,
        selectedTrip.end_date,
      )})`,
    )
    setEmailBody(
      `Prezada equipe de Controladoria e Contas a Pagar,\n\nEncaminho a prestação de contas consolidada referente ao deslocamento para ${selectedTrip.destination}, realizado no período de ${formatDateRangeBR(selectedTrip.start_date, selectedTrip.end_date)}.\n\nMotivo da Viagem: ${selectedTrip.motivo}\nTotal Solicitado: ${formatCurrencyBRL(selectedTrip.total_amount)}\nTotal de Comprovantes Auditados: ${tripExpenses.length}\n\nTodos os comprovantes foram conferidos via OCR e auditados pelo motor de compliance.\n\nAtenciosamente,\n${collaboratorName}`,
    )
    setEmailSentSuccess(false)
    setEmailErrorMsg(null)
    setEmailModalOpen(true)
  }

  const handleSendRealEmail = async () => {
    if (!selectedTrip) return
    setSendingEmail(true)
    setEmailErrorMsg(null)

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
      })

      if (result.success) {
        setEmailSentSuccess(true)
        toast({
          title: 'E-mail enviado com sucesso!',
          description: `A prestação foi entregue com sucesso para ${emailTo}.`,
        })
        setTimeout(() => {
          setEmailModalOpen(false)
          setEmailSentSuccess(false)
        }, 1600)
      } else {
        // Did not succeed — either provider not configured or provider error
        setEmailErrorMsg(
          result.message ||
            result.error ||
            'Não foi possível concluir o envio automático pelo servidor.',
        )
        toast({
          title: result.configured ? 'Erro no envio de e-mail' : 'Provedor de e-mail pendente',
          description: result.message || result.error || 'Verifique as instruções no modal.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('Falha ao enviar e-mail:', err)
      setEmailErrorMsg(err?.message || 'Falha inesperada ao tentar despachar o e-mail.')
      toast({
        title: 'Erro inesperado no envio',
        description: err?.message || 'Tente novamente ou utilize o cliente de e-mail local.',
        variant: 'destructive',
      })
    } finally {
      setSendingEmail(false)
    }
  }

  const handleOpenClientMailTo = () => {
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
            Empacote processos de viagem concluídos ou auditados em relatórios consolidados
            unificados (Excel, PDF consolidado com todos os comprovantes em sequência e envio direto
            por e-mail).
          </p>
        </div>

        {/* Status of Email Service Badge */}
        <div className="shrink-0 flex items-center">
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
        </div>
      </div>

      {/* Trips list ready for packaging */}
      <div className="space-y-3">
        {authLoading || loading ? (
          <div className="p-12 text-center text-slate-500">
            Carregando viagens para prestação de contas...
          </div>
        ) : trips.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="font-semibold text-slate-700 text-sm">Nenhuma viagem disponível</h4>
            <Button
              size="sm"
              onClick={() => navigate('/')}
              className="mt-3 bg-[#1e40af] text-white text-xs"
            >
              Ir ao Dashboard
            </Button>
          </div>
        ) : (
          trips.map((trip) => {
            const statusConf = TRIP_STATUS_CONFIG[trip.status]
            return (
              <Card
                key={trip.id}
                className="border border-slate-200 bg-white hover:border-blue-300 transition-all shadow-sm"
              >
                <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-600" />
                        {trip.destination}
                      </h3>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusConf.badgeClass}`}
                      >
                        {statusConf.label}
                      </span>
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
                  <div className="flex items-center gap-4 justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                    <div className="text-right">
                      <span className="text-[11px] text-slate-400 block uppercase font-medium">
                        Valor Total
                      </span>
                      <div className="text-xl font-black text-[#10b981] tabular-nums">
                        {formatCurrencyBRL(trip.total_amount)}
                      </div>
                    </div>

                    <Button
                      onClick={() => handleOpenPackageModal(trip)}
                      className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5 shadow-sm font-semibold h-9 px-3.5"
                    >
                      <Package className="w-4 h-4" />
                      <span>Empacotar Relatório</span>
                    </Button>
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

                {/* Export Options Row */}
                <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    {/* Excel */}
                    <Button
                      size="sm"
                      onClick={handleExportExcel}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Baixar em Excel</span>
                    </Button>

                    {/* Consolidated PDF */}
                    <Button
                      size="sm"
                      disabled={generatingPdf}
                      onClick={handleExportPdf}
                      className="bg-rose-600 hover:bg-rose-700 text-white text-xs gap-1.5 min-w-[190px]"
                    >
                      {generatingPdf ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Processando Anexos...</span>
                        </>
                      ) : (
                        <>
                          <FileText className="w-3.5 h-3.5" />
                          <span>Baixar em PDF Consolidado</span>
                        </>
                      )}
                    </Button>
                  </div>
                  {generatingPdf && pdfProgressText && (
                    <div className="w-full text-center py-1">
                      <p className="text-[11px] text-blue-700 font-medium animate-pulse">
                        {pdfProgressText}
                      </p>
                    </div>
                  )}

                  {/* Send Email */}
                  <Button
                    size="sm"
                    onClick={handleOpenEmailModal}
                    className="w-full sm:w-auto bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar por E-mail</span>
                  </Button>
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
              <Mail className="w-4 h-4 text-blue-600" />
              Enviar Prestação de Contas por E-mail
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Dispare o relatório consolidado diretamente para a controladoria ou gestor.
            </DialogDescription>
          </DialogHeader>

          {emailSentSuccess ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 animate-in zoom-in-75 duration-300" />
              </div>
              <h4 className="font-bold text-slate-900 text-base">E-mail enviado com sucesso!</h4>
              <p className="text-xs text-slate-500">
                A prestação de contas foi despachada para {emailTo}.
              </p>
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
                    onCheckedChange={(checked) => setAttachPdf(!!checked)}
                  />
                  <Label htmlFor="attach_pdf" className="text-xs text-slate-600 cursor-pointer">
                    Anexar dados do relatório consolidado
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
                  <div className="flex items-start gap-2 text-amber-900 font-semibold">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>Atenção: envio direto pelo servidor indisponível</span>
                  </div>
                  <p className="text-amber-800 text-[11px] leading-relaxed">{emailErrorMsg}</p>
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
                <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-2.5 text-[11px] text-blue-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Configuração de Provedor de E-mail</span>
                    <span>
                      Para envio automatizado direto pelo servidor, configure a chave{' '}
                      <code className="bg-blue-100 px-1 py-0.5 rounded text-[10px] font-mono">
                        RESEND_API_KEY
                      </code>{' '}
                      no backend. Você também pode disparar via cliente de e-mail local.
                    </span>
                  </div>
                </div>
              ) : null}

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
                      <span>Enviando pelo Servidor...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar Prestação de Contas</span>
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
