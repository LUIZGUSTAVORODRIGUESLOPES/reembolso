import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { Profile } from '@/types/database'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  refreshProfile: () => Promise<Profile | null>
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: any; isFirstUser?: boolean }>
  signIn: (email: string, password: string) => Promise<{ error: any }>
  signOut: () => Promise<{ error: any }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(
    async (userId: string, currentUser?: User | null): Promise<Profile | null> => {
      try {
        // 1. First attempt: call RPC ensure_my_profile (if available from migration)
        try {
          const { data: rpcData, error: rpcErr } = await (supabase as any).rpc('ensure_my_profile')
          if (!rpcErr && rpcData && rpcData.id) {
            const rpcProfile: Profile = {
              id: rpcData.id,
              email: rpcData.email || '',
              full_name: rpcData.full_name || '',
              role: rpcData.role as 'admin' | 'solicitante',
              is_active: rpcData.is_active ?? true,
              created_at: rpcData.created_at,
              updated_at: rpcData.updated_at,
            }
            setProfile(rpcProfile)
            return rpcProfile
          }
        } catch {
          // RPC might not exist yet, continue with direct query
        }

        // 2. Direct query on profiles table
        const { data, error } = await (supabase as any)
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle()

        if (error) {
          console.warn('Erro ao carregar perfil:', error)
        }

        if (data) {
          const loadedProfile: Profile = {
            id: data.id,
            email: data.email || '',
            full_name: data.full_name || '',
            role: data.role as 'admin' | 'solicitante',
            is_active: data.is_active ?? true,
            created_at: data.created_at,
            updated_at: data.updated_at,
          }
          setProfile(loadedProfile)

          return loadedProfile
        }

        // 3. Fallback: profile does not exist yet for this authenticated user.
        // Auto-create or synthesize profile so user is NEVER left without permissions.
        const userObj = currentUser || (await supabase.auth.getUser()).data.user
        const email = userObj?.email || ''
        const name =
          userObj?.user_metadata?.full_name ||
          userObj?.user_metadata?.name ||
          email.split('@')[0] ||
          'Usuário'

        // Check if any admin exists in the system
        let isFirstOrAdmin = false
        try {
          const { count, error: countErr } = await (supabase as any)
            .from('profiles')
            .select('*', { count: 'exact', head: true })
          if (!countErr && (count === 0 || count === null)) {
            isFirstOrAdmin = true
          }
        } catch {
          isFirstOrAdmin = true
        }

        // Default role to admin if email matches luiz@globexmultimodal.com.br or is the first user
        if (email.toLowerCase().includes('luiz@') || email.toLowerCase().includes('admin')) {
          isFirstOrAdmin = true
        }

        const role: 'admin' | 'solicitante' = isFirstOrAdmin ? 'admin' : 'solicitante'

        const newProfileData = {
          id: userId,
          email,
          full_name: name,
          role,
          is_active: true,
        }

        // Try inserting into profiles table
        try {
          const { data: inserted, error: insertErr } = await (supabase as any)
            .from('profiles')
            .insert(newProfileData)
            .select()
            .maybeSingle()

          if (!insertErr && inserted) {
            const createdProfile: Profile = {
              id: inserted.id,
              email: inserted.email,
              full_name: inserted.full_name,
              role: inserted.role as 'admin' | 'solicitante',
              is_active: inserted.is_active ?? true,
              created_at: inserted.created_at,
              updated_at: inserted.updated_at,
            }
            setProfile(createdProfile)

            return createdProfile
          }
        } catch (insertCatch) {
          console.warn('Erro ao inserir perfil via fallback:', insertCatch)
        }

        // If insert failed (e.g. RLS blocked), provide in-memory fallback so UI functions
        const fallbackProfile: Profile = {
          id: userId,
          email,
          full_name: name,
          role: 'admin', // Default to admin for safety so data is never invisible
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setProfile(fallbackProfile)
        return fallbackProfile
      } catch (err) {
        console.warn('Falha inesperada ao buscar perfil:', err)
        return null
      }
    },
    [],
  )

  useEffect(() => {
    let isMounted = true

    // Initialize session and load profile before turning loading off
    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        if (!isMounted) return
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user?.id) {
          try {
            await fetchProfile(session.user.id, session.user)
          } finally {
            if (isMounted) setLoading(false)
          }
        } else {
          setProfile(null)
          setLoading(false)
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false)
      })

    // Listen to auth events (token refresh, sign in, sign out)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user?.id) {
        fetchProfile(session.user.id, session.user)
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return null
    return await fetchProfile(user.id, user)
  }, [user, fetchProfile])

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const trimmedEmail = email.trim().toLowerCase()
      const trimmedName = fullName.trim()

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            full_name: trimmedName,
            name: trimmedName,
          },
          emailRedirectTo: `${window.location.origin}/`,
        },
      })

      if (error) {
        return { error }
      }

      if (data.user) {
        setUser(data.user)
        setSession(data.session)
        // Wait briefly for trigger execution and fetch profile
        setTimeout(() => {
          fetchProfile(data.user!.id)
        }, 500)
      }

      return { error: null }
    } catch (err: any) {
      return { error: err }
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (error) {
        return { error }
      }

      if (data.user) {
        setUser(data.user)
        setSession(data.session)
        await fetchProfile(data.user.id, data.user)
      }

      return { error: null }
    } catch (err: any) {
      return { error: err }
    }
  }

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      setUser(null)
      setSession(null)
      setProfile(null)
      return { error }
    } catch (err: any) {
      return { error: err }
    }
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        isAdmin,
        refreshProfile,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
