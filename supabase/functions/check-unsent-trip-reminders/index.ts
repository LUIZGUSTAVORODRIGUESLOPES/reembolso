import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

/**
 * Edge Function: check-unsent-trip-reminders
 *
 * Finalidade:
 * Realiza checagem diária (ou sob demanda por administrador) de viagens finalizadas
 * há X dias cujo relatório de prestação de contas ainda NÃO foi enviado (report_sent_at IS NULL).
 * Para cada viagem que atende ao critério de alerta do respectivo usuário, despacha um
 * e-mail de lembrete via Resend e registra na tabela `public.trip_reminder_logs` para
 * garantir idempotência e evitar envios duplicados/spam.
 *
 * Mecanismo de Agendamento:
 * Pode ser disparado automaticamente via pg_cron diariamente no Supabase:
 *   SELECT cron.schedule(
 *     'check-unsent-trip-reminders-daily',
 *     '0 11 * * *', -- todo dia às 08:00 BRT (11:00 UTC)
 *     $$
 *     SELECT net.http_post(
 *       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/check-unsent-trip-reminders',
 *       headers := jsonb_build_object(
 *         'Content-Type', 'application/json',
 *         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
 *       ),
 *       body := '{"dryRun": false}'::jsonb
 *     );
 *     $$
 *   );
 *
 * Proteções de Segurança (v0.0.21 / checklist):
 * 1. Autenticação Bearer obrigatória:
 *    - Token de usuário válido (Admin) OU Bearer Service Role Key (pg_cron/agendador).
 *    - Requisições sem token válido são rejeitadas com HTTP 401. Não é um relay aberto.
 * 2. Validação de payload estrita:
 *    - Opções suportadas: dryRun (boolean), specificUserId (UUID opcional para teste).
 * 3. Idempotência / Anti-Spam:
 *    - Antes de enviar, verifica se já existe registro em `trip_reminder_logs` para (trip_id, user_id).
 *    - Unique constraint no banco garante que nunca ocorra envio duplicado.
 * 4. Respostas sanitizadas e genéricas sem vazar detalhes internos ou chaves.
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
        'id, email, full_name, role, is_active, alert_unsent_trip_enabled, alert_unsent_trip_days',
      )
      .eq('is_active', true)
      .eq('alert_unsent_trip_enabled', true)

    if (specificUserId) {
      profilesQuery = profilesQuery.eq('id', specificUserId)
    }

    const { data: eligibleProfiles, error: profilesError } = await profilesQuery
    if (profilesError) {
      console.error('Erro ao consultar perfis para alertas:', profilesError)
      return jsonResponse({ error: 'Erro ao consultar perfis de usuários.' }, 500)
    }

    if (!eligibleProfiles || eligibleProfiles.length === 0) {
      return jsonResponse(
        {
          success: true,
          message: 'Nenhum usuário com alerta de viagem não enviada habilitado.',
          evaluatedCount: 0,
          remindersSent: 0,
          dryRun,
        },
        200,
      )
    }

    const profileMap = new Map<string, (typeof eligibleProfiles)[0]>()
    for (const p of eligibleProfiles) {
      profileMap.set(p.id, p)
    }

    const eligibleUserIds = eligibleProfiles.map((p) => p.id)

    // 4. Buscar viagens não enviadas desses usuários
    // Critérios de viagem pendente de envio:
    // - report_sent_at IS NULL
    // - status NÃO é 'reembolsada' (já quitada)
    // - end_date preenchida
    // - user_id pertencente à lista de usuários com alerta ativo
    const { data: candidateTrips, error: tripsError } = await adminSupabase
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

    if (!candidateTrips || candidateTrips.length === 0) {
      return jsonResponse(
        {
          success: true,
          message: 'Nenhuma viagem pendente de envio encontrada.',
          evaluatedCount: 0,
          remindersSent: 0,
          dryRun,
        },
        200,
      )
    }

    // 5. Buscar histórico de lembretes já enviados para essas viagens (anti-spam / idempotência)
    const tripIds = candidateTrips.map((t) => t.id)
    const { data: existingLogs, error: logsError } = await adminSupabase
      .from('trip_reminder_logs')
      .select('trip_id, user_id, sent_at')
      .in('trip_id', tripIds)

    if (logsError) {
      console.warn('Erro ao consultar logs de lembretes existentes:', logsError)
    }

    const alreadySentSet = new Set<string>()
    if (existingLogs) {
      for (const log of existingLogs) {
        alreadySentSet.add(`${log.trip_id}:${log.user_id}`)
      }
    }

    // 6. Avaliar viagens que atingiram a quantidade de dias após o fim
    const today = new Date()
    // Normalizar para início do dia atual UTC
    const todayMidnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    )

    interface ReminderAction {
      trip: (typeof candidateTrips)[0]
      profile: (typeof eligibleProfiles)[0]
      daysElapsed: number
      configuredDays: number
    }

    const actionsToExecute: ReminderAction[] = []

    for (const trip of candidateTrips) {
      if (!trip.user_id || !trip.end_date) continue

      const profile = profileMap.get(trip.user_id)
      if (!profile) continue

      // Verificar se já houve disparo de lembrete para esta viagem e este usuário
      const logKey = `${trip.id}:${trip.user_id}`
      if (alreadySentSet.has(logKey)) {
        continue
      }

      // Calcular diferença de dias entre end_date e hoje
      const [y, m, d] = trip.end_date.split('-').map(Number)
      if (!y || !m || !d) continue

      const tripEndDate = new Date(Date.UTC(y, m - 1, d))
      const diffMs = todayMidnight.getTime() - tripEndDate.getTime()
      const daysElapsed = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      const configuredDays = profile.alert_unsent_trip_days ?? 5

      // Se a viagem terminou há X dias ou mais, deve ser alertada
      if (daysElapsed >= configuredDays) {
        actionsToExecute.push({
          trip,
          profile,
          daysElapsed,
          configuredDays,
        })
      }
    }

    // Se estiver em modo dry-run, apenas lista as ações sem disparar
    if (dryRun) {
      return jsonResponse(
        {
          success: true,
          dryRun: true,
          evaluatedCount: candidateTrips.length,
          remindersDueCount: actionsToExecute.length,
          dueReminders: actionsToExecute.map((a) => ({
            tripId: a.trip.id,
            destination: a.trip.destination,
            endDate: a.trip.end_date,
            daysElapsed: a.daysElapsed,
            configuredDays: a.configuredDays,
            recipientEmail: a.profile.email,
            recipientName: a.profile.full_name,
          })),
        },
        200,
      )
    }

    // Se não há Resend configurado, reporta o status de forma clara
    if (!resendApiKey) {
      return jsonResponse(
        {
          success: false,
          configured: false,
          error: 'Provedor de e-mail não configurado',
          message:
            'A chave RESEND_API_KEY não foi configurada nas variáveis de ambiente do backend Supabase. Os lembretes não puderam ser disparados automaticamente.',
          remindersDueCount: actionsToExecute.length,
        },
        200,
      )
    }

    // 7. Disparar e-mails via Resend e registrar logs
    const results: Array<{
      tripId: string
      recipientEmail: string
      success: boolean
      error?: string
    }> = []

    for (const action of actionsToExecute) {
      const { trip, profile, daysElapsed, configuredDays } = action
      const recipient = profile.email

      const subject = `Lembrete: Prestação de contas de ${trip.destination} pendente de envio`
      const formattedAmount = trip.total_amount
        ? Number(trip.total_amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : 'R$ 0,00'

      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="border-bottom: 2px solid #1e40af; padding-bottom: 16px; margin-bottom: 20px;">
            <h2 style="color: #1e40af; margin: 0 0 6px 0; font-size: 20px;">Reembolso.ai Corporativo</h2>
            <p style="color: #64748b; margin: 0; font-size: 13px;">Lembrete de Prestação de Contas Pendente</p>
          </div>

          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            Olá, <strong>${escapeHtml(profile.full_name || 'Colaborador')}</strong>,
          </p>

          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            Sua viagem para <strong>${escapeHtml(trip.destination)}</strong> terminou há <strong>${daysElapsed} dias</strong> (${formatDateBR(trip.end_date)}) e o relatório de prestação de contas ainda não foi despachado para a controladoria.
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
                <td style="color: #64748b;">Total Acumulado:</td>
                <td style="color: #10b981; font-weight: bold;">${formattedAmount}</td>
              </tr>
            </table>
          </div>

          <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; margin-bottom: 20px; font-size: 13px; color: #1e40af;">
            <strong>📌 Por que estou recebendo este e-mail?</strong><br/>
            Seu perfil está configurado para receber alertas <strong>${configuredDays} dias</strong> após o fim de uma viagem caso ela ainda não tenha sido enviada.
          </div>

          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            Para concluir o processo e liberar seu reembolso, acesse o sistema Reembolso.ai, confira os comprovantes anexados e clique em <strong>Enviar Relatório</strong>.
          </p>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: center;">
            Este é um lembrete automático do Reembolso.ai Corporativo.<br/>
            Você pode alterar suas preferências de alertas na aba de Gestão de Usuários ou Configurações do seu perfil.
          </div>
        </div>
      `

      const textBody = `Olá ${profile.full_name},\n\nSua viagem para ${trip.destination} terminou há ${daysElapsed} dias (${formatDateBR(trip.end_date)}) e o relatório de prestação de contas ainda não foi enviado.\nTotal acumulado: ${formattedAmount}.\n\nAcesse o sistema Reembolso.ai para enviar sua prestação de contas.`

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
          // Registrar log de sucesso
          await adminSupabase.from('trip_reminder_logs').insert({
            trip_id: trip.id,
            user_id: trip.user_id,
            recipient_email: recipient,
            days_after_end: daysElapsed,
            status: 'sent',
            message_id: resendData?.id || null,
          })

          results.push({
            tripId: trip.id,
            recipientEmail: recipient,
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
            days_after_end: daysElapsed,
            status: 'error',
            error_message: `HTTP ${resendRes.status}`,
          })

          results.push({
            tripId: trip.id,
            recipientEmail: recipient,
            success: false,
            error: `Erro no provedor de e-mail (HTTP ${resendRes.status})`,
          })
        }
      } catch (sendErr: any) {
        console.error(`Exceção ao disparar lembrete para trip=${trip.id}:`, sendErr)
        results.push({
          tripId: trip.id,
          recipientEmail: recipient,
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
