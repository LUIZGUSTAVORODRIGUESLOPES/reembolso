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
    destination?: string
    startDate?: string
    endDate?: string
    totalAmount?: number
    motivo?: string
    collaboratorName?: string
  }
  standaloneRequestDetails?: {
    id: string
    description?: string
    category?: string
    expenseDate?: string
    amount?: number
    notes?: string
    merchantName?: string
    collaboratorName?: string
  }
  expensesSummary?: {
    totalItems?: number
    totalAmount?: number
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
    filename?: string
    cleanupAfterSend?: boolean
  }
}

// Resend allows up to 40MB total payload after base64.
// We set a conservative safe limit of 35MB for attachments to prevent network timeouts.
const MAX_ATTACHMENT_SIZE_BYTES = 35 * 1024 * 1024
const MAX_RECIPIENTS = 5
const MAX_SUBJECT_LENGTH = 200
const MAX_BODY_LENGTH = 20000
const MAX_DIRECT_ATTACHMENTS = 5

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function sanitizeFilename(name: unknown): string {
  if (!name || typeof name !== 'string') {
    return 'anexo.bin'
  }
  // Strip null bytes, paths, and control characters
  const cleaned =
    name
      .replace(/[\0\r\n]/g, '')
      .replace(/\\/g, '/')
      .split('/')
      .pop() || 'anexo.bin'

  const safe = cleaned
    .replace(/\.\.+/g, '')
    .replace(/[^\w\s.\-_]/gi, '_')
    .trim()
  return safe.length > 0 ? safe.slice(0, 100) : 'anexo.bin'
}

function jsonResponse(data: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

Deno.serve(async (req: Request) => {
  // Handle preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
    const emailSender = Deno.env.get('EMAIL_FROM') || 'Reembolso.ai <onboarding@resend.dev>'
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    // ITEM 2 — Autenticação obrigatória em TODA requisição (inclusive checkConfigOnly)
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação ausente ou inválido.' },
        401,
      )
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação ausente ou inválido.' },
        401,
      )
    }

    // Criar cliente Supabase autenticado com o JWT do usuário e ANON_KEY (RLS ativo)
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const { data: userData, error: userError } = await userSupabase.auth.getUser(token)
    if (userError || !userData?.user) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação inválido ou expirado.' },
        401,
      )
    }

    const authenticatedUser = userData.user
    const userId = authenticatedUser.id

    const body: SendEmailPayload = await req.json().catch(() => ({}) as SendEmailPayload)

    // Quick status check query from authenticated client
    if (body.checkConfigOnly) {
      return jsonResponse(
        {
          configured: Boolean(resendApiKey),
          provider: resendApiKey ? 'Resend' : null,
          sender: emailSender,
        },
        200,
      )
    }

    const {
      to,
      subject,
      body: messageBody,
      tripDetails,
      standaloneRequestDetails,
      expensesSummary,
      attachments: directAttachments,
      storageAttachment,
    } = body

    // ITEM 3 — Validação de payload
    if (!to || !subject) {
      return jsonResponse({ error: 'Destinatário (to) e assunto (subject) são obrigatórios.' }, 400)
    }

    const recipientList = (Array.isArray(to) ? to : [to])
      .map((e) => (typeof e === 'string' ? e.trim() : ''))
      .filter(Boolean)

    if (recipientList.length === 0) {
      return jsonResponse(
        { error: 'Pelo menos um endereço de e-mail de destinatário é obrigatório.' },
        400,
      )
    }

    if (recipientList.length > MAX_RECIPIENTS) {
      return jsonResponse(
        { error: `O número máximo de destinatários permitidos é ${MAX_RECIPIENTS}.` },
        400,
      )
    }

    for (const email of recipientList) {
      if (!EMAIL_REGEX.test(email) || email.length > 254) {
        return jsonResponse(
          { error: `O endereço de e-mail informado é inválido: "${escapeHtml(email)}".` },
          400,
        )
      }
    }

    if (typeof subject !== 'string' || subject.trim().length === 0) {
      return jsonResponse({ error: 'Assunto do e-mail é obrigatório.' }, 400)
    }

    if (subject.length > MAX_SUBJECT_LENGTH) {
      return jsonResponse(
        { error: `O assunto do e-mail não pode exceder ${MAX_SUBJECT_LENGTH} caracteres.` },
        400,
      )
    }

    if (typeof messageBody !== 'string') {
      return jsonResponse({ error: 'Corpo da mensagem é obrigatório.' }, 400)
    }

    if (messageBody.length > MAX_BODY_LENGTH) {
      return jsonResponse(
        { error: `O corpo do e-mail não pode exceder ${MAX_BODY_LENGTH} caracteres.` },
        400,
      )
    }

    // ITEM 2 — Autorização sobre os dados (tripDetails.id OU standaloneRequestDetails.id)
    const tripId = tripDetails?.id
    const standaloneId = standaloneRequestDetails?.id

    if (!tripId && !standaloneId) {
      return jsonResponse(
        { error: 'Identificador da viagem ou da solicitação avulsa ausente no payload.' },
        400,
      )
    }

    if (tripId) {
      if (typeof tripId !== 'string' || !UUID_REGEX.test(tripId)) {
        return jsonResponse({ error: 'Identificador da viagem inválido no payload.' }, 400)
      }
      // Consulta com cliente autenticado do usuário (RLS ativo em public.trips)
      const { data: tripRow, error: tripQueryError } = await userSupabase
        .from('trips')
        .select('id, user_id')
        .eq('id', tripId)
        .maybeSingle()

      if (tripQueryError || !tripRow) {
        console.warn(
          `Acesso negado ou viagem não encontrada para tripId=${tripId}, userId=${userId}:`,
          tripQueryError,
        )
        return jsonResponse(
          { error: 'Você não tem permissão para enviar esta prestação de contas.' },
          403,
        )
      }

      // GATEKEEPING DE BACKEND:
      // Verifica se há recibos pendentes de conferência na viagem.
      // Se houver qualquer recibo não conferido (audit_manual_checked != true), aborta imediatamente com 400 Bad Request.
      const { data: tripExpenses, error: expensesError } = await userSupabase
        .from('expenses')
        .select('id, is_verified, audit_status, audit_manual_checked')
        .eq('trip_id', tripId)

      if (expensesError) {
        console.error('Erro ao consultar despesas para validação de gatekeeping:', expensesError)
        return jsonResponse(
          { error: 'Não foi possível validar o status dos comprovantes da viagem.' },
          500,
        )
      }

      const totalTripExpenses = tripExpenses?.length || 0
      if (totalTripExpenses === 0) {
        return jsonResponse(
          {
            error:
              'A viagem não possui comprovantes vinculados. Complete a inclusão e conferência na Triagem para liberar o envio.',
          },
          400,
        )
      }

      const pendingExpenses = (tripExpenses || []).filter(
        (e) =>
          e.audit_manual_checked !== true ||
          e.audit_status === 'pendente' ||
          e.is_verified === false,
      )

      if (pendingExpenses.length > 0) {
        return jsonResponse(
          {
            error:
              'Complete a conferência de todos os recibos pendentes na Triagem para liberar o envio.',
            pendingCount: pendingExpenses.length,
            totalExpenses: totalTripExpenses,
          },
          400,
        )
      }
    } else if (standaloneId) {
      if (typeof standaloneId !== 'string' || !UUID_REGEX.test(standaloneId)) {
        return jsonResponse({ error: 'Identificador da solicitação avulsa inválido.' }, 400)
      }
      const { data: standaloneRow, error: standaloneQueryError } = await userSupabase
        .from('standalone_requests')
        .select('id, user_id')
        .eq('id', standaloneId)
        .maybeSingle()

      if (standaloneQueryError || !standaloneRow) {
        console.warn(
          `Acesso negado ou solicitação avulsa não encontrada para id=${standaloneId}, userId=${userId}:`,
          standaloneQueryError,
        )
        return jsonResponse(
          { error: 'Você não tem permissão para enviar esta solicitação avulsa.' },
          403,
        )
      }
    }

    // ITEM 2 — Restringir o storageAttachment
    let storageFileToDelete: { bucket: string; path: string } | null = null

    if (storageAttachment) {
      if (storageAttachment.bucket !== 'comprovantes') {
        return jsonResponse(
          { error: 'Bucket de anexo inválido. Somente comprovantes é permitido.' },
          400,
        )
      }

      const expectedPrefix = `relatorios_temp/${userId}/`
      const normalizedPath = String(storageAttachment.path || '').replace(/\\/g, '/')
      if (
        !normalizedPath.startsWith(expectedPrefix) ||
        normalizedPath.includes('..') ||
        normalizedPath.includes('\0')
      ) {
        return jsonResponse(
          { error: 'Caminho de anexo em storage inválido ou não autorizado.' },
          400,
        )
      }
    }

    // Direct attachments validation
    if (directAttachments) {
      if (!Array.isArray(directAttachments)) {
        return jsonResponse({ error: 'Formato inválido para lista de anexos diretos.' }, 400)
      }
      if (directAttachments.length > MAX_DIRECT_ATTACHMENTS) {
        return jsonResponse(
          { error: `O número máximo de anexos diretos permitidos é ${MAX_DIRECT_ATTACHMENTS}.` },
          400,
        )
      }
    }

    // If Resend API key is NOT configured, return fallback info
    if (!resendApiKey) {
      return jsonResponse(
        {
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
        },
        200,
      )
    }

    // Resolve attachments list for Resend API
    const resendAttachments: ResendAttachmentItem[] = []
    let totalAttachmentBytes = 0

    // 1. Process direct base64 attachments if provided
    if (Array.isArray(directAttachments) && directAttachments.length > 0) {
      for (const att of directAttachments) {
        if (att && att.content && att.filename) {
          let cleanBase64 = String(att.content)
          if (cleanBase64.includes('base64,')) {
            cleanBase64 = cleanBase64.split('base64,')[1]
          }
          cleanBase64 = cleanBase64.trim()

          const estimatedBytes = Math.round((cleanBase64.length * 3) / 4)
          totalAttachmentBytes += estimatedBytes

          resendAttachments.push({
            filename: sanitizeFilename(att.filename),
            content: cleanBase64,
          })
        }
      }
    }

    // 2. Process storage attachment if provided (validated bucket + userId prefix)
    if (storageAttachment && storageAttachment.path) {
      const downloadClient = supabaseServiceKey
        ? createClient(supabaseUrl, supabaseServiceKey)
        : userSupabase

      try {
        const { data: fileData, error: downloadError } = await downloadClient.storage
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
            filename: sanitizeFilename(
              storageAttachment.filename || 'relatorio_prestacao_contas.pdf',
            ),
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
      return jsonResponse(
        {
          success: false,
          configured: true,
          error: `O tamanho total dos anexos (${sizeMb} MB) excede o limite máximo permitido para envio por e-mail (35 MB).`,
          message:
            'O PDF consolidado com comprovantes rasterizados é muito grande para os limites de anexo de e-mail corporativo. Por favor, baixe o PDF consolidado pelo app e encaminhe diretamente via cliente de e-mail ou compartilhe o link.',
        },
        200,
      )
    }

    // ITEM 3 — Escape HTML de todos os campos interpolados
    const safeDestination = escapeHtml(tripDetails?.destination)
    const safeStartDate = escapeHtml(tripDetails?.startDate)
    const safeEndDate = escapeHtml(tripDetails?.endDate)
    const safeCollaborator = escapeHtml(
      tripDetails?.collaboratorName || standaloneRequestDetails?.collaboratorName,
    )
    const safeMotivo = escapeHtml(tripDetails?.motivo)
    const safeMessageBody = escapeHtml(messageBody)

    // Detalhes de solicitação avulsa
    const safeStandaloneDesc = escapeHtml(standaloneRequestDetails?.description)
    const safeStandaloneCategory = escapeHtml(standaloneRequestDetails?.category)
    const safeStandaloneDate = escapeHtml(standaloneRequestDetails?.expenseDate)
    const safeStandaloneMerchant = escapeHtml(standaloneRequestDetails?.merchantName)
    const safeStandaloneNotes = escapeHtml(standaloneRequestDetails?.notes)
    const safeStandaloneAmount =
      standaloneRequestDetails?.amount !== undefined
        ? Number(standaloneRequestDetails.amount).toFixed(2)
        : null

    const safeTotalItems =
      expensesSummary?.totalItems !== undefined
        ? Number(expensesSummary.totalItems)
        : standaloneRequestDetails
          ? 1
          : null
    const safeTotalAmount =
      tripDetails?.totalAmount !== undefined
        ? Number(tripDetails.totalAmount).toFixed(2)
        : safeStandaloneAmount

    const isStandalone = Boolean(standaloneRequestDetails)

    const formattedHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="border-bottom: 2px solid #1e40af; padding-bottom: 16px; margin-bottom: 20px;">
          <h2 style="color: #1e40af; margin: 0 0 6px 0; font-size: 20px;">Reembolso.ai Corporativo</h2>
          <p style="color: #64748b; margin: 0; font-size: 13px;">${
            isStandalone
              ? 'Solicitação Avulsa de Reembolso'
              : 'Prestação de Contas e Relatório de Despesas de Viagem'
          }</p>
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0; color: #0f172a; font-size: 15px;">Resumo da Solicitação</h3>
          <table style="width: 100%; font-size: 13px; line-height: 1.6; border-collapse: collapse;">
            ${
              isStandalone && safeStandaloneDesc
                ? `<tr><td style="color: #64748b; width: 140px;">Descrição:</td><td><strong>${safeStandaloneDesc}</strong></td></tr>`
                : ''
            }
            ${
              isStandalone && safeStandaloneCategory
                ? `<tr><td style="color: #64748b;">Categoria:</td><td><span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${safeStandaloneCategory}</span></td></tr>`
                : ''
            }
            ${
              isStandalone && safeStandaloneDate
                ? `<tr><td style="color: #64748b;">Data da Despesa:</td><td>${safeStandaloneDate}</td></tr>`
                : ''
            }
            ${
              isStandalone && safeStandaloneMerchant
                ? `<tr><td style="color: #64748b;">Estabelecimento:</td><td>${safeStandaloneMerchant}</td></tr>`
                : ''
            }
            ${
              !isStandalone && safeDestination
                ? `<tr><td style="color: #64748b; width: 140px;">Destino:</td><td><strong>${safeDestination}</strong></td></tr>`
                : ''
            }
            ${
              !isStandalone && safeStartDate
                ? `<tr><td style="color: #64748b;">Período:</td><td>${safeStartDate}${safeEndDate ? ` a ${safeEndDate}` : ''}</td></tr>`
                : ''
            }
            ${
              safeCollaborator
                ? `<tr><td style="color: #64748b;">Solicitante:</td><td>${safeCollaborator}</td></tr>`
                : ''
            }
            ${
              !isStandalone && safeMotivo
                ? `<tr><td style="color: #64748b;">Motivo:</td><td>${safeMotivo}</td></tr>`
                : ''
            }
            ${
              isStandalone && safeStandaloneNotes
                ? `<tr><td style="color: #64748b;">Observações:</td><td>${safeStandaloneNotes}</td></tr>`
                : ''
            }
            ${
              safeTotalItems !== null
                ? `<tr><td style="color: #64748b;">Comprovantes:</td><td>${safeTotalItems} anexo auditado</td></tr>`
                : ''
            }
            ${
              safeTotalAmount !== null
                ? `<tr><td style="color: #64748b;">Valor Total:</td><td style="color: #10b981; font-weight: bold; font-size: 15px;">R$ ${safeTotalAmount}</td></tr>`
                : ''
            }
            ${
              resendAttachments.length > 0
                ? `<tr><td style="color: #64748b;">Anexos:</td><td style="color: #1e40af; font-weight: 600;">📎 ${resendAttachments
                    .map((a) => escapeHtml(a.filename))
                    .join(', ')}</td></tr>`
                : ''
            }
          </table>
        </div>

        <div style="font-size: 13px; line-height: 1.6; color: #334155; margin-bottom: 24px; white-space: pre-wrap; background: #fafafa; padding: 14px; border-radius: 6px;">${safeMessageBody}</div>

        ${
          resendAttachments.length > 0
            ? `<div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px; margin-bottom: 20px; font-size: 12px; color: #1e40af;">
                <strong>📎 Documento em anexo:</strong> O relatório consolidado de prestação de contas com o comprovante auditado está anexado a este e-mail em formato PDF.
              </div>`
            : ''
        }

        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center;">
          Este e-mail foi gerado automaticamente pelo sistema Reembolso.ai Corporativo.<br/>
          O comprovante foi conferido via OCR e auditado pelas políticas corporativas.
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

    const resendData = await resendResponse.json().catch(() => ({}))

    // Clean up temporary storage file if requested, regardless of send outcome
    if (storageFileToDelete && supabaseUrl) {
      try {
        const cleanupClient = supabaseServiceKey
          ? createClient(supabaseUrl, supabaseServiceKey)
          : userSupabase
        await cleanupClient.storage
          .from(storageFileToDelete.bucket)
          .remove([storageFileToDelete.path])
      } catch (cleanupErr) {
        console.warn('Falha na limpeza do arquivo temporário do Storage:', cleanupErr)
      }
    }

    // ITEM 3 — Respostas de erro genéricas: NUNCA retornar details: resendData nem corpo bruto
    if (!resendResponse.ok) {
      console.error(
        'Erro retornado pela API Resend [HTTP ' + resendResponse.status + ']:',
        resendData,
      )

      let friendlyError = 'Falha no serviço de e-mail ao processar o envio.'
      let friendlyMessage = 'Ocorreu um erro durante a comunicação com o provedor de e-mail.'

      if (resendResponse.status === 401) {
        friendlyError = 'A chave RESEND_API_KEY configurada é inválida ou expirou.'
        friendlyMessage = 'Atualize a chave RESEND_API_KEY no painel de segredos do Supabase.'
      } else if (resendResponse.status === 403) {
        friendlyError =
          'Domínio do remetente não verificado no Resend ou restrito à conta de teste.'
        friendlyMessage =
          'Verifique o domínio no Resend ou envie apenas para o e-mail da conta de teste.'
      } else if (resendResponse.status === 422) {
        friendlyError = 'Os parâmetros de envio de e-mail foram recusados pelo provedor.'
        friendlyMessage = 'Verifique se os endereços de destinatário e remetente são válidos.'
      } else if (resendResponse.status === 429) {
        friendlyError = 'Limite de envios por segundo excedido no Resend.'
        friendlyMessage = 'Aguarde alguns instantes e tente novamente.'
      }

      return jsonResponse(
        {
          success: false,
          configured: true,
          statusCode: resendResponse.status,
          error: friendlyError,
          message: friendlyMessage,
        },
        200,
      )
    }

    return jsonResponse(
      {
        success: true,
        configured: true,
        messageId: resendData?.id,
        recipient: recipientList,
        attachedFiles: resendAttachments.map((a) => a.filename),
      },
      200,
    )
  } catch (err: any) {
    // ITEM 3 — Resposta genérica em exceções sem vazar detalhes crus
    console.error('Erro na Edge Function send-report-email:', err)
    return jsonResponse(
      {
        success: false,
        configured: Boolean(Deno.env.get('RESEND_API_KEY')),
        error: 'Erro inesperado no servidor de envio',
        message: 'Ocorreu uma falha inesperada durante o processamento do envio.',
      },
      500,
    )
  }
})
