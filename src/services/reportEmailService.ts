import { supabase } from '@/lib/supabase/client'
import { Trip, Expense } from '@/types/database'
import { formatDateRangeBR, formatCurrencyBRL } from '@/lib/formatters'

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
   * Sends the trip report by email via the backend Edge Function or returns clear fallback diagnostics.
   */
  async sendReportEmail(params: SendReportEmailParams): Promise<SendReportEmailResult> {
    const { to, subject, body, trip, expenses, collaboratorName } = params

    try {
      const payload = {
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

      const { data, error } = await supabase.functions.invoke('send-report-email', {
        body: payload,
      })

      // Even if supabase.functions.invoke returns an error (HTTP status != 2xx),
      // error.context may contain response data or error details.
      if (error) {
        console.error('Erro retornado pela chamada send-report-email:', error)
        let serverErrorText = error.message || 'Falha ao comunicar com o servidor de e-mail.'
        let errorDetails: any = null
        let isConfigured = false

        // Tenta extrair resposta JSON que a Edge Function possa ter anexado
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
        }
      }

      // Backend returned 200 with success: false (Resend error, unconfigured, etc.)
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
