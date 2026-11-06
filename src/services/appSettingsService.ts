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
      } catch (err) {
        console.warn('Erro ao carregar taxa Azul de app_settings (usando fallback 0.017):', err)
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

    const { data, error } = await (supabase as any)
      .from('app_settings')
      .upsert(payload, { onConflict: 'id' })
      .select('azul_point_rate')
      .single()

    if (error) {
      console.error('Falha ao atualizar taxa em app_settings:', error)
      throw error
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
