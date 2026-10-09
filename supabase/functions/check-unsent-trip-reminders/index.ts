import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

/**
 * Edge Function: check-unsent-trip-reminders
 *
 * Finalidade:
 * Realiza checagem diária (ou sob demanda por administrador) de viagens criadas
 * que ainda NÃO tiveram o relatório enviado (report_sent_at IS NULL).
 *
 * Regra de disparo informada pelo usuário:
 * 1. Primeiro alerta: disparado X dias após a data final da viagem (end_date),
 *    sendo X configurável em profiles.alert_unsent_trip_days (padrão 5).
 * 2. Lembretes recorrentes: a cada Y dias (profiles.alert_unsent_trip_repeat_days,
 *    padrão 7) após o último lembrete enviado com sucesso, enquanto a viagem
 *    permanecer sem relatório enviado.
 *
 * Elegibilidade de viagens:
 * - Toda viagem criada cujo relatório ainda não foi enviado (report_sent_at IS NULL).
 * - Abrange todos os status ativos/pendentes: 'em_triagem', 'com_pendencias',
 *   'auditada', 'fechada' (se por ventura fechada antes de enviar o e-mail).
 * - Exclui APENAS viagens com report_sent_at preenchido e viagens já
 *   'reembolsada' (quitação financeira concluída).
 *
 * Proteções de Segurança:
 * 1. Autenticação Bearer obrigatória (Admin ou Service Role Key do agendador pg_cron).
 * 2. Validação estrita de payload (dryRun, specificUserId).
 * 3. Anti-spam/idempotência: verifica logs de envios anteriores em `trip_reminder_logs`
 *    para assegurar o respeito ao intervalo mínimo de repetição.
 */

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

function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const parts = dateStr.split('-')
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`
  }
  return dateStr
}

function jsonResponse(data: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

interface ProfileRecord {
  id: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  alert_unsent_trip_enabled: boolean
  alert_unsent_trip_days: number
  alert_unsent_trip_repeat_days?: number
}

interface TripRecord {
  id: string
  user_id: string | null
  destination: string
  start_date: string
  end_date: string
  total_amount: number | null
  motivo: string | null
  status: string
  report_sent_at: string | null
}

interface ReminderLogRecord {
  trip_id: string
  user_id: string
  sent_at: string
  status: string
  reminder_sequence?: number
  is_recurrence?: boolean
}

interface ReminderAction {
  trip: TripRecord
  profile: ProfileRecord
  daysElapsedSinceEnd: number
  configuredFirstDays: number
  repeatIntervalDays: number
  isRecurrence: boolean
  sequenceNumber: number
  lastSentAt: string | null
  daysSinceLastReminder: number | null
}

Deno.serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
    const emailSender = Deno.env.get('EMAIL_FROM') || 'Reembolso.ai <onboarding@resend.dev>'
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Configurações de infraestrutura do Supabase ausentes.')
      return jsonResponse({ error: 'Configuração interna do servidor incompleta.' }, 500)
    }

    // 1. Autenticação obrigatória (Bearer token)
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

    // Cliente admin privilegiado para busca de viagens e inserção de logs
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Checar se o token corresponde à Service Role Key (disparo agendado via pg_cron)
    const isServiceRole = token === supabaseServiceKey

    let callerUserId: string | null = null
    let callerIsAdmin = false

    if (!isServiceRole) {
      // Validar JWT do usuário solicitante
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })

      const { data: userData, error: userError } = await userClient.auth.getUser(token)
      if (userError || !userData?.user) {
        return jsonResponse(
          { error: 'Não autorizado. Token de autenticação inválido ou expirado.' },
          401,
        )
      }

      callerUserId = userData.user.id

      // Checar se o usuário autenticado possui papel de administrador
      const { data: profileData } = await adminSupabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', callerUserId)
        .maybeSingle()

      callerIsAdmin = profileData?.role === 'admin' && profileData?.is_active === true

      if (!callerIsAdmin) {
        return jsonResponse(
          {
            error:
              'Acesso negado. Apenas administradores podem disparar a checagem manual de alertas.',
          },
          403,
        )
      }
    }

    // 2. Leitura e validação do payload
    let reqBody: { dryRun?: boolean; specificUserId?: string } = {}
    try {
      if (req.method === 'POST') {
        reqBody = await req.json()
      }
    } catch {
      reqBody = {}
    }

    const dryRun = Boolean(reqBody.dryRun)
    const specificUserId = reqBody.specificUserId?.trim()

    if (specificUserId && !UUID_REGEX.test(specificUserId)) {
      return jsonResponse({ error: 'Formato inválido de specificUserId.' }, 400)
    }

    // 3. Buscar perfis ativos que possuem o alerta habilitado
    let profilesQuery = adminSupabase
      .from('profiles')
      .select(
        'id, email, full_name, role, is_active, alert_unsent_trip_enabled, alert_unsent_trip_days, alert_unsent_trip_repeat_days',
      )
      .eq('is_active', true)
      .eq('alert_unsent_trip_enabled', true)

    if (specificUserId) {
      profilesQuery = profilesQuery.eq('id', specificUserId)
    }

    const { data: eligibleProfilesRaw, error: profilesError } = await profilesQuery
    if (profilesError) {
      console.error('Erro ao consultar perfis para alertas:', profilesError)
      return jsonResponse({ error: 'Erro ao consultar perfis de usuários.' }, 500)
    }

    const eligibleProfiles = (eligibleProfilesRaw || []) as ProfileRecord[]

    if (eligibleProfiles.length === 0) {
      return jsonResponse(
        {
          success: true,
          message: 'Nenhum usuário com alerta de viagem não enviada habilitado.',
          evaluatedCount: 0,
          remindersSent: 0,
          firstReminderCount: 0,
          recurringReminderCount: 0,
          dryRun,
        },
        200,
      )
    }

    const profileMap = new Map<string, ProfileRecord>()
    for (const p of eligibleProfiles) {
      profileMap.set(p.id, p)
    }

    const eligibleUserIds = eligibleProfiles.map((p) => p.id)

    // 4. Buscar viagens NÃO enviadas desses usuários
    // Critérios precisos:
    // - report_sent_at IS NULL (relatório não enviado)
    // - status != 'reembolsada' (já quitada)
    // - end_date preenchida
    // - Inclui explicitamente: 'em_triagem', 'com_pendencias', 'auditada', 'fechada'
    const { data: candidateTripsRaw, error: tripsError } = await adminSupabase
      .from('trips')
      .select(
        'id, user_id, destination, start_date, end_date, total_amount, motivo, status, report_sent_at',
      )
      .in('user_id', eligibleUserIds)
      .is('report_sent_at', null)
      .neq('status', 'reembolsada')

    if (tripsError) {
      console.error('Erro ao consultar viagens pendentes para lembretes:', tripsError)
      return jsonResponse({ error: 'Erro ao consultar viagens pendentes.' }, 500)
    }

    const candidateTrips = (candidateTripsRaw || []) as TripRecord[]

    if (candidateTrips.length === 0) {
      return jsonResponse(
        {
          success: true,
          message: 'Nenhuma viagem pendente de envio encontrada.',
          evaluatedCount: 0,
          evaluatedTripsCount: 0,
          dueRemindersCount: 0,
          remindersSent: 0,
          firstReminderCount: 0,
          recurringReminderCount: 0,
          dryRun,
        },
        200,
      )
    }

    // 5. Buscar histórico de lembretes já enviados com sucesso para essas viagens
    const tripIds = candidateTrips.map((t) => t.id)
    const { data: existingLogsRaw, error: logsError } = await adminSupabase
      .from('trip_reminder_logs')
      .select('trip_id, user_id, sent_at, status, reminder_sequence, is_recurrence')
      .in('trip_id', tripIds)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })

    if (logsError) {
      console.warn('Erro ao consultar logs de lembretes existentes:', logsError)
    }

    const existingLogs = (existingLogsRaw || []) as ReminderLogRecord[]

    // Mapear por chave `${trip_id}:${user_id}`:
    // - count de envios de sucesso
    // - lastSentAt (timestamp mais recente de envio)
    interface SentHistory {
      count: number
      lastSentAt: string
    }
    const historyMap = new Map<string, SentHistory>()

    for (const log of existingLogs) {
      const key = `${log.trip_id}:${log.user_id}`
      const existing = historyMap.get(key)
      if (!existing) {
        historyMap.set(key, {
          count: 1,
          lastSentAt: log.sent_at,
        })
      } else {
        existing.count += 1
        // Como ordenado sent_at DESC, o primeiro lido é o mais recente
      }
    }

    // 6. Avaliar viagens conforme a nova regra:
    // - 1º Alerta: se nenhum lembrete enviado e dias decorridos do fim >= alert_unsent_trip_days (padrão 5)
    // - Reenvio recorrente: se já houve pelo menos 1 lembrete e se passaram >= alert_unsent_trip_repeat_days (padrão 7)
    //   desde o último envio
    const today = new Date()
    const todayMidnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    )
    const nowMs = Date.now()

    const actionsToExecute: ReminderAction[] = []

    for (const trip of candidateTrips) {
      if (!trip.user_id || !trip.end_date) continue

      const profile = profileMap.get(trip.user_id)
      if (!profile) continue

      // Calcular diferença de dias entre end_date e hoje
      const [y, m, d] = trip.end_date.split('-').map(Number)
      if (!y || !m || !d) continue

      const tripEndDate = new Date(Date.UTC(y, m - 1, d))
      const diffMsFromEnd = todayMidnight.getTime() - tripEndDate.getTime()
      const daysElapsedSinceEnd = Math.floor(diffMsFromEnd / (1000 * 60 * 60 * 24))

      const configuredFirstDays = profile.alert_unsent_trip_days ?? 5
      const repeatIntervalDays = profile.alert_unsent_trip_repeat_days ?? 7

      const key = `${trip.id}:${trip.user_id}`
      const history = historyMap.get(key)

      if (!history || history.count === 0) {
        // NENHUM lembrete enviado ainda para esta viagem
        // Dispara o 1º alerta se daysElapsedSinceEnd >= configuredFirstDays
        if (daysElapsedSinceEnd >= configuredFirstDays) {
          actionsToExecute.push({
            trip,
            profile,
            daysElapsedSinceEnd,
            configuredFirstDays,
            repeatIntervalDays,
            isRecurrence: false,
            sequenceNumber: 1,
            lastSentAt: null,
            daysSinceLastReminder: null,
          })
        }
      } else {
        // Já recebeu pelo menos 1 lembrete anterior
        // Verificar se já passou o intervalo de repetição (ex: 7 dias) desde o último envio
        const lastSentDate = new Date(history.lastSentAt)
        const diffMsFromLastSent = nowMs - lastSentDate.getTime()
        const daysSinceLastReminder = Math.floor(diffMsFromLastSent / (1000 * 60 * 60 * 24))

        if (daysSinceLastReminder >= repeatIntervalDays) {
          actionsToExecute.push({
            trip,
            profile,
            daysElapsedSinceEnd,
            configuredFirstDays,
            repeatIntervalDays,
            isRecurrence: true,
            sequenceNumber: history.count + 1,
            lastSentAt: history.lastSentAt,
            daysSinceLastReminder,
          })
        }
      }
    }

    const firstReminderActions = actionsToExecute.filter((a) => !a.isRecurrence)
    const recurringActions = actionsToExecute.filter((a) => a.isRecurrence)

    // Se estiver em modo dry-run, retorna detalhamento completo
    if (dryRun) {
      return jsonResponse(
        {
          success: true,
          dryRun: true,
          evaluatedCount: candidateTrips.length,
          evaluatedTripsCount: candidateTrips.length,
          dueRemindersCount: actionsToExecute.length,
          firstReminderCount: firstReminderActions.length,
          recurringReminderCount: recurringActions.length,
          dueReminders: actionsToExecute.map((a) => ({
            tripId: a.trip.id,
            destination: a.trip.destination,
            status: a.trip.status,
            endDate: a.trip.end_date,
            daysElapsed: a.daysElapsedSinceEnd,
            configuredDays: a.configuredFirstDays,
            repeatIntervalDays: a.repeatIntervalDays,
            isRecurrence: a.isRecurrence,
            sequenceNumber: a.sequenceNumber,
            lastSentAt: a.lastSentAt,
            daysSinceLastReminder: a.daysSinceLastReminder,
            recipientEmail: a.profile.email,
            recipientName: a.profile.full_name,
          })),
        },
        200,
      )
    }

    // Se não há Resend configurado, reporta claramente
    if (!resendApiKey) {
      return jsonResponse(
        {
          success: false,
          configured: false,
          error: 'Provedor de e-mail não configurado',
          message:
            'A chave RESEND_API_KEY não foi configurada nas variáveis de ambiente do backend Supabase. Os lembretes não puderam ser disparados automaticamente.',
          evaluatedCount: candidateTrips.length,
          evaluatedTripsCount: candidateTrips.length,
          dueRemindersCount: actionsToExecute.length,
          firstReminderCount: firstReminderActions.length,
          recurringReminderCount: recurringActions.length,
        },
        200,
      )
    }

    // 7. Disparar e-mails via Resend e registrar logs
    const results: Array<{
      tripId: string
      recipientEmail: string
      isRecurrence: boolean
      sequenceNumber: number
      success: boolean
      error?: string
    }> = []

    for (const action of actionsToExecute) {
      const {
        trip,
        profile,
        daysElapsedSinceEnd,
        configuredFirstDays,
        repeatIntervalDays,
        isRecurrence,
        sequenceNumber,
        daysSinceLastReminder,
      } = action

      const recipient = profile.email

      // Assunto diferenciado para 1º alerta vs reenvios recorrentes
      const subject = isRecurrence
        ? `[Lembrete Recorrente #${sequenceNumber}] Prestação de contas de ${trip.destination} ainda pendente de envio`
        : `Lembrete: Prestação de contas de ${trip.destination} pendente de envio`

      const formattedAmount = trip.total_amount
        ? Number(trip.total_amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : 'R$ 0,00'

      // Mensagem explicativa diferenciada
      const introMessageHtml = isRecurrence
        ? `Este é um <strong>lembrete recorrente</strong> sobre a sua viagem para <strong>${escapeHtml(
            trip.destination,
          )}</strong>, finalizada em ${formatDateBR(trip.end_date)} (há <strong>${daysElapsedSinceEnd} dias</strong>). O relatório de prestação de contas continua pendente de envio.`
        : `Sua viagem para <strong>${escapeHtml(
            trip.destination,
          )}</strong> terminou há <strong>${daysElapsedSinceEnd} dias</strong> (${formatDateBR(
            trip.end_date,
          )}) e o relatório de prestação de contas ainda não foi despachado para a controladoria.`

      const reasonCardHtml = isRecurrence
        ? `<div style="background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin-bottom: 20px; font-size: 13px; color: #92400e;">
            <strong>⏱️ Por que estou recebendo este lembrete recorrente?</strong><br/>
            Seu perfil está configurado para receber um alerta inicial ${configuredFirstDays} dias após a viagem e <strong>reenvios a cada ${repeatIntervalDays} dias</strong> até que o relatório seja enviado.
            ${
              daysSinceLastReminder !== null
                ? `<br/><span style="font-size: 11px; color: #b45309;">(Último aviso enviado há ${daysSinceLastReminder} dias).</span>`
                : ''
            }
          </div>`
        : `<div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; margin-bottom: 20px; font-size: 13px; color: #1e40af;">
            <strong>📌 Por que estou recebendo este e-mail?</strong><br/>
            Seu perfil está configurado para receber o primeiro alerta <strong>${configuredFirstDays} dias</strong> após o término da viagem caso ela ainda não tenha sido enviada. Se continuar pendente, um novo lembrete será enviado a cada <strong>${repeatIntervalDays} dias</strong> até a conclusão.
          </div>`

      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="border-bottom: 2px solid #1e40af; padding-bottom: 16px; margin-bottom: 20px;">
            <h2 style="color: #1e40af; margin: 0 0 6px 0; font-size: 20px;">Reembolso.ai Corporativo</h2>
            <p style="color: #64748b; margin: 0; font-size: 13px;">
              ${isRecurrence ? `Lembrete Periódico de Prestação de Contas (#${sequenceNumber})` : 'Lembrete de Prestação de Contas Pendente'}
            </p>
          </div>

          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            Olá, <strong>${escapeHtml(profile.full_name || 'Colaborador')}</strong>,
          </p>

          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            ${introMessageHtml}
          </p>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #0f172a; font-size: 14px;">Dados da Viagem</h3>
            <table style="width: 100%; font-size: 13px; line-height: 1.6; border-collapse: collapse;">
              <tr>
                <td style="color: #64748b; width: 140px;">Destino:</td>
                <td><strong>${escapeHtml(trip.destination)}</strong></td>
              </tr>
              <tr>
                <td style="color: #64748b;">Período:</td>
                <td>${formatDateBR(trip.start_date)} a ${formatDateBR(trip.end_date)}</td>
              </tr>
              ${
                trip.motivo
                  ? `<tr><td style="color: #64748b;">Motivo:</td><td>${escapeHtml(trip.motivo)}</td></tr>`
                  : ''
              }
              <tr>
                <td style="color: #64748b;">Status Atual:</td>
                <td><span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background-color: #e2e8f0; font-weight: 600; font-size: 11px; text-transform: uppercase;">${escapeHtml(trip.status)}</span></td>
              </tr>
              <tr>
                <td style="color: #64748b;">Total Acumulado:</td>
                <td style="color: #10b981; font-weight: bold;">${formattedAmount}</td>
              </tr>
            </table>
          </div>

          ${reasonCardHtml}

          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            Para concluir o processo e liberar seu reembolso, acesse o sistema Reembolso.ai, confira os comprovantes anexados e clique em <strong>Enviar Relatório</strong>.
          </p>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: center;">
            Este é um lembrete automático do Reembolso.ai Corporativo.<br/>
            Você pode alterar suas preferências de alertas na aba de Gestão de Usuários ou Configurações do seu perfil.
          </div>
        </div>
      `

      const textBody = isRecurrence
        ? `Olá ${profile.full_name},\n\n[Lembrete Recorrente #${sequenceNumber}] A prestação de contas da sua viagem para ${trip.destination} (${formatDateBR(trip.start_date)} a ${formatDateBR(trip.end_date)}) continua pendente de envio há ${daysElapsedSinceEnd} dias.\nTotal acumulado: ${formattedAmount}.\n\nAcesse o sistema Reembolso.ai para enviar sua prestação de contas.`
        : `Olá ${profile.full_name},\n\nSua viagem para ${trip.destination} terminou há ${daysElapsedSinceEnd} dias (${formatDateBR(trip.end_date)}) e o relatório de prestação de contas ainda não foi enviado.\nTotal acumulado: ${formattedAmount}.\n\nAcesse o sistema Reembolso.ai para enviar sua prestação de contas.`

      try {
        const resendPayload = {
          from: emailSender,
          to: [recipient],
          subject,
          html: emailHtml,
          text: textBody,
        }

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(resendPayload),
        })

        const resendData = await resendRes.json().catch(() => ({}))

        if (resendRes.ok) {
          // Registrar log de sucesso com sequência e flag de recorrência
          await adminSupabase.from('trip_reminder_logs').insert({
            trip_id: trip.id,
            user_id: trip.user_id,
            recipient_email: recipient,
            days_after_end: daysElapsedSinceEnd,
            reminder_sequence: sequenceNumber,
            is_recurrence: isRecurrence,
            status: 'sent',
            message_id: resendData?.id || null,
          })

          results.push({
            tripId: trip.id,
            recipientEmail: recipient,
            isRecurrence,
            sequenceNumber,
            success: true,
          })
        } else {
          console.error(
            `Falha ao enviar e-mail de lembrete para trip=${trip.id}, recipient=${recipient} [HTTP ${resendRes.status}]:`,
            resendData,
          )

          // Registrar log de falha para auditoria
          await adminSupabase.from('trip_reminder_logs').insert({
            trip_id: trip.id,
            user_id: trip.user_id,
            recipient_email: recipient,
            days_after_end: daysElapsedSinceEnd,
            reminder_sequence: sequenceNumber,
            is_recurrence: isRecurrence,
            status: 'error',
            error_message: `HTTP ${resendRes.status}`,
          })

          results.push({
            tripId: trip.id,
            recipientEmail: recipient,
            isRecurrence,
            sequenceNumber,
            success: false,
            error: `Erro no provedor de e-mail (HTTP ${resendRes.status})`,
          })
        }
      } catch (sendErr: any) {
        console.error(`Exceção ao disparar lembrete para trip=${trip.id}:`, sendErr)
        results.push({
          tripId: trip.id,
          recipientEmail: recipient,
          isRecurrence,
          sequenceNumber,
          success: false,
          error: 'Exceção no envio',
        })
      }
    }

    const successfulCount = results.filter((r) => r.success).length

    return jsonResponse(
      {
        success: true,
        evaluatedTripsCount: candidateTrips.length,
        dueRemindersCount: actionsToExecute.length,
        firstReminderCount: firstReminderActions.length,
        recurringReminderCount: recurringActions.length,
        remindersSent: successfulCount,
        results,
      },
      200,
    )
  } catch (err: any) {
    console.error('Erro geral na edge function check-unsent-trip-reminders:', err)
    return jsonResponse(
      {
        error: 'Erro interno ao processar verificação de lembretes.',
      },
      500,
    )
  }
})
