import { supabase } from '@/lib/supabase/client'

/**
 * Chave de armazenamento local para persistir o timestamp da última checagem automática.
 */
export const REMINDER_LAST_CHECK_KEY = 'lastReminderCheck'

/**
 * Intervalo mínimo entre checagens diárias automáticas por dispositivo: 20 horas em milissegundos.
 */
export const REMINDER_COOLDOWN_MS = 20 * 60 * 60 * 1000

export interface DueReminderItem {
  tripId: string
  destination: string
  status?: string
  endDate: string
  daysElapsed: number
  daysOverdue?: number
  configuredDays: number
  repeatIntervalDays?: number
  isRecurrence?: boolean
  sequenceNumber?: number
  lastSentAt?: string | null
  daysSinceLastReminder?: number | null
  recipientEmail: string
  recipientName: string
}

export interface AwaitingNextCycleItem {
  tripId: string
  destination: string
  status: string
  endDate: string
  daysElapsed: number
  daysOverdue: number
  configuredDays: number
  repeatIntervalDays: number
  remindersSentCount: number
  lastReminderAt: string
  daysSinceLastReminder: number
  nextReminderInDays: number
  nextReminderDate: string
  recipientEmail: string
  recipientName: string
}

export interface NotYetDueItem {
  tripId: string
  destination: string
  status: string
  endDate: string
  daysElapsed: number
  configuredDays: number
  daysUntilDue: number
  dueDate: string
  recipientEmail: string
  recipientName: string
}

export interface ReminderCheckResult {
  success: boolean
  configured?: boolean
  error?: string
  message?: string
  tripsAssessed?: number
  evaluatedTripsCount?: number
  evaluatedCount?: number
  dueRemindersCount?: number
  firstReminderCount?: number
  recurringReminderCount?: number
  remindersSent?: number
  dryRun?: boolean
  dueNow?: DueReminderItem[]
  dueReminders?: DueReminderItem[]
  awaitingNextCycle?: AwaitingNextCycleItem[]
  awaitingNextCycleCount?: number
  notYetDue?: NotYetDueItem[]
  notYetDueCount?: number
  results?: Array<{
    tripId: string
    recipientEmail: string
    isRecurrence?: boolean
    sequenceNumber?: number
    success: boolean
    error?: string
  }>
}

/**
 * Serviço responsável por gerenciar a verificação diária de lembretes
 * de viagens não enviadas no cliente, acionando a edge function `check-unsent-trip-reminders`.
 */
export const reminderTriggerService = {
  /**
   * Invoca a edge function passando os parâmetros desejados (modo real ou dry-run).
   * O cliente Supabase envia automaticamente o header Authorization com o Bearer token da sessão ativa.
   */
  async invokeCheck(options?: {
    dryRun?: boolean
    specificUserId?: string
  }): Promise<ReminderCheckResult> {
    const { data, error } = await supabase.functions.invoke('check-unsent-trip-reminders', {
      body: {
        dryRun: Boolean(options?.dryRun),
        ...(options?.specificUserId ? { specificUserId: options.specificUserId } : {}),
      },
    })

    if (error) {
      throw error
    }

    return (data as ReminderCheckResult) || { success: true }
  },

  /**
   * Verifica se já se passaram ~20 horas desde a última checagem registrada no localStorage.
   */
  shouldRunDailyCheck(): boolean {
    try {
      const lastCheck = localStorage.getItem(REMINDER_LAST_CHECK_KEY)
      if (!lastCheck) return true

      const lastTimestamp = parseInt(lastCheck, 10)
      if (isNaN(lastTimestamp)) return true

      const elapsed = Date.now() - lastTimestamp
      return elapsed >= REMINDER_COOLDOWN_MS
    } catch {
      return true
    }
  },

  /**
   * Registra o timestamp atual no localStorage.
   */
  recordCheckTimestamp(): void {
    try {
      localStorage.setItem(REMINDER_LAST_CHECK_KEY, Date.now().toString())
    } catch {
      // Ignora falhas de escrita em storage restrito
    }
  },

  /**
   * Gatilho silencioso em segundo plano executado ao carregar o app.
   * Regras:
   * 1. Apenas se o usuário for administrador ativo (isAdmin = true).
   * 2. No máximo uma vez a cada 20h por dispositivo.
   * 3. Execução assíncrona desacoplada da UI; falhas de rede geram apenas console.warn.
   */
  runDailyBackgroundCheckIfAdmin(isAdmin: boolean): void {
    if (!isAdmin) {
      return
    }

    if (!this.shouldRunDailyCheck()) {
      return
    }

    // Executar de forma desacoplada para não impactar o carregamento da tela
    setTimeout(async () => {
      try {
        // Nova conferência de segurança antes de disparar
        if (!this.shouldRunDailyCheck()) return

        const res = await this.invokeCheck({ dryRun: false })
        this.recordCheckTimestamp()

        if (res?.remindersSent && res.remindersSent > 0) {
          console.info(
            `[Reembolso.ai] Checagem diária automática concluída: ${res.remindersSent} lembrete(s) de viagem pendente enviado(s).`,
          )
        }
      } catch (err) {
        // Silencioso por design: apenas console.warn, nunca toast de erro para o usuário
        console.warn(
          '[Reembolso.ai] Checagem diária automática em segundo plano não pôde ser concluída:',
          err,
        )
      }
    }, 2000)
  },
}
