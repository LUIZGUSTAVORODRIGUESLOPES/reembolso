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

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        console.warn('Erro ao carregar perfil:', error)
        return null
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
      return null
    } catch (err) {
      console.warn('Falha inesperada ao buscar perfil:', err)
      return null
    }
  }, [])

  useEffect(() => {
    // onAuthStateChange MUST be synchronous
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user?.id) {
        // Trigger profile fetch without awaiting
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user?.id) {
        fetchProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return null
    return await fetchProfile(user.id)
  }, [user?.id, fetchProfile])

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
        await fetchProfile(data.user.id)
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
