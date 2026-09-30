import { Trip, Expense } from '@/types/database'
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateRangeBR,
  CATEGORY_LABELS,
} from '@/lib/formatters'
import { prepareReceiptAttachment, PreparedReceiptAttachment } from './receiptRasterService'

/**
 * Downloads a structured Excel-compatible spreadsheet (.xlsx or .csv formatted UTF-8 with BOM)
 */
export function exportTripToExcel(trip: Trip, expenses: Expense[]): void {
  const lines: string[] = []

  // Header Title
  lines.push(`PRESTAÇÃO DE CONTAS E REEMBOLSO CORPORATIVO`)
  lines.push(`Gerado em;${new Date().toLocaleString('pt-BR')}`)
  lines.push(`Destino;${trip.destination}`)
  lines.push(`Período;${formatDateBR(trip.start_date)} a ${formatDateBR(trip.end_date)}`)
  lines.push(`Transporte Principal;${trip.transport_type}`)
  lines.push(`Motivo da Viagem;${trip.motivo}`)
  lines.push(`Status da Prestação;${trip.status}`)
  lines.push(``)

  // Table header
  lines.push(
    `Data;Classificação;Estabelecimento;CNPJ;Valor Unitário (R$);Status Auditoria;Arquivo Anexo`,
  )

  // Table rows
  expenses.forEach((exp) => {
    const formattedAmount = exp.amount.toFixed(2).replace('.', ',')
    lines.push(
      `${formatDateBR(exp.issue_date)};"${CATEGORY_LABELS[exp.category]}";"${exp.merchant_name.replace(/"/g, '""')}";"${exp.cnpj || ''}";${formattedAmount};"${exp.audit_status}";"${exp.file_name}"`,
    )
  })

  // Summary footer
  lines.push(``)
  lines.push(`;;;TOTAL GERAL DO PERÍODO;${trip.total_amount.toFixed(2).replace('.', ',')};;`)

  const csvContent = '\uFEFF' + lines.join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio_prestacao_${trip.destination.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${trip.start_date}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Generates the full HTML for the consolidated PDF report including:
 * 1. Executive summary header & travel metadata
 * 2. Complete itemized expenses table
 * 3. Signature fields
 * 4. Every single receipt page rendered sequentially (as base64 JPEG data URLs)
 * 5. Clear, non-blocking warning banners for receipts that could not be loaded
 */
function buildConsolidatedHtml(
  trip: Trip,
  expenses: Expense[],
  attachments: PreparedReceiptAttachment[],
  collaboratorName?: string,
): string {
  const expensesHtml = expenses
    .map(
      (exp) => `
      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
        <td style="padding: 8px 6px;">${formatDateBR(exp.issue_date)}</td>
        <td style="padding: 8px 6px;"><strong>${CATEGORY_LABELS[exp.category]}</strong></td>
        <td style="padding: 8px 6px;">${exp.merchant_name}<br><small style="color: #64748b;">${exp.cnpj || ''}</small></td>
        <td style="padding: 8px 6px; text-align: right; font-weight: bold; color: #10b981;">${formatCurrencyBRL(exp.amount)}</td>
        <td style="padding: 8px 6px; text-align: center;">${(exp.audit_status || 'pendente').toUpperCase()}</td>
      </tr>
    `,
    )
    .join('')

  // Build attachments pages
  const receiptsHtml = attachments
    .map((att, idx) => {
      const formattedAmount = formatCurrencyBRL(att.amount)
      const formattedDate = formatDateBR(att.issueDate)
      const anexoTitle = `Anexo ${idx + 1} de ${attachments.length} — ${att.fileName}`

      // If failed / error
      if (att.status === 'error' || att.pages.length === 0) {
        return `
        <div style="page-break-before: always; padding: 32px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="border-bottom: 2px solid #ef4444; padding-bottom: 12px; margin-bottom: 24px; text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 style="margin: 0; color: #0f172a; font-size: 16px;">${anexoTitle}</h3>
              <span style="background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">FALHA NO ANEXO</span>
            </div>
            <p style="margin: 6px 0 0 0; color: #64748b; font-size: 12px;">
              ${att.merchantName} • Data: ${formattedDate} • Valor: <strong>${formattedAmount}</strong>
            </p>
          </div>

          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 24px; text-align: center; max-width: 600px; margin: 32px auto;">
            <div style="color: #dc2626; font-size: 28px; margin-bottom: 8px;">⚠️</div>
            <h4 style="margin: 0 0 8px 0; color: #991b1b; font-size: 14px; font-weight: bold;">Comprovante não disponível para visualização</h4>
            <p style="margin: 0 0 12px 0; color: #7f1d1d; font-size: 12px; line-height: 1.5;">
              ${att.errorMessage || 'O arquivo do comprovante não pôde ser carregado do armazenamento.'}
            </p>
            <div style="background: #ffffff; border: 1px dashed #fca5a5; border-radius: 6px; padding: 10px; font-size: 11px; color: #475569; text-align: left; display: inline-block;">
              <strong>Dados Fiscais Registrados:</strong><br>
              • Estabelecimento: ${att.merchantName}<br>
              • Data: ${formattedDate}<br>
              • Valor: ${formattedAmount}<br>
              • Nome do arquivo de referência: <code>${att.fileName}</code>
            </div>
          </div>
          <p style="color: #94a3b8; font-size: 10px; text-align: center; margin-top: 32px;">O relatório foi mantido com os dados fiscais auditados desta despesa.</p>
        </div>
        `
      }

      // Success: render each page of this receipt
      return att.pages
        .map((page, pageIdx) => {
          const pageIndicator =
            att.pages.length > 1 ? ` (Página ${pageIdx + 1} de ${att.pages.length})` : ''

          return `
          <div style="page-break-before: always; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center;">
            <div style="border-bottom: 2px solid #1e40af; padding-bottom: 12px; margin-bottom: 20px; text-align: left;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; color: #0f172a; font-size: 15px;">
                  ${anexoTitle}${pageIndicator}
                </h3>
                <span style="background: #dbeafe; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">
                  COMPROVANTE AUDITADO
                </span>
              </div>
              <p style="margin: 6px 0 0 0; color: #64748b; font-size: 12px;">
                ${att.merchantName} • Data: ${formattedDate} • Valor: <strong>${formattedAmount}</strong>
              </p>
            </div>

            <div style="display: inline-block; background: #ffffff; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); max-width: 90%; margin: 0 auto;">
              <img
                src="${page.dataUrl}"
                style="max-width: 100%; max-height: 820px; width: auto; height: auto; border-radius: 4px; display: block;"
                alt="Comprovante ${att.fileName}"
              />
            </div>

            <p style="color: #94a3b8; font-size: 10px; margin-top: 16px;">
              Comprovante digitalizado e auditado pelo motor de compliance Reembolso.ai
            </p>
          </div>
          `
        })
        .join('')
    })
    .join('')

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>Relatório Consolidado - ${trip.destination}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; background: #fff; }
        .page { padding: 32px; max-width: 800px; margin: 0 auto; }
        .header { border-bottom: 2px solid #1e40af; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
        .company-name { font-size: 20px; font-weight: 800; color: #1e40af; margin: 0; }
        .report-title { font-size: 14px; color: #64748b; margin-top: 4px; }
        .badge { background: #e0e7ff; color: #3730a3; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; font-size: 12px; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
        th { background: #f1f5f9; padding: 10px 6px; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
        .total-box { margin-top: 24px; text-align: right; font-size: 14px; }
        .total-amount { font-size: 22px; font-weight: 800; color: #10b981; }
        @media print {
          body { background: #fff; }
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="background: #1e40af; color: white; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
        <span style="font-weight: 600; font-size: 14px;">
          Relatório Consolidado de Prestação de Contas (${expenses.length} comprovantes preparados)
        </span>
        <button onclick="window.print()" style="background: #10b981; color: white; border: none; padding: 8px 18px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px;">
          Imprimir / Salvar em PDF
        </button>
      </div>

      <div class="page">
        <div class="header">
          <div>
            <h1 class="company-name">REEMBOLSO.AI CORPORATIVO</h1>
            <div class="report-title">Relatório Consolidado de Prestação de Contas de Viagem</div>
          </div>
          <div>
            <span class="badge">${(trip.status || 'CONCLUÍDO').toUpperCase()}</span>
          </div>
        </div>

        <div class="meta-grid">
          <div>
            <strong>Destino:</strong> ${trip.destination}<br>
            <strong>Período:</strong> ${formatDateRangeBR(trip.start_date, trip.end_date)}<br>
            <strong>Transporte Principal:</strong> ${trip.transport_type}
          </div>
          <div>
            <strong>Colaborador Solicitante:</strong> ${collaboratorName || trip.user_profile?.full_name || 'Colaborador'}<br>
            <strong>Motivo da Viagem:</strong> ${trip.motivo}<br>
            <strong>Data do Fechamento:</strong> ${new Date().toLocaleDateString('pt-BR')}
          </div>
        </div>

        <h3 style="font-size: 13px; text-transform: uppercase; color: #334155; margin-bottom: 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
          Detalhamento Cronológico das Despesas (${expenses.length} comprovantes)
        </h3>

        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Classificação</th>
              <th>Estabelecimento</th>
              <th style="text-align: right;">Valor (R$)</th>
              <th style="text-align: center;">Auditoria</th>
            </tr>
          </thead>
          <tbody>
            ${expensesHtml}
          </tbody>
        </table>

        <div class="total-box">
          <span style="color: #64748b; font-size: 12px;">TOTAL GERAL REEMBOLSÁVEL:</span>
          <div class="total-amount">${formatCurrencyBRL(trip.total_amount)}</div>
        </div>

        <div style="margin-top: 48px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
          <div style="border-top: 1px solid #cbd5e1; width: 45%; text-align: center; padding-top: 8px;">
            Assinatura do Colaborador Solicitante
          </div>
          <div style="border-top: 1px solid #cbd5e1; width: 45%; text-align: center; padding-top: 8px;">
            Auditor / Gestor Financeiro Responsável
          </div>
        </div>
      </div>

      <!-- Attached Receipts Pages in Sequence -->
      ${receiptsHtml}
    </body>
    </html>
  `
}

/**
 * Prepares all receipt attachments sequentially or in small batches,
 * then generates and opens the printable consolidated PDF report in a new tab.
 * Notifies progress via callback so UI can give real-time feedback.
 */
export async function exportConsolidatedReportPdf(
  trip: Trip,
  expenses: Expense[],
  onProgress?: (current: number, total: number, message: string) => void,
  collaboratorName?: string,
): Promise<void> {
  const total = expenses.length

  // Pre-open window or open it at the end. Opening window immediately prevents pop-up blocker
  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Gerando Relatório Consolidado...</title>
          <style>
            body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #334155; }
            .box { text-align: center; background: white; padding: 32px 48px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
            .spinner { border: 4px solid #e2e8f0; border-top: 4px solid #1e40af; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite; margin: 0 auto 16px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="box">
            <div class="spinner"></div>
            <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #0f172a;">Preparando Relatório Consolidado</h3>
            <p id="progress-text" style="margin: 0; font-size: 13px; color: #64748b;">Processando recibos e rasterizando comprovantes...</p>
          </div>
        </body>
      </html>
    `)
  }

  const attachments: PreparedReceiptAttachment[] = []

  for (let i = 0; i < total; i++) {
    const exp = expenses[i]
    const stepMsg = `Preparando recibo ${i + 1} de ${total}: ${exp.merchant_name || exp.file_name}`
    onProgress?.(i + 1, total, stepMsg)

    if (printWindow && !printWindow.closed) {
      try {
        const textEl = printWindow.document.getElementById('progress-text')
        if (textEl) {
          textEl.textContent = `Processando comprovante ${i + 1} de ${total}: ${exp.file_name}`
        }
      } catch {
        // window might be cross-origin or closed
      }
    }

    try {
      const att = await prepareReceiptAttachment(exp)
      attachments.push(att)
    } catch (err: any) {
      attachments.push({
        expenseId: exp.id,
        fileName: exp.file_name,
        merchantName: exp.merchant_name,
        issueDate: exp.issue_date,
        amount: exp.amount,
        category: exp.category,
        status: 'error',
        errorMessage: err?.message || 'Falha ao processar arquivo.',
        pages: [],
      })
    }
  }

  onProgress?.(total, total, 'Montando documento final...')

  const fullHtml = buildConsolidatedHtml(trip, expenses, attachments, collaboratorName)

  if (printWindow && !printWindow.closed) {
    printWindow.document.open()
    printWindow.document.write(fullHtml)
    printWindow.document.close()
  } else {
    // If pop-up was blocked or closed
    const newWindow = window.open('', '_blank')
    if (newWindow) {
      newWindow.document.write(fullHtml)
      newWindow.document.close()
    } else {
      alert(
        'Por favor, autorize pop-ups no navegador para visualizar e imprimir o PDF consolidado.',
      )
    }
  }
}

/**
 * Loads jsPDF dynamically from CDN if not already on window.
 */
async function loadJsPdfLibrary(): Promise<any> {
  const w = window as any
  if (w.jspdf && w.jspdf.jsPDF) {
    return w.jspdf.jsPDF
  }
  if (w.jsPDF) {
    return w.jsPDF
  }

  return new Promise((resolve, reject) => {
    // Check if script element already exists
    const existing = document.querySelector('script[data-lib="jspdf"]')
    if (existing) {
      existing.addEventListener('load', () => {
        const jsPDFClass = (window as any).jspdf?.jsPDF || (window as any).jsPDF
        if (jsPDFClass) resolve(jsPDFClass)
        else reject(new Error('Falha ao carregar a biblioteca jsPDF.'))
      })
      existing.addEventListener('error', () =>
        reject(new Error('Erro ao carregar script do jsPDF.')),
      )
      return
    }

    const script = document.createElement('script')
    script.setAttribute('data-lib', 'jspdf')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      const jsPDFClass = (window as any).jspdf?.jsPDF || (window as any).jsPDF
      if (jsPDFClass) {
        resolve(jsPDFClass)
      } else {
        reject(new Error('jsPDF carregado mas objeto window.jspdf.jsPDF não encontrado.'))
      }
    }
    script.onerror = () => reject(new Error('Falha de conexão ao baixar jsPDF via CDN.'))
    document.head.appendChild(script)
  })
}

/**
 * Builds a real binary PDF file (Blob) using jsPDF containing:
 * - Cover/summary page with corporate branding, trip details, itemized table and totals
 * - Subsequent pages each with an attached, audited receipt image nicely framed
 */
export async function generateConsolidatedReportBlob(
  trip: Trip,
  expenses: Expense[],
  collaboratorName?: string,
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<{ blob: Blob; filename: string }> {
  const JsPDFClass = await loadJsPdfLibrary()
  const doc = new JsPDFClass({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  })

  const pageWidth = doc.internal.pageSize.getWidth() // 210mm
  const pageHeight = doc.internal.pageSize.getHeight() // 297mm
  const margin = 15
  const contentWidth = pageWidth - margin * 2

  // --- PAGE 1: Executive Summary & Itemized Table ---
  // Header banner
  doc.setFillColor(30, 64, 175) // #1e40af
  doc.rect(margin, margin, contentWidth, 18, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('REEMBOLSO.AI CORPORATIVO', margin + 6, margin + 8)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text('Prestação de Contas e Relatório de Despesas de Viagem', margin + 6, margin + 14)

  // Status badge
  const statusStr = (trip.status || 'CONCLUÍDO').toUpperCase()
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(pageWidth - margin - 32, margin + 4.5, 28, 8, 2, 2, 'F')
  doc.setTextColor(30, 64, 175)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text(statusStr, pageWidth - margin - 18, margin + 9.5, { align: 'center' })

  // Metadata Card
  let curY = margin + 24
  doc.setFillColor(248, 250, 252) // #f8fafc
  doc.setDrawColor(226, 232, 240) // #e2e8f0
  doc.roundedRect(margin, curY, contentWidth, 34, 2, 2, 'FD')

  doc.setTextColor(15, 23, 42)
  doc.setFontSize(9)

  // Left column
  doc.setFont('helvetica', 'bold')
  doc.text('Destino:', margin + 4, curY + 7)
  doc.setFont('helvetica', 'normal')
  doc.text(trip.destination, margin + 20, curY + 7)

  doc.setFont('helvetica', 'bold')
  doc.text('Período:', margin + 4, curY + 14)
  doc.setFont('helvetica', 'normal')
  doc.text(formatDateRangeBR(trip.start_date, trip.end_date), margin + 20, curY + 14)

  doc.setFont('helvetica', 'bold')
  doc.text('Transporte:', margin + 4, curY + 21)
  doc.setFont('helvetica', 'normal')
  doc.text(trip.transport_type, margin + 24, curY + 21)

  // Right column
  const rightColX = margin + contentWidth / 2 + 2
  doc.setFont('helvetica', 'bold')
  doc.text('Solicitante:', rightColX, curY + 7)
  doc.setFont('helvetica', 'normal')
  const solName = collaboratorName || trip.user_profile?.full_name || 'Colaborador Solicitante'
  doc.text(solName, rightColX + 22, curY + 7)

  doc.setFont('helvetica', 'bold')
  doc.text('Motivo:', rightColX, curY + 14)
  doc.setFont('helvetica', 'normal')
  const motivoShort = trip.motivo
    ? trip.motivo.length > 36
      ? trip.motivo.substring(0, 36) + '...'
      : trip.motivo
    : 'Viagem Corporativa'
  doc.text(motivoShort, rightColX + 16, curY + 14)

  doc.setFont('helvetica', 'bold')
  doc.text('Comprovantes:', rightColX, curY + 21)
  doc.setFont('helvetica', 'normal')
  doc.text(`${expenses.length} anexos auditados`, rightColX + 28, curY + 21)

  doc.setFont('helvetica', 'bold')
  doc.text('Fechamento:', rightColX, curY + 28)
  doc.setFont('helvetica', 'normal')
  doc.text(new Date().toLocaleDateString('pt-BR'), rightColX + 24, curY + 28)

  curY += 40

  // Table Title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(51, 65, 85)
  doc.text(`DETALHAMENTO CRONOLÓGICO DAS DESPESAS (${expenses.length} COMPROVANTES)`, margin, curY)
  curY += 4

  // Table Header
  doc.setFillColor(241, 245, 249)
  doc.rect(margin, curY, contentWidth, 7, 'F')
  doc.setDrawColor(203, 213, 225)
  doc.line(margin, curY + 7, margin + contentWidth, curY + 7)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(71, 85, 105)
  doc.text('DATA', margin + 3, curY + 4.8)
  doc.text('CATEGORIA', margin + 26, curY + 4.8)
  doc.text('ESTABELECIMENTO', margin + 65, curY + 4.8)
  doc.text('VALOR (R$)', margin + contentWidth - 30, curY + 4.8, { align: 'right' })
  doc.text('STATUS', margin + contentWidth - 4, curY + 4.8, { align: 'right' })

  curY += 7

  // Table rows
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(15, 23, 42)

  expenses.forEach((exp, idx) => {
    // Check if near page boundary
    if (curY > pageHeight - 35) {
      doc.addPage()
      curY = margin
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252)
      doc.rect(margin, curY, contentWidth, 6.5, 'F')
    }

    doc.text(formatDateBR(exp.issue_date), margin + 3, curY + 4.5)
    doc.text(CATEGORY_LABELS[exp.category] || exp.category, margin + 26, curY + 4.5)

    const merch = exp.merchant_name || 'Despesa'
    const merchDisplay = merch.length > 34 ? merch.substring(0, 32) + '...' : merch
    doc.text(merchDisplay, margin + 65, curY + 4.5)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(16, 185, 129) // emerald-600
    doc.text(formatCurrencyBRL(exp.amount), margin + contentWidth - 30, curY + 4.5, {
      align: 'right',
    })

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text(
      (exp.audit_status || 'conforme').toUpperCase(),
      margin + contentWidth - 4,
      curY + 4.5,
      {
        align: 'right',
      },
    )
    doc.setTextColor(15, 23, 42)

    curY += 6.5
  })

  // Table Total Footer
  curY += 3
  doc.setDrawColor(203, 213, 225)
  doc.line(margin, curY, margin + contentWidth, curY)
  curY += 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105)
  doc.text('TOTAL GERAL REEMBOLSÁVEL:', margin + contentWidth - 65, curY)
  doc.setTextColor(16, 185, 129)
  doc.setFontSize(12)
  doc.text(formatCurrencyBRL(trip.total_amount), margin + contentWidth - 2, curY, {
    align: 'right',
  })

  // Signatures at bottom of page 1 if room, otherwise bottom of page
  const sigY = Math.max(curY + 22, pageHeight - 32)
  if (sigY <= pageHeight - 15) {
    doc.setDrawColor(203, 213, 225)
    doc.line(margin + 5, sigY, margin + 70, sigY)
    doc.line(pageWidth - margin - 70, sigY, pageWidth - margin - 5, sigY)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text('Assinatura do Solicitante', margin + 37.5, sigY + 4, { align: 'center' })
    doc.text('Gestor / Auditor Financeiro', pageWidth - margin - 37.5, sigY + 4, {
      align: 'center',
    })
  }

  // --- SUBSEQUENT PAGES: Receipt Attachments Rasterized ---
  const total = expenses.length
  for (let i = 0; i < total; i++) {
    const exp = expenses[i]
    onProgress?.(
      i + 1,
      total,
      `Rasterizando comprovante ${i + 1} de ${total}: ${exp.merchant_name}`,
    )

    let att: PreparedReceiptAttachment
    try {
      att = await prepareReceiptAttachment(exp)
    } catch (err: any) {
      att = {
        expenseId: exp.id,
        fileName: exp.file_name,
        merchantName: exp.merchant_name,
        issueDate: exp.issue_date,
        amount: exp.amount,
        category: exp.category,
        status: 'error',
        errorMessage: err?.message || 'Falha ao processar arquivo.',
        pages: [],
      }
    }

    if (att.status === 'error' || att.pages.length === 0) {
      doc.addPage()
      // Error banner
      doc.setFillColor(254, 242, 242)
      doc.rect(margin, margin, contentWidth, 24, 'F')
      doc.setDrawColor(239, 68, 68)
      doc.rect(margin, margin, contentWidth, 24, 'D')

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(185, 28, 28)
      doc.setFontSize(10)
      doc.text(`Anexo ${i + 1} de ${total} — ${att.fileName}`, margin + 6, margin + 8)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(
        `${att.merchantName} • ${formatDateBR(att.issueDate)} • ${formatCurrencyBRL(att.amount)}`,
        margin + 6,
        margin + 14,
      )
      doc.setTextColor(153, 27, 27)
      doc.text(
        `Comprovante não disponível no momento: ${att.errorMessage || 'Arquivo corrompido ou ausente.'}`,
        margin + 6,
        margin + 20,
      )
      continue
    }

    // Embed each rendered page of the receipt
    for (let pIdx = 0; pIdx < att.pages.length; pIdx++) {
      const page = att.pages[pIdx]
      doc.addPage()

      // Header on attachment page
      doc.setFillColor(241, 245, 249)
      doc.rect(margin, margin, contentWidth, 16, 'F')
      doc.setDrawColor(203, 213, 225)
      doc.rect(margin, margin, contentWidth, 16, 'D')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(30, 64, 175)
      const pageInfo = att.pages.length > 1 ? ` (Pág ${pIdx + 1}/${att.pages.length})` : ''
      doc.text(`Anexo ${i + 1} de ${total}: ${att.fileName}${pageInfo}`, margin + 5, margin + 6.5)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(71, 85, 105)
      doc.text(
        `${att.merchantName} • Data: ${formatDateBR(att.issueDate)} • Valor: ${formatCurrencyBRL(att.amount)}`,
        margin + 5,
        margin + 12,
      )

      // Verified badge
      doc.setFillColor(219, 234, 254)
      doc.roundedRect(pageWidth - margin - 38, margin + 3.5, 34, 8.5, 2, 2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(30, 64, 175)
      doc.text('AUDITADO OCR', pageWidth - margin - 21, margin + 8.5, { align: 'center' })

      // Calculate image display bounds
      const availWidth = contentWidth
      const availHeight = pageHeight - margin * 2 - 28 // Leave margin + header + footer
      const imgAspect = page.width / page.height

      let renderW = availWidth
      let renderH = renderW / imgAspect
      if (renderH > availHeight) {
        renderH = availHeight
        renderW = renderH * imgAspect
      }

      const imgX = margin + (availWidth - renderW) / 2
      const imgY = margin + 20

      // White frame behind receipt
      doc.setFillColor(255, 255, 255)
      doc.setDrawColor(203, 213, 225)
      doc.roundedRect(imgX - 1.5, imgY - 1.5, renderW + 3, renderH + 3, 1, 1, 'FD')

      try {
        doc.addImage(page.dataUrl, 'JPEG', imgX, imgY, renderW, renderH, undefined, 'FAST')
      } catch (addImgErr) {
        console.warn('Erro ao inserir imagem no jsPDF:', addImgErr)
      }

      // Footer
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(148, 163, 184)
      doc.text(
        'Comprovante digitalizado e auditado pelo motor de compliance Reembolso.ai Corporativo',
        pageWidth / 2,
        pageHeight - 6,
        { align: 'center' },
      )
    }
  }

  const rawFilename = `relatorio_prestacao_${trip.destination.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${trip.start_date}.pdf`
  const blob = doc.output('blob')
  return { blob, filename: rawFilename }
}
