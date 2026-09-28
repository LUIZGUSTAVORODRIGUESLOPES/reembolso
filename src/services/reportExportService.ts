import { Trip, Expense } from '@/types/database'
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateRangeBR,
  CATEGORY_LABELS,
} from '@/lib/formatters'

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
 * Downloads a Consolidated PDF using browser print / iframe styled package
 * (Guarantees zero heavyweight bundle crashes and renders exact receipt previews)
 */
export function exportConsolidatedReportPdf(trip: Trip, expenses: Expense[]): void {
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    alert('Por favor, autorize pop-ups para gerar o PDF consolidado.')
    return
  }

  const expensesHtml = expenses
    .map(
      (exp) => `
      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
        <td style="padding: 8px 6px;">${formatDateBR(exp.issue_date)}</td>
        <td style="padding: 8px 6px;"><strong>${CATEGORY_LABELS[exp.category]}</strong></td>
        <td style="padding: 8px 6px;">${exp.merchant_name}<br><small style="color: #64748b;">${exp.cnpj || ''}</small></td>
        <td style="padding: 8px 6px; text-align: right; font-weight: bold; color: #10b981;">${formatCurrencyBRL(exp.amount)}</td>
        <td style="padding: 8px 6px; text-align: center;">${exp.audit_status.toUpperCase()}</td>
      </tr>
    `,
    )
    .join('')

  const receiptsHtml = expenses
    .map(
      (exp, idx) => `
      <div style="page-break-before: always; padding: 24px; font-family: sans-serif; text-align: center;">
        <div style="border-bottom: 2px solid #1e40af; padding-bottom: 12px; margin-bottom: 20px; text-align: left;">
          <h3 style="margin: 0; color: #0f172a; font-size: 16px;">Anexo ${idx + 1} de ${expenses.length} — ${exp.file_name}</h3>
          <p style="margin: 4px 0 0 0; color: #64748b; font-size: 12px;">
            ${exp.merchant_name} • Data: ${formatDateBR(exp.issue_date)} • Valor: <strong>${formatCurrencyBRL(exp.amount)}</strong>
          </p>
        </div>
        <div style="display: inline-block; background: #ffffff; padding: 16px; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); max-width: 520px; width: 100%;">
          <img src="${exp.file_url}" style="max-width: 100%; height: auto; border-radius: 4px;" alt="Recibo" />
        </div>
        <p style="color: #94a3b8; font-size: 10px; margin-top: 16px;">Comprovante digitalizado e auditado pelo motor de compliance Reembolso.ai</p>
      </div>
    `,
    )
    .join('')

  const fullHtml = `
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
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="background: #1e40af; color: white; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600; font-size: 14px;">Prévia do Relatório Consolidado (com todos os anexos)</span>
        <button onclick="window.print()" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer;">Imprimir / Salvar PDF</button>
      </div>

      <div class="page">
        <div class="header">
          <div>
            <h1 class="company-name">REEMBOLSO.AI CORPORATIVO</h1>
            <div class="report-title">Relatório Consolidado de Prestação de Contas de Viagem</div>
          </div>
          <div>
            <span class="badge">${trip.status.toUpperCase()}</span>
          </div>
        </div>

        <div class="meta-grid">
          <div>
            <strong>Destino:</strong> ${trip.destination}<br>
            <strong>Período:</strong> ${formatDateRangeBR(trip.start_date, trip.end_date)}<br>
            <strong>Transporte Principal:</strong> ${trip.transport_type}
          </div>
          <div>
            <strong>Colaborador:</strong> Carlos Ferreira (Matrícula Corp #4412)<br>
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

      <!-- Attached Receipts Pages -->
      ${receiptsHtml}
    </body>
    </html>
  `

  printWindow.document.write(fullHtml)
  printWindow.document.close()
}
