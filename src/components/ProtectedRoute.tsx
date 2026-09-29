import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { ShieldAlert, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ProtectedRouteProps {
  children: ReactNode
  requireAdmin?: boolean
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, profile, loading, isAdmin } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0f172a] text-white">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
        <p className="text-sm text-slate-300">Carregando sessão segura...</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Check if user is inactive
  if (profile && profile.is_active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Conta Desativada</h2>
          <p className="text-xs text-slate-600 mb-6">
            Seu acesso foi desativado por um administrador da plataforma. Entre em contato com a
            equipe de Controladoria ou com o suporte corporativo.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = '/login'
            }}
          >
            Voltar ao Login
          </Button>
        </div>
      </div>
    )
  }

  if (requireAdmin && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Acesso Negado</h2>
          <p className="text-sm text-slate-600 mb-6">
            Esta área é restrita aos Administradores do sistema Reembolso.ai. Seu perfil atual é{' '}
            <strong className="text-slate-900 font-semibold">Solicitante</strong>.
          </p>
          <Button
            className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white"
            onClick={() => {
              window.location.href = '/'
            }}
          >
            Ir para o Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
