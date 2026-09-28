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
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { Trip, Expense } from '@/types/database'
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateRangeBR,
  CATEGORY_LABELS,
  TRIP_STATUS_CONFIG,
} from '@/lib/formatters'
import { exportTripToExcel, exportConsolidatedReportPdf } from '@/services/reportExportService'
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

export default function ReportsPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  // Package / Preview modal state
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [tripExpenses, setTripExpenses] = useState<Expense[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)

  // Email Modal State
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('financeiro@empresa.com.br')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [attachPdf, setAttachPdf] = useState(true)
  const [attachReceipts, setAttachReceipts] = useState(true)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSentSuccess, setEmailSentSuccess] = useState(false)

  const loadTrips = async () => {
    setLoading(true)
    try {
      const all = await storageService.listTrips()
      setTrips(all)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTrips()
  }, [])

  const handleOpenPackageModal = async (trip: Trip) => {
    setSelectedTrip(trip)
    const exps = await storageService.listExpenses(trip.id)
    setTripExpenses(exps)
    setPreviewOpen(true)
  }

  const handleExportExcel = () => {
    if (!selectedTrip) return
    exportTripToExcel(selectedTrip, tripExpenses)
    toast({
      title: 'Planilha gerada com sucesso!',
      description: 'O arquivo .csv estruturado para Excel foi baixado.',
    })
  }

  const handleExportPdf = () => {
    if (!selectedTrip) return
    exportConsolidatedReportPdf(selectedTrip, tripExpenses)
    toast({
      title: 'Relatório consolidado gerado!',
      description: 'A janela de impressão do PDF com todos os recibos foi aberta.',
    })
  }

  const handleOpenEmailModal = () => {
    if (!selectedTrip) return
    setEmailSubject(
      `Prestação de Contas — ${selectedTrip.destination} (${formatDateRangeBR(
        selectedTrip.start_date,
        selectedTrip.end_date,
      )})`,
    )
    setEmailBody(
      `Prezada equipe de Controladoria e Contas a Pagar,\n\nEncaminho em anexo a prestação de contas consolidada referente ao deslocamento para ${selectedTrip.destination}, realizado no período de ${formatDateRangeBR(selectedTrip.start_date, selectedTrip.end_date)}.\n\nMotivo da Viagem: ${selectedTrip.motivo}\nTotal Solicitado: ${formatCurrencyBRL(selectedTrip.total_amount)}\nTotal de Comprovantes Auditados: ${tripExpenses.length}\n\nTodos os comprovantes foram conferidos via OCR e auditados pelo motor de compliance.\n\nAtenciosamente,\nCarlos Ferreira`,
    )
    setEmailSentSuccess(false)
    setEmailModalOpen(true)
  }

  const handleSendEmailSimulated = async () => {
    setSendingEmail(true)
    await new Promise((r) => setTimeout(r, 1000))
    setSendingEmail(false)
    setEmailSentSuccess(true)

    toast({
      title: 'E-mail enviado com sucesso!',
      description: `A prestação foi enviada para ${emailTo} com os anexos selecionados.`,
    })

    setTimeout(() => {
      setEmailModalOpen(false)
      setEmailSentSuccess(false)
    }, 1400)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
          Relatórios & Prestação de Contas
        </h2>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          Empacote processos de viagem concluídos ou auditados em relatórios consolidados unificados
          (Excel, PDF consolidado com todos os comprovantes em sequência e envio direto por e-mail).
        </p>
      </div>

      {/* Trips list ready for packaging */}
      <div className="space-y-3">
        {loading ? (
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
                      <strong>Motivo:</strong> {selectedTrip.motivo}
                      <br />
                      <strong>Transporte:</strong> {selectedTrip.transport_type}
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
                    {tripExpenses.map((exp, idx) => (
                      <div
                        key={exp.id}
                        className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center space-y-1 hover:border-blue-400 transition-colors"
                      >
                        <div className="h-20 bg-white rounded border border-slate-200 flex items-center justify-center overflow-hidden">
                          <img
                            src={exp.file_url}
                            alt={exp.file_name}
                            className="max-h-full max-w-full object-contain"
                          />
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
                    ))}
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
                      onClick={handleExportPdf}
                      className="bg-rose-600 hover:bg-rose-700 text-white text-xs gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Baixar em PDF Consolidado</span>
                    </Button>
                  </div>

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
                    Anexar relatório consolidado em PDF
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
                    Anexar recibos originais ({tripExpenses.length} arquivos)
                  </Label>
                </div>
              </div>

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
                  onClick={handleSendEmailSimulated}
                  disabled={sendingEmail || !emailTo.trim()}
                  className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs gap-1.5"
                >
                  {sendingEmail ? (
                    'Enviando...'
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
