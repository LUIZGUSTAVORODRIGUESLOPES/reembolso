import { supabase } from '@/lib/supabase/client'
import { Trip, Expense } from '@/types/database'
import { generateConsolidatedReportBlob } from './reportExportService'

export interface EmailProviderConfigStatus {
  configured: boolean
  provider: string | null
  sender?: string
}

export interface SendReportEmailParams {
  to: string
  subject: string
  body: string
  trip: Trip
  expenses: Expense[]
  collaboratorName?: string
  attachPdf?: boolean
  attachReceipts?: boolean
  onProgress?: (step: string) => void
}

export interface SendReportEmailResult {
  success: boolean
  configured: boolean
  messageId?: string
  error?: string
  message?: string
  rawError?: string
  errorAction?: string
  details?: any
  attachedFiles?: string[]
  mailToFallback?: {
    to: string
    subject: string
    body: string
  }
}

/**
 * Traduz e formata erros retornados pelo Resend ou pela Edge Function
 * em orientações acionáveis em pt-BR.
 */
export function formatResendError(
  rawMsg: string,
  statusCode?: number,
): { message: string; action?: string } {
  const lower = (rawMsg || '').toLowerCase()

  // Erro de tamanho excessivo de anexos
  if (
    lower.includes('excede o limite') ||
    lower.includes('too large') ||
    lower.includes('payload too large') ||
    lower.includes('413') ||
    (lower.includes('attachment') && lower.includes('limit'))
  ) {
    return {
      message:
        rawMsg ||
        'O tamanho total dos anexos ultrapassa o limite permitido para envio direto por e-mail.',
      action:
        'Baixe o PDF consolidado pelo botão no app e envie manualmente através do seu cliente de e-mail (Outlook / Mail).',
    }
  }

  // Erro 403: Domínio não verificado / Restrição da conta de teste do Resend
  if (
    lower.includes('only send testing emails to your own email address') ||
    lower.includes('testing emails to your own') ||
    lower.includes('domain is not verified') ||
    lower.includes('domain not verified') ||
    lower.includes('verify your domain') ||
    (statusCode === 403 && lower.includes('domain'))
  ) {
    return {
      message:
        'Seu domínio ainda não está verificado no Resend: por enquanto o envio automático só funciona para o próprio e-mail da conta Resend.',
      action:
        'Verifique o domínio em Resend → Domains (adicionando os registros DNS MX/TXT) ou use a alternativa do cliente de e-mail local (Outlook / Mail).',
    }
  }

  // Erro de remetente inválido (campo from / EMAIL_FROM)
  if (
    lower.includes('from') &&
    (lower.includes('domain') ||
      lower.includes('verified') ||
      lower.includes('not allow') ||
      lower.includes('invalid'))
  ) {
    return {
      message: 'O endereço remetente (EMAIL_FROM) não pertence a um domínio verificado no Resend.',
      action:
        'Configure o segredo EMAIL_FROM no Supabase com um endereço do seu domínio verificado (ex: notificacoes@seudominio.com.br) ou use "onboarding@resend.dev" para testes.',
    }
  }

  // Erro 401: Chave de API inválida ou revogada
  if (
    statusCode === 401 ||
    lower.includes('api key is invalid') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthorized')
  ) {
    return {
      message: 'A chave RESEND_API_KEY configurada é inválida ou expirou.',
      action:
        'Gere uma nova chave em resend.com/api-keys e atualize o segredo RESEND_API_KEY no Supabase.',
    }
  }

  // Erro 422: Validação de campos (destinatário inválido, formato, etc.)
  if (statusCode === 422 || lower.includes('validation_error') || lower.includes('invalid email')) {
    return {
      message: `Erro de validação do envio: ${rawMsg}`,
      action: 'Verifique se o e-mail do destinatário está no formato correto e sem espaços.',
    }
  }

  // Erro de limite de envio (429 Rate Limit)
  if (statusCode === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      message: 'Limite de envios por segundo excedido no Resend.',
      action: 'Aguarde alguns instantes e tente novamente.',
    }
  }

  // Erro genérico com o texto original preservado
  return {
    message: rawMsg || 'Falha ao processar o envio através do serviço de e-mail.',
  }
}

/**
 * Converte um Blob em string Base64 limpa (sem data URL prefix)
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const res = reader.result as string
      const base64 = res.includes('base64,') ? res.split('base64,')[1] : res
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

class ReportEmailService {
  /**
   * Checks whether an external email service (e.g. Resend) is configured in the Supabase backend.
   */
  async checkConfig(): Promise<EmailProviderConfigStatus> {
    try {
      const { data, error } = await supabase.functions.invoke('send-report-email', {
        body: { checkConfigOnly: true },
      })

      if (error || !data) {
        return { configured: false, provider: null }
      }

      return {
        configured: Boolean(data.configured),
        provider: data.provider || null,
        sender: data.sender,
      }
    } catch (err) {
      console.warn('Falha ao checar status do provedor de e-mail:', err)
      return { configured: false, provider: null }
    }
  }

  /**
   * Sends the trip report by email via the backend Edge Function,
   * including the consolidated PDF as an attachment.
   */
  async sendReportEmail(params: SendReportEmailParams): Promise<SendReportEmailResult> {
    const {
      to,
      subject,
      body,
      trip,
      expenses,
      collaboratorName,
      attachPdf = true,
      onProgress,
    } = params

    try {
      let storageAttachmentPayload: {
        bucket: string
        path: string
        filename: string
        cleanupAfterSend: boolean
      } | null = null

      let directAttachmentsPayload: Array<{ filename: string; content: string }> | null = null

      // If user wants to attach the PDF, generate it and prepare either Storage upload or direct base64
      if (attachPdf) {
        onProgress?.('Gerando PDF consolidado com todos os comprovantes...')
        try {
          const { blob, filename } = await generateConsolidatedReportBlob(
            trip,
            expenses,
            collaboratorName,
            (curr, tot, msg) => {
              onProgress?.(`${msg} (${Math.round((curr / tot) * 100)}%)`)
            },
          )

          const pdfSizeBytes = blob.size
          const pdfSizeMb = (pdfSizeBytes / (1024 * 1024)).toFixed(2)
          console.info(`PDF consolidado gerado: ${filename} (${pdfSizeMb} MB)`)

          // If PDF is larger than 35MB, fail gracefully with friendly message
          if (pdfSizeBytes > 35 * 1024 * 1024) {
            return {
              success: false,
              configured: true,
              error: `O PDF consolidado tem ${pdfSizeMb} MB e excede o limite máximo permitido de 35 MB.`,
              message:
                'O relatório consolidado com todos os comprovantes rasterizados é muito grande para anexar no e-mail corporativo. Baixe o PDF diretamente pelo app e encaminhe pelo seu cliente de e-mail.',
              errorAction:
                'Utilize o botão "Baixar em PDF Consolidado" no modal de prévia e compartilhe via Drive ou cliente de e-mail local.',
              mailToFallback: { to, subject, body },
            }
          }

          // Try uploading to Storage bucket 'comprovantes' under temporary prefix 'relatorios_temp/'
          // If upload fails (e.g. permission), fall back to direct base64 in body
          let storageUploaded = false
          try {
            onProgress?.('Fazendo upload do anexo para o servidor de envio...')
            const tempStoragePath = `relatorios_temp/${Date.now()}_${filename}`
            const { error: uploadError } = await supabase.storage
              .from('comprovantes')
              .upload(tempStoragePath, blob, {
                contentType: 'application/pdf',
                upsert: true,
              })

            if (!uploadError) {
              storageUploaded = true
              storageAttachmentPayload = {
                bucket: 'comprovantes',
                path: tempStoragePath,
                filename,
                cleanupAfterSend: true,
              }
            } else {
              console.warn('Storage upload falhou, tentando fallback base64 direto:', uploadError)
            }
          } catch (uploadExc) {
            console.warn('Exceção no upload para Storage, tentando fallback direto:', uploadExc)
          }

          // If not uploaded to storage, convert to base64 directly
          if (!storageUploaded) {
            onProgress?.('Codificando PDF para anexo direto...')
            const base64Data = await blobToBase64(blob)
            directAttachmentsPayload = [
              {
                filename,
                content: base64Data,
              },
            ]
          }
        } catch (pdfGenErr: any) {
          console.error('Falha ao compilar PDF para anexo:', pdfGenErr)
          return {
            success: false,
            configured: true,
            error: `Não foi possível gerar o PDF para anexo: ${pdfGenErr?.message || 'erro interno'}`,
            message:
              'Houve uma falha ao compilar o PDF consolidado dos comprovantes. Você pode enviar apenas o resumo ou baixar os comprovantes avulsos.',
            mailToFallback: { to, subject, body },
          }
        }
      }

      onProgress?.('Despachando mensagem e anexos através da API de e-mail...')

      const payload: Record<string, unknown> = {
        to,
        subject,
        body,
        tripDetails: {
          id: trip.id,
          destination: trip.destination,
          startDate: trip.start_date,
          endDate: trip.end_date,
          totalAmount: trip.total_amount,
          motivo: trip.motivo,
          collaboratorName,
        },
        expensesSummary: {
          totalItems: expenses.length,
          totalAmount: trip.total_amount,
        },
      }

      if (storageAttachmentPayload) {
        payload.storageAttachment = storageAttachmentPayload
      }
      if (directAttachmentsPayload) {
        payload.attachments = directAttachmentsPayload
      }

      const { data, error } = await supabase.functions.invoke('send-report-email', {
        body: payload,
      })

      if (error) {
        console.error('Erro retornado pela chamada send-report-email:', error)
        let serverErrorText = error.message || 'Falha ao comunicar com o servidor de e-mail.'
        let errorDetails: any = null
        let isConfigured = false

        try {
          if ((error as any).context && typeof (error as any).context.json === 'function') {
            const parsed = await (error as any).context.json()
            if (parsed) {
              serverErrorText = parsed.error || parsed.message || serverErrorText
              errorDetails = parsed.details
              isConfigured = Boolean(parsed.configured)
            }
          }
        } catch {
          // ignore parsing error
        }

        const formatted = formatResendError(serverErrorText)

        return {
          success: false,
          configured: isConfigured,
          error: formatted.message,
          message: formatted.message,
          rawError: serverErrorText,
          errorAction: formatted.action,
          details: errorDetails,
          mailToFallback: {
            to,
            subject,
            body,
          },
        }
      }

      if (data && data.success) {
        return {
          success: true,
          configured: true,
          messageId: data.messageId,
          attachedFiles: data.attachedFiles,
        }
      }

      // Backend returned 200 with success: false
      const rawMsg = data?.error || data?.message || 'Falha no serviço de e-mail'
      const formatted = formatResendError(rawMsg, data?.statusCode)

      return {
        success: false,
        configured: Boolean(data?.configured),
        error: formatted.message,
        message: data?.message || formatted.message,
        rawError: rawMsg,
        errorAction: formatted.action,
        details: data?.details,
        mailToFallback: data?.mailToFallback || {
          to,
          subject,
          body,
        },
      }
    } catch (err: any) {
      console.error('Falha de exceção ao disparar e-mail:', err)
      const rawMsg = err?.message || 'Erro inesperado ao disparar e-mail'
      const formatted = formatResendError(rawMsg)
      return {
        success: false,
        configured: false,
        error: formatted.message,
        message: formatted.message,
        rawError: rawMsg,
        errorAction: formatted.action,
        mailToFallback: {
          to,
          subject,
          body,
        },
      }
    }
  }

  /**
   * Generates a mailto: link so user can open their default email client with all
   * prestação de contas details prefilled when automated server sending is not enabled.
   */
  createMailToLink(to: string, subject: string, body: string): string {
    const safeTo = encodeURIComponent(to)
    const safeSubject = encodeURIComponent(subject)
    const safeBody = encodeURIComponent(body)
    return `mailto:${safeTo}?subject=${safeSubject}&body=${safeBody}`
  }
}

export const reportEmailService = new ReportEmailService()
