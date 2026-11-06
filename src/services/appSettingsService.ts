import { supabase } from '@/lib/supabase/client'
import { AppSettings } from '@/types/database'

/**
 * Taxa padrão canônica do Reembolso.ai para conversão de pontos/milhas Azul em R$.
 * Utilizada como fallback síncrono e padrão de resiliência caso o banco ou a rede falhem.
 */
export const DEFAULT_AZUL_POINT_RATE = 0.017

// Cache leve em memória
let cachedPointRate: number = DEFAULT_AZUL_POINT_RATE
let isLoaded = false
let fetchPromise: Promise<number> | null = null

export const appSettingsService = {
  /**
   * Retorna a taxa síncrona atual em memória (sempre disponível com fallback imediato para 0.017).
   */
  getPointRateSync(): number {
    return cachedPointRate
  },

  /**
   * Busca a taxa de conversão no Supabase com fallback seguro para 0.017.
   * Evita chamadas duplicadas simultâneas via fetchPromise compartilhado.
   */
  async getAzulPointRate(): Promise<number> {
    if (isLoaded && cachedPointRate > 0) {
      return cachedPointRate
    }

    if (fetchPromise) {
      return fetchPromise
    }

    fetchPromise = (async () => {
      try {
        // 1. Tentar ler de app_settings
        const { data, error } = await (supabase as any)
          .from('app_settings')
          .select('azul_point_rate')
          .eq('id', 'default')
          .maybeSingle()

        if (!error && data && data.azul_point_rate !== null && data.azul_point_rate !== undefined) {
          const parsed = Number(data.azul_point_rate)
          if (!isNaN(parsed) && parsed > 0) {
            cachedPointRate = parsed
            isLoaded = true
            return cachedPointRate
          }
        }

        // Se a linha 'default' não existir ainda, tenta ler a primeira linha existente
        const { data: listData, error: listError } = await (supabase as any)
          .from('app_settings')
          .select('azul_point_rate')
          .limit(1)

        if (!listError && listData && listData.length > 0 && listData[0]?.azul_point_rate) {
          const parsed = Number(listData[0].azul_point_rate)
          if (!isNaN(parsed) && parsed > 0) {
            cachedPointRate = parsed
            isLoaded = true
            return cachedPointRate
          }
        }

        // 2. Fallback de leitura: buscar taxa customizada registrada em public.profiles
        const { data: profileData, error: profileError } = await (supabase as any)
          .from('profiles')
          .select('azul_point_rate')
          .not('azul_point_rate', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1)

        if (
          !profileError &&
          profileData &&
          profileData.length > 0 &&
          profileData[0]?.azul_point_rate
        ) {
          const parsed = Number(profileData[0].azul_point_rate)
          if (!isNaN(parsed) && parsed > 0) {
            cachedPointRate = parsed
            isLoaded = true
            return cachedPointRate
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar taxa Azul (usando fallback padrão 0.017):', err)
      } finally {
        fetchPromise = null
      }

      // Fallback padrão se nada veio do banco
      return cachedPointRate
    })()

    return fetchPromise
  },

  /**
   * Busca as configurações completas do sistema (ou valores padrão se não existir).
   */
  async getSettings(): Promise<AppSettings> {
    try {
      const { data, error } = await (supabase as any)
        .from('app_settings')
        .select('*')
        .eq('id', 'default')
        .maybeSingle()

      if (!error && data) {
        const rate = Number(data.azul_point_rate) || DEFAULT_AZUL_POINT_RATE
        cachedPointRate = rate
        isLoaded = true
        return {
          id: data.id || 'default',
          azul_point_rate: rate,
          description: data.description || 'Taxa padrão de conversão Azul',
          updated_at: data.updated_at || new Date().toISOString(),
          updated_by: data.updated_by || null,
        }
      }

      // Se app_settings falhou ou retornou vazio, tenta consultar profiles (fallback)
      const { data: profileData } = await (supabase as any)
        .from('profiles')
        .select('azul_point_rate, updated_at, id')
        .not('azul_point_rate', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (profileData && profileData.length > 0 && profileData[0]?.azul_point_rate) {
        const rate = Number(profileData[0].azul_point_rate)
        if (!isNaN(rate) && rate > 0) {
          cachedPointRate = rate
          isLoaded = true
          return {
            id: 'default',
            azul_point_rate: rate,
            description: 'Taxa configurada em perfis (fallback)',
            updated_at: profileData[0].updated_at || new Date().toISOString(),
            updated_by: profileData[0].id || null,
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao ler app_settings completo:', err)
    }

    return {
      id: 'default',
      azul_point_rate: cachedPointRate,
      description: 'Taxa padrão de conversão Azul (fallback)',
      updated_at: new Date().toISOString(),
      updated_by: null,
    }
  },

  /**
   * Atualiza a taxa de conversão no banco e invalida/atualiza o cache local imediatamente.
   */
  async updateAzulPointRate(newRate: number, userId?: string): Promise<number> {
    if (isNaN(newRate) || newRate <= 0) {
      throw new Error('A taxa de conversão deve ser um número maior que zero.')
    }

    // Arredondar para até 4 casas decimais para consistência monetária
    const roundedRate = Number(newRate.toFixed(4))

    const payload: Record<string, any> = {
      id: 'default',
      azul_point_rate: roundedRate,
      updated_at: new Date().toISOString(),
    }
    if (userId) {
      payload.updated_by = userId
    }

    let data: any = null
    let error: any = null

    // 1. Tentar upsert primário
    const upsertRes = await (supabase as any)
      .from('app_settings')
      .upsert(payload, { onConflict: 'id' })
      .select('azul_point_rate')
      .single()

    data = upsertRes.data
    error = upsertRes.error

    // 2. Se falhar no upsert por alguma restrição de chave ou política, tentar UPDATE direto da linha 'default'
    if (error) {
      console.warn('Tentativa inicial de upsert falhou, tentando update:', error.message)
      const updateRes = await (supabase as any)
        .from('app_settings')
        .update({
          azul_point_rate: roundedRate,
          updated_at: payload.updated_at,
          ...(userId ? { updated_by: userId } : {}),
        })
        .eq('id', 'default')
        .select('azul_point_rate')
        .single()

      if (!updateRes.error && updateRes.data) {
        data = updateRes.data
        error = null
      } else {
        // Se a linha 'default' não existir, tentar INSERT
        const insertRes = await (supabase as any)
          .from('app_settings')
          .insert(payload)
          .select('azul_point_rate')
          .single()

        if (!insertRes.error && insertRes.data) {
          data = insertRes.data
          error = null
        }
      }
    }

    // Se o salvamento em app_settings falhou, acionar PLANO B de fallback em public.profiles
    if (error) {
      console.warn('Falha ao gravar em app_settings, tentando plano B (profiles):', error)

      let profileFallbackSuccess = false
      try {
        // Obter id do usuário se não passado
        let targetUserId = userId
        if (!targetUserId) {
          const { data: authData } = await supabase.auth.getUser()
          targetUserId = authData?.user?.id
        }

        if (targetUserId) {
          const { error: profileUpdateError } = await (supabase as any)
            .from('profiles')
            .update({
              azul_point_rate: roundedRate,
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetUserId)

          if (!profileUpdateError) {
            profileFallbackSuccess = true
          } else {
            console.warn(
              'Falha no fallback de profiles para id específico:',
              profileUpdateError.message,
            )
          }
        }

        // Se ainda não salvou (ex: targetUserId ausente ou restrição RLS), tenta atualizar qualquer perfil admin
        if (!profileFallbackSuccess) {
          const { error: anyProfileError } = await (supabase as any)
            .from('profiles')
            .update({
              azul_point_rate: roundedRate,
              updated_at: new Date().toISOString(),
            })
            .not('id', 'is', null)

          if (!anyProfileError) {
            profileFallbackSuccess = true
          }
        }
      } catch (profileErr) {
        console.warn('Erro ao executar fallback em profiles:', profileErr)
      }

      if (profileFallbackSuccess) {
        cachedPointRate = roundedRate
        isLoaded = true
        return roundedRate
      }

      // Se ambos falharam, formular erro técnico explícito em pt-BR
      console.error('Falha ao atualizar taxa em app_settings e no fallback:', error)
      const errCode = error.code ? ` (código ${error.code})` : ''
      const errDetails = error.details ? ` - Detalhes: ${error.details}` : ''
      const errHint = error.hint ? ` - Dica: ${error.hint}` : ''
      const rawMsg = error.message || ''

      let explicacao = 'Erro ao persistir taxa no banco de dados.'
      if (
        rawMsg.includes('permission denied') ||
        rawMsg.includes('policy') ||
        error.code === '42501'
      ) {
        explicacao = 'Permissão negada pelas políticas do banco de dados (RLS/permissões).'
      } else if (rawMsg.includes('does not exist') || error.code === '42P01') {
        explicacao = 'Tabela app_settings não encontrada no schema público do banco.'
      } else if (
        rawMsg.includes('schema cache') ||
        error.code === 'PGRST204' ||
        error.code === 'PGRST200'
      ) {
        explicacao =
          'A API do banco de dados ainda não indexou a tabela de configurações no schema cache.'
      }

      throw new Error(`${explicacao} ${rawMsg}${errCode}${errDetails}${errHint}`)
    }

    const updated = Number(data?.azul_point_rate) || roundedRate
    cachedPointRate = updated
    isLoaded = true
    return updated
  },

  /**
   * Invalida o cache para forçar recarregamento na próxima leitura.
   */
  invalidateCache(): void {
    isLoaded = false
    fetchPromise = null
  },
}
