import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'

interface SendEmailPayload {
  to: string | string[]
  subject: string
  body: string
  tripDetails?: {
    id: string
    destination: string
    startDate: string
    endDate: string
    totalAmount: number
    motivo?: string
    collaboratorName?: string
  }
  expensesSummary?: {
    totalItems: number
    totalAmount: number
  }
  pdfHtml?: string
  checkConfigOnly?: boolean
}

Deno.serve(async (req: Request) => {
  // Handle preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
    const emailSender = Deno.env.get('EMAIL_FROM') || 'Reembolso.ai <onboarding@resend.dev>'

    const body: SendEmailPayload = await req.json().catch(() => ({}) as SendEmailPayload)

    // Quick status check query from client to see if provider is configured
    if (body.checkConfigOnly) {
      return new Response(
        JSON.stringify({
          configured: Boolean(resendApiKey),
          provider: resendApiKey ? 'Resend' : null,
          sender: emailSender,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    const { to, subject, body: messageBody, tripDetails, expensesSummary } = body

    if (!to || !subject) {
      return new Response(
        JSON.stringify({
          error: 'Destinatário (to) e assunto (subject) são obrigatórios.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        },
      )
    }

    const recipientList = Array.isArray(to) ? to : [to]

    // If Resend API key is NOT configured, return clear diagnostic info
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          configured: false,
          error: 'Provedor de e-mail não configurado',
          message:
            'A chave RESEND_API_KEY não foi configurada nas variáveis de ambiente do backend Supabase. O relatório e o PDF consolidado foram gerados localmente e podem ser baixados ou encaminhados pelo seu cliente de e-mail.',
          mailToFallback: {
            to: recipientList.join(';'),
            subject,
            body: messageBody,
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200, // Return 200 with structured status so client can gracefully inform admin
        },
      )
    }

    // Format rich HTML email if possible
    const formattedHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="border-bottom: 2px solid #1e40af; padding-bottom: 16px; margin-bottom: 20px;">
          <h2 style="color: #1e40af; margin: 0 0 6px 0; font-size: 20px;">Reembolso.ai Corporativo</h2>
          <p style="color: #64748b; margin: 0; font-size: 13px;">Prestação de Contas e Relatório de Despesas</p>
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0; color: #0f172a; font-size: 15px;">Resumo da Solicitação</h3>
          <table style="width: 100%; font-size: 13px; line-height: 1.6; border-collapse: collapse;">
            ${
              tripDetails?.destination
                ? `<tr><td style="color: #64748b; width: 140px;">Destino:</td><td><strong>${tripDetails.destination}</strong></td></tr>`
                : ''
            }
            ${
              tripDetails?.startDate
                ? `<tr><td style="color: #64748b;">Período:</td><td>${tripDetails.startDate} a ${tripDetails.endDate}</td></tr>`
                : ''
            }
            ${
              tripDetails?.collaboratorName
                ? `<tr><td style="color: #64748b;">Solicitante:</td><td>${tripDetails.collaboratorName}</td></tr>`
                : ''
            }
            ${
              tripDetails?.motivo
                ? `<tr><td style="color: #64748b;">Motivo:</td><td>${tripDetails.motivo}</td></tr>`
                : ''
            }
            ${
              expensesSummary?.totalItems
                ? `<tr><td style="color: #64748b;">Comprovantes:</td><td>${expensesSummary.totalItems} anexos auditados</td></tr>`
                : ''
            }
            ${
              tripDetails?.totalAmount !== undefined
                ? `<tr><td style="color: #64748b;">Valor Total:</td><td style="color: #10b981; font-weight: bold; font-size: 15px;">R$ ${Number(
                    tripDetails.totalAmount,
                  ).toFixed(2)}</td></tr>`
                : ''
            }
          </table>
        </div>

        <div style="font-size: 13px; line-height: 1.6; color: #334155; margin-bottom: 24px; white-space: pre-wrap; background: #fafafa; padding: 14px; border-radius: 6px;">
${messageBody}
        </div>

        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center;">
          Este e-mail foi gerado automaticamente pelo sistema Reembolso.ai Corporativo.<br/>
          Todos os comprovantes foram conferidos via OCR e auditados pelas regras corporativas.
        </div>
      </div>
    `

    // Call Resend API
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailSender,
        to: recipientList,
        subject,
        html: formattedHtml,
        text: messageBody,
      }),
    })

    const resendData = await resendResponse.json()

    if (!resendResponse.ok) {
      console.error('Erro retornado pela API Resend:', resendData)
      return new Response(
        JSON.stringify({
          success: false,
          configured: true,
          error: resendData?.message || 'Falha ao enviar através do serviço de e-mail',
          details: resendData,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        configured: true,
        messageId: resendData?.id,
        recipient: recipientList,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (err: any) {
    console.error('Erro na Edge Function send-report-email:', err)
    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || 'Erro inesperado no servidor de envio',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})
