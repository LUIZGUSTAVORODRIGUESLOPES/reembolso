import { supabase } from '@/lib/supabase/client'
import { Profile, UserRole } from '@/types/database'

export const userService = {
  /**
   * List all users with profile data and trips count
   */
  async listUsers(): Promise<Profile[]> {
    let profilesList: any[] = []

    try {
      const { data: profiles, error } = await (supabase as any)
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true })

      if (!error && profiles) {
        profilesList = profiles
      } else {
        console.warn('Erro ao listar usuários de profiles:', error)
      }
    } catch (err) {
      console.warn('Exceção ao listar profiles:', err)
    }

    // Also get trips count per user (and check orphan trips)
    let orphanTripsCount = 0
    const countMap: Record<string, number> = {}

    try {
      const { data: trips } = await (supabase as any).from('trips').select('id, user_id')
      if (trips) {
        for (const t of trips) {
          if (t.user_id) {
            countMap[t.user_id] = (countMap[t.user_id] || 0) + 1
          } else {
            orphanTripsCount++
          }
        }
      }
    } catch {
      // non-blocking
    }

    return profilesList.map((p: any) => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name || p.email,
      role: p.role as UserRole,
      is_active: p.is_active ?? true,
      created_at: p.created_at,
      updated_at: p.updated_at,
      alert_unsent_trip_enabled: p.alert_unsent_trip_enabled ?? true,
      alert_unsent_trip_days: p.alert_unsent_trip_days ?? 5,
      alert_unsent_trip_repeat_days: p.alert_unsent_trip_repeat_days ?? 7,
      // If user is admin and orphan trips exist, they manage those trips too
      trips_count: (countMap[p.id] || 0) + (p.role === 'admin' ? orphanTripsCount : 0),
    }))
  },

  /**
   * Update a user's role or active status
   */
  async updateUser(
    userId: string,
    updates: {
      role?: UserRole
      is_active?: boolean
      full_name?: string
      alert_unsent_trip_enabled?: boolean
      alert_unsent_trip_days?: number
      alert_unsent_trip_repeat_days?: number
    },
  ): Promise<Profile> {
    const payload: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await (supabase as any)
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select()
      .single()

    if (error) {
      console.error('Erro ao atualizar usuário:', error)
      throw error
    }

    return {
      id: data.id,
      email: data.email,
      full_name: data.full_name,
      role: data.role as UserRole,
      is_active: data.is_active,
      created_at: data.created_at,
      updated_at: data.updated_at,
      alert_unsent_trip_enabled: data.alert_unsent_trip_enabled ?? true,
      alert_unsent_trip_days: data.alert_unsent_trip_days ?? 5,
      alert_unsent_trip_repeat_days: data.alert_unsent_trip_repeat_days ?? 7,
    }
  },

  /**
   * Create a new user (admin feature)
   * Uses auth.signUp with explicit role in metadata so trigger sets the correct profile role.
   */
  async createUser(data: {
    email: string
    password: string
    fullName: string
    role: UserRole
  }): Promise<{ user: any; error: any }> {
    const trimmedEmail = data.email.trim().toLowerCase()
    const trimmedName = data.fullName.trim()

    const { data: authData, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password: data.password,
      options: {
        data: {
          full_name: trimmedName,
          name: trimmedName,
          role: data.role,
        },
      },
    })

    if (error) {
      return { user: null, error }
    }

    return { user: authData.user, error: null }
  },

  /**
   * Fetch a map of profiles by user IDs for enriching trips
   */
  async getProfilesMap(userIds: string[]): Promise<Record<string, Profile>> {
    const cleanIds = Array.from(new Set(userIds.filter(Boolean)))
    if (cleanIds.length === 0) return {}

    const { data, error } = await (supabase as any).from('profiles').select('*').in('id', cleanIds)

    if (error || !data) {
      return {}
    }

    const map: Record<string, Profile> = {}
    for (const p of data) {
      map[p.id] = {
        id: p.id,
        email: p.email,
        full_name: p.full_name || p.email,
        role: p.role as UserRole,
        is_active: p.is_active ?? true,
        created_at: p.created_at,
        updated_at: p.updated_at,
        alert_unsent_trip_enabled: p.alert_unsent_trip_enabled ?? true,
        alert_unsent_trip_days: p.alert_unsent_trip_days ?? 5,
        alert_unsent_trip_repeat_days: p.alert_unsent_trip_repeat_days ?? 7,
      }
    }
    return map
  },

  /**
   * Invoca a edge function check-unsent-trip-reminders para checagem manual/teste
   */
  async triggerReminderCheck(params?: { dryRun?: boolean; specificUserId?: string }) {
    const { data, error } = await supabase.functions.invoke('check-unsent-trip-reminders', {
      body: params || {},
    })
    if (error) {
      throw error
    }
    return data
  },
}
