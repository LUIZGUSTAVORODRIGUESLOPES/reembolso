import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface ResendAttachmentItem {
  filename: string
  content?: string // base64 string
  path?: string // public or signed url
}

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
  // Optional attachments directly sent as base64
  attachments?: Array<{
    filename: string
    content: string // base64 string
  }>
  // Optional storage file reference if the PDF was uploaded to the 'comprovantes' bucket
  storageAttachment?: {
    bucket: string
    path: string
    filename: string
    cleanupAfterSend?: boolean
  }
}

// Resend allows up to 40MB total payload after base64.
// We set a conservative safe limit of 35MB for attachments to prevent network timeouts.
const MAX_ATTACHMENT_SIZE_BYTES = 35 * 1024 * 1024

Deno.serve(async (req: Request) => {
  // Handle preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
    const emailSender = Deno.env.get('EMAIL_FROM') || 'Reembolso.ai <onboarding@resend.dev>'
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || ''

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

    const {
      to,
      subject,
      body: messageBody,
      tripDetails,
      expensesSummary,
      attachments: directAttachments,
      storageAttachment,
    } = body

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
            'A chave RESEND_API_KEY não foi configurada nas variáveis de ambiente do backend Supabase. O relatório e o PDF consolidado foram gerados e podem ser baixados ou encaminhados pelo seu cliente de e-mail.',
          mailToFallback: {
            to: recipientList.join(';'),
            subject,
            body: messageBody,
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    // Resolve attachments list for Resend API
    const resendAttachments: ResendAttachmentItem[] = []
    let totalAttachmentBytes = 0

    // 1. Process direct base64 attachments if provided
    if (Array.isArray(directAttachments) && directAttachments.length > 0) {
      for (const att of directAttachments) {
        if (att && att.content && att.filename) {
          // Normalize base64 content in case it has data URI prefix
          let cleanBase64 = att.content
          if (cleanBase64.includes('base64,')) {
            cleanBase64 = cleanBase64.split('base64,')[1]
          }
          cleanBase64 = cleanBase64.trim()

          const estimatedBytes = Math.round((cleanBase64.length * 3) / 4)
          totalAttachmentBytes += estimatedBytes

          resendAttachments.push({
            filename: att.filename,
            content: cleanBase64,
          })
        }
      }
    }

    // 2. Process storage attachment if provided (e.g. PDF uploaded to comprovantes/relatorios_temp/...)
    let storageFileToDelete: { bucket: string; path: string } | null = null

    if (storageAttachment?.path && storageAttachment?.bucket && supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const { data: fileData, error: downloadError } = await supabase.storage
          .from(storageAttachment.bucket)
          .download(storageAttachment.path)

        if (downloadError) {
          console.warn('Não foi possível baixar o PDF do Storage para anexo:', downloadError)
        } else if (fileData) {
          const arrayBuffer = await fileData.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          totalAttachmentBytes += bytes.byteLength

          // Convert bytes to base64
          let binary = ''
          const len = bytes.byteLength
          const chunkSize = 8192
          for (let i = 0; i < len; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, len))
            binary += String.fromCharCode.apply(null, chunk as unknown as number[])
          }
          const base64Content = btoa(binary)

          resendAttachments.push({
            filename: storageAttachment.filename || 'relatorio_prestacao_contas.pdf',
            content: base64Content,
          })

          if (storageAttachment.cleanupAfterSend !== false) {
            storageFileToDelete = {
              bucket: storageAttachment.bucket,
              path: storageAttachment.path,
            }
          }
        }
      } catch (storageErr) {
        console.warn('Erro ao processar anexo do Storage:', storageErr)
      }
    }

    // Check size limit
    if (totalAttachmentBytes > MAX_ATTACHMENT_SIZE_BYTES) {
      const sizeMb = (totalAttachmentBytes / (1024 * 1024)).toFixed(1)
      return new Response(
        JSON.stringify({
          success: false,
          configured: true,
          error: `O tamanho total dos anexos (${sizeMb} MB) excede o limite máximo permitido para envio por e-mail (35 MB).`,
          message:
            'O PDF consolidado com comprovantes rasterizados é muito grande para os limites de anexo de e-mail corporativo. Por favor, baixe o PDF consolidado pelo app e encaminhe diretamente via cliente de e-mail ou compartilhe o link.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    // Format rich HTML email matching the design
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
            ${
              resendAttachments.length > 0
                ? `<tr><td style="color: #64748b;">Anexos:</td><td style="color: #1e40af; font-weight: 600;">📎 ${resendAttachments
                    .map((a) => a.filename)
                    .join(', ')}</td></tr>`
                : ''
            }
          </table>
        </div>

        <div style="font-size: 13px; line-height: 1.6; color: #334155; margin-bottom: 24px; white-space: pre-wrap; background: #fafafa; padding: 14px; border-radius: 6px;">
${messageBody}
        </div>

        ${
          resendAttachments.length > 0
            ? `<div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px; margin-bottom: 20px; font-size: 12px; color: #1e40af;">
                <strong>📎 Documento em anexo:</strong> O relatório consolidado de prestação de contas com os comprovantes auditados está anexado a este e-mail em formato PDF.
              </div>`
            : ''
        }

        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center;">
          Este e-mail foi gerado automaticamente pelo sistema Reembolso.ai Corporativo.<br/>
          Todos os comprovantes foram conferidos via OCR e auditados pelas regras corporativas.
        </div>
      </div>
    `

    // Call Resend API with attachments if any
    const resendPayload: Record<string, unknown> = {
      from: emailSender,
      to: recipientList,
      subject,
      html: formattedHtml,
      text: messageBody,
    }

    if (resendAttachments.length > 0) {
      resendPayload.attachments = resendAttachments
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    })

    const resendData = await resendResponse.json()

    // Clean up temporary storage file if requested, regardless of send outcome
    if (storageFileToDelete && supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        await supabase.storage.from(storageFileToDelete.bucket).remove([storageFileToDelete.path])
      } catch (cleanupErr) {
        console.warn('Falha na limpeza do arquivo temporário do Storage:', cleanupErr)
      }
    }

    if (!resendResponse.ok) {
      console.error('Erro retornado pela API Resend:', resendResponse.status, resendData)
      return new Response(
        JSON.stringify({
          success: false,
          configured: true,
          statusCode: resendResponse.status,
          error:
            resendData?.message || `Falha no serviço de e-mail (código ${resendResponse.status})`,
          name: resendData?.name,
          details: resendData,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        configured: true,
        messageId: resendData?.id,
        recipient: recipientList,
        attachedFiles: resendAttachments.map((a) => a.filename),
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
        configured: Boolean(Deno.env.get('RESEND_API_KEY')),
        error: err?.message || 'Erro inesperado no servidor de envio',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  }
})
