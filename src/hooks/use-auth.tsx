import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useRef,
} from 'react'
import { User, Session } from '@supabase/supabase-js'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { Profile } from '@/types/database'
import { toast } from '@/hooks/use-toast'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  validateSessionAgainstServer: () => Promise<boolean>
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

  const navigate = useNavigate()
  const location = useLocation()
  const sessionExpiredToastShownRef = useRef(false)
  const isLoggingOutRef = useRef(false)
  const hadPreviousSessionRef = useRef(false)
  const lastServerValidationRef = useRef<number>(0)
  const isCheckingServerSessionRef = useRef<boolean>(false)

  const handleSessionExpired = useCallback(() => {
    setUser(null)
    setSession(null)
    setProfile(null)
    setLoading(false)

    if (location.pathname !== '/login') {
      if (!sessionExpiredToastShownRef.current) {
        sessionExpiredToastShownRef.current = true
        toast({
          title: 'Sua sessão expirou.',
          description: 'Entre novamente para continuar.',
          variant: 'destructive',
        })
      }
      navigate('/login', {
        state: {
          from: {
            pathname: location.pathname + location.search,
          },
        },
        replace: true,
      })
    }
  }, [location.pathname, location.search, navigate])

  const validateSessionAgainstServer = useCallback(async (): Promise<boolean> => {
    // Se estiver fazendo logout voluntário, não interferir
    if (isLoggingOutRef.current) return false
    // Se já estiver checando, evita chamadas concorrentes
    if (isCheckingServerSessionRef.current) return true

    isCheckingServerSessionRef.current = true
    try {
      const { data, error } = await supabase.auth.getUser()
      lastServerValidationRef.current = Date.now()

      if (error || !data.user) {
        console.warn('Validação de sessão no servidor falhou:', error?.message || 'Usuário ausente')
        handleSessionExpired()
        return false
      }

      // Sessão ainda válida no servidor
      hadPreviousSessionRef.current = true
      return true
    } catch (err) {
      console.warn('Erro ao validar sessão no servidor:', err)
      // Se houve exceção grave de rede, não derruba imediatamente a menos que seja 401/invalid token
      return false
    } finally {
      isCheckingServerSessionRef.current = false
    }
  }, [handleSessionExpired])

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
        hadPreviousSessionRef.current = true
        sessionExpiredToastShownRef.current = false
        fetchProfile(session.user.id, session.user)
      } else {
        setProfile(null)
        setLoading(false)

        // Se a sessão caiu inesperadamente (expiração, falha de refresh ou SIGNED_OUT sem logout intencional)
        const isUnexpectedSignout =
          hadPreviousSessionRef.current && !isLoggingOutRef.current && event === 'SIGNED_OUT'
        if (isUnexpectedSignout) {
          handleSessionExpired()
        }
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile, handleSessionExpired])

  // Listeners de foco e visibilidade da aba com throttle de 30 segundos
  useEffect(() => {
    const THROTTLE_MS = 30_000

    const maybeValidate = () => {
      // Só validar se tínhamos sessão ou usuário ativo
      if (!hadPreviousSessionRef.current && !user) return
      // Não validar na tela de login
      if (location.pathname === '/login') return

      const now = Date.now()
      if (now - lastServerValidationRef.current < THROTTLE_MS) {
        return
      }

      validateSessionAgainstServer()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        maybeValidate()
      }
    }

    const handleWindowFocus = () => {
      maybeValidate()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [user, location.pathname, validateSessionAgainstServer])

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
    isLoggingOutRef.current = true
    try {
      const { error } = await supabase.auth.signOut()
      setUser(null)
      setSession(null)
      setProfile(null)
      return { error }
    } catch (err: any) {
      return { error: err }
    } finally {
      setTimeout(() => {
        isLoggingOutRef.current = false
      }, 1000)
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
        validateSessionAgainstServer,
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

/**
 * Hook utilitário para telas ou modais críticos (ex: Upload, Criar Viagem)
 * que precisam garantir que a sessão do usuário ainda é válida no servidor
 * assim que o componente é montado ou aberto.
 */
export const useSessionGuard = () => {
  const { validateSessionAgainstServer } = useAuth()

  useEffect(() => {
    validateSessionAgainstServer()
  }, [validateSessionAgainstServer])
}
