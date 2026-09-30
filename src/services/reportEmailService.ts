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
  mailToFallback?: {
    to: string
    subject: string
    body: string
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

      if (error) {
        console.error('Erro na chamada da Edge Function send-report-email:', error)
        return {
          success: false,
          configured: false,
          error: error.message || 'Falha ao comunicar com o servidor de e-mail.',
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

      // Backend returned status: not configured or delivery error
      return {
        success: false,
        configured: Boolean(data?.configured),
        error: data?.error || 'Erro no envio do e-mail',
        message: data?.message,
        mailToFallback: data?.mailToFallback || {
          to,
          subject,
          body,
        },
      }
    } catch (err: any) {
      console.error('Falha de exceção ao disparar e-mail:', err)
      return {
        success: false,
        configured: false,
        error: err?.message || 'Erro inesperado ao disparar e-mail',
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
