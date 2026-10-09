import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  PlaneTakeoff,
  PackageOpen,
  UploadCloud,
  FileCheck2,
  FileSpreadsheet,
  Bell,
  Search,
  Menu,
  X,
  ShieldCheck,
  Shield,
  ChevronRight,
  LogOut,
  Users,
  BellRing,
  Settings,
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { userService } from '@/services/userService'
import { reminderTriggerService } from '@/services/reminderTriggerService'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, profile, isAdmin, signOut, refreshProfile } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeAlertsCount, setActiveAlertsCount] = useState<number>(0)
  const [searchQuery, setSearchQuery] = useState('')

  // Modal para qualquer colaborador configurar seus próprios alertas de viagem
  const [isSelfAlertModalOpen, setIsSelfAlertModalOpen] = useState(false)
  const [selfAlertEnabled, setSelfAlertEnabled] = useState(true)
  const [selfAlertDays, setSelfAlertDays] = useState(5)
  const [savingSelfAlert, setSavingSelfAlert] = useState(false)

  const handleOpenSelfAlertModal = () => {
    setSelfAlertEnabled(profile?.alert_unsent_trip_enabled ?? true)
    setSelfAlertDays(profile?.alert_unsent_trip_days ?? 5)
    setIsSelfAlertModalOpen(true)
  }

  const handleSaveSelfAlert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.id) return

    const sanitizedDays = Math.max(1, Math.min(90, Number(selfAlertDays) || 5))
    try {
      setSavingSelfAlert(true)
      await userService.updateUser(profile.id, {
        alert_unsent_trip_enabled: selfAlertEnabled,
        alert_unsent_trip_days: sanitizedDays,
      })

      if (refreshProfile) {
        await refreshProfile()
      }

      toast({
        title: 'Preferências salvas!',
        description: selfAlertEnabled
          ? `Você receberá um lembrete ${sanitizedDays} dias após o fim de viagens não enviadas.`
          : 'Lembretes automáticos desativados.',
      })
      setIsSelfAlertModalOpen(false)
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar',
        description: err.message || 'Falha ao salvar preferências de alertas.',
        variant: 'destructive',
      })
    } finally {
      setSavingSelfAlert(false)
    }
  }

  // Sync searchQuery with URL query parameter 'q' when on / or /trips
  const searchParams = new URLSearchParams(location.search)
  const urlQuery = searchParams.get('q') || ''

  useEffect(() => {
    if (urlQuery !== searchQuery) {
      setSearchQuery(urlQuery)
    }
  }, [urlQuery])

  const handleGlobalSearchChange = (newVal: string) => {
    setSearchQuery(newVal)
    const currentParams = new URLSearchParams(location.search)
    if (newVal.trim()) {
      currentParams.set('q', newVal)
    } else {
      currentParams.delete('q')
    }

    const newSearch = currentParams.toString() ? `?${currentParams.toString()}` : ''

    // If already on / or /trips, replace URL state smoothly
    if (location.pathname === '/' || location.pathname === '/trips') {
      navigate(`${location.pathname}${newSearch}`, { replace: true })
    } else if (newVal.trim()) {
      // If user starts searching from any other screen, redirect to /trips with the query
      navigate(`/trips${newSearch}`)
    }
  }

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/trips', label: 'Viagens', icon: PlaneTakeoff },
    { path: '/avulsas', label: 'Solicitações Avulsas', icon: PackageOpen },
    { path: '/upload', label: 'Upload de Comprovantes', icon: UploadCloud },
    { path: '/triage', label: 'Triagem & OCR', icon: FileCheck2 },
    { path: '/reports', label: 'Relatórios & Prestação', icon: FileSpreadsheet },
    ...(isAdmin ? [{ path: '/usuarios', label: 'Gestão de Usuários', icon: Users }] : []),
  ]

  const refreshAlertCount = async () => {
    try {
      const metrics = await storageService.getDashboardMetrics()
      setActiveAlertsCount(metrics.activeAlertsCount)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshAlertCount()
    const interval = setInterval(refreshAlertCount, 4000)
    return () => clearInterval(interval)
  }, [])

  // Gatilho de checagem diária automática em segundo plano
  // Se o usuário logado for administrador, aciona a edge function check-unsent-trip-reminders
  // Executa no máximo uma vez por dia por dispositivo (cooldown ~20h via localStorage)
  // Totalmente silencioso em segundo plano (apenas console.warn se houver falha de rede)
  useEffect(() => {
    if (isAdmin) {
      reminderTriggerService.runDailyBackgroundCheckIfAdmin(true)
    }
  }, [isAdmin])

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // Generate dynamic breadcrumb
  const getBreadcrumb = () => {
    const path = location.pathname
    if (path === '/') return ['Dashboard']
    if (path === '/trips') return ['Dashboard', 'Viagens']
    if (path.startsWith('/trips/')) return ['Dashboard', 'Viagens', 'Detalhes & Auditoria']
    if (path === '/avulsas') return ['Dashboard', 'Solicitações Avulsas']
    if (path === '/upload') return ['Dashboard', 'Upload em Lote']
    if (path === '/triage') return ['Dashboard', 'Triagem & OCR']
    if (path === '/reports') return ['Dashboard', 'Relatórios']
    if (path === '/usuarios') return ['Dashboard', 'Gestão de Usuários']
    return ['Dashboard']
  }

  const getPageTitle = () => {
    const path = location.pathname
    if (path === '/') return 'Dashboard Corporativo'
    if (path === '/trips') return 'Gestão de Viagens'
    if (path.startsWith('/trips/')) return 'Auditoria & Despesas da Viagem'
    if (path === '/avulsas') return 'Solicitações Avulsas de Reembolso'
    if (path === '/upload') return 'Upload em Lote com OCR'
    if (path === '/triage') return 'Triagem & Conferência'
    if (path === '/reports') return 'Prestação de Contas & Relatórios'
    if (path === '/usuarios') return 'Controle de Usuários e Perfis'
    return 'Reembolso.ai'
  }

  const handleSignOut = async () => {
    await signOut()
    toast({
      title: 'Sessão encerrada',
      description: 'Você saiu da sua conta corporativa com segurança.',
    })
    navigate('/login')
  }

  const userName =
    profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuário'
  const userEmail = profile?.email || user?.email || 'usuario@empresa.com.br'
  const initials =
    userName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n: string) => n[0].toUpperCase())
      .join('') || 'U'

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col text-slate-900">
      <div className="flex flex-1 relative">
        {/* Mobile Drawer Overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 md:hidden transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed top-0 bottom-0 left-0 z-50 w-64 bg-[#0f172a] text-slate-100 flex flex-col border-r border-slate-800 transition-transform duration-300 ease-in-out
            md:translate-x-0 md:static md:z-0
            ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          {/* Logo Brand */}
          <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800">
            <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate('/')}>
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-base text-white tracking-tight flex items-center gap-1">
                  Reembolso<span className="text-blue-400">.ai</span>
                </span>
                <span className="text-[10px] text-slate-400 block -mt-1 font-medium tracking-wider uppercase">
                  Auditoria Corporativa
                </span>
              </div>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="md:hidden text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Nav List */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Principal
            </div>

            {navItems.map((item) => {
              const Icon = item.icon
              const isActive =
                item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.path)

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`
                    flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors relative
                    ${
                      isActive
                        ? 'bg-blue-600/15 text-white font-semibold'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }
                  `}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-blue-500 rounded-r-md" />
                  )}
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400'}`}
                  />
                  <span>{item.label}</span>

                  {item.path === '/usuarios' && (
                    <span className="ml-auto text-[10px] bg-blue-500/20 text-blue-300 font-semibold px-1.5 py-0.5 rounded border border-blue-500/30">
                      Admin
                    </span>
                  )}

                  {item.path === '/triage' && (
                    <span className="ml-auto text-[10px] bg-blue-500/20 text-blue-300 font-semibold px-1.5 py-0.5 rounded border border-blue-500/30">
                      OCR
                    </span>
                  )}

                  {item.path === '/trips' && activeAlertsCount > 0 && (
                    <span className="ml-auto text-[10px] bg-amber-500/20 text-amber-300 font-semibold px-1.5 py-0.5 rounded border border-amber-500/30">
                      {activeAlertsCount}
                    </span>
                  )}
                </NavLink>
              )
            })}

            <div className="pt-4 px-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Acesso Rápido
            </div>

            <button
              onClick={() => navigate('/upload')}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/40 rounded-md transition-colors"
            >
              <span className="flex items-center gap-2">
                <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
                Novo Lote de Recibos
              </span>
              <span className="text-[10px] bg-blue-900/60 text-blue-300 px-1.5 py-0.2 rounded">
                IA
              </span>
            </button>

            <button
              onClick={() => navigate('/reports')}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/40 rounded-md transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                Enviar Relatório
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </nav>
          {/* User profile card bottom */}
          <div className="p-3 border-t border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/50 transition-colors">
              <div
                onClick={handleOpenSelfAlertModal}
                title="Configurar meus alertas de viagens não enviadas"
                className="w-9 h-9 rounded-full bg-blue-700/50 text-blue-200 border border-blue-500/40 font-bold text-xs flex items-center justify-center shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-400 transition"
              >
                {initials}
              </div>
              <div
                className="min-w-0 flex-1 cursor-pointer"
                onClick={handleOpenSelfAlertModal}
                title="Clique para configurar seus alertas"
              >
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-white truncate hover:underline">
                    {userName}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1.5 py-0 border-0 h-4 font-semibold ${
                      isAdmin
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {isAdmin ? 'Administrador' : 'Solicitante'}
                  </Badge>
                </div>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">{userEmail}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleOpenSelfAlertModal}
                  title="Configurar meus alertas de viagens"
                  className="text-slate-400 hover:text-amber-300 p-1.5 rounded transition-colors"
                >
                  <BellRing className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleSignOut}
                  title="Encerrar Sessão (Logout)"
                  className="text-slate-400 hover:text-red-400 p-1.5 rounded transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>{' '}
        </aside>

        {/* Main Workspace Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header Bar */}
          <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden text-slate-600 hover:text-slate-900 p-1.5 rounded-md hover:bg-slate-100"
                aria-label="Abrir menu lateral"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                  {getPageTitle()}
                </h1>
                {/* Breadcrumbs */}
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                  {getBreadcrumb().map((crumb, idx, arr) => (
                    <React.Fragment key={crumb}>
                      <span className={idx === arr.length - 1 ? 'font-medium text-slate-700' : ''}>
                        {crumb}
                      </span>
                      {idx < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-400" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-3">
              {/* Search Bar */}
              <div className="relative hidden md:block w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Pesquisar viagem ou recibo..."
                  value={searchQuery}
                  onChange={(e) => handleGlobalSearchChange(e.target.value)}
                  className="pl-9 h-9 text-xs bg-slate-50 border-slate-200 focus:bg-white"
                />
                {searchQuery && (
                  <button
                    onClick={() => handleGlobalSearchChange('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    title="Limpar pesquisa"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Notification Bell */}
              <button
                onClick={() => {
                  toast({
                    title: 'Alertas de Auditoria',
                    description:
                      activeAlertsCount > 0
                        ? `Existem ${activeAlertsCount} pendências requerendo atenção nas viagens ativas.`
                        : 'Nenhuma pendência crítica pendente de justificativa.',
                  })
                }}
                className="relative p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                title="Alertas de auditoria"
              >
                <Bell className="w-5 h-5" />
                {activeAlertsCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500 text-[10px] font-bold text-white items-center justify-center">
                      {activeAlertsCount}
                    </span>
                  </span>
                )}
              </button>

              <Button
                onClick={() => navigate('/upload')}
                size="sm"
                className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white shadow-sm font-medium text-xs sm:text-sm gap-1.5"
              >
                <UploadCloud className="w-4 h-4" />
                <span className="hidden sm:inline">Upload Comprovantes</span>
              </Button>
            </div>
          </header>

          {/* Dynamic Content */}
          <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
            <Outlet />
          </main>

          {/* Footer */}
          <footer className="bg-white border-t border-slate-200 px-6 py-4 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Reembolso.ai</span>
              <span>— Sistema Inteligente de Prestação de Contas Corporativas</span>
            </div>
            <div className="flex items-center gap-4 text-slate-400 text-[11px]">
              <span>Motor de OCR & Auditoria v2.5</span>
              <span>•</span>
              <span>Regras de Compliance Ativas</span>
            </div>
          </footer>
        </div>
      </div>

      {/* Modal de Configuração de Alertas do Próprio Usuário */}
      <Dialog open={isSelfAlertModalOpen} onOpenChange={setIsSelfAlertModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSaveSelfAlert}>
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <BellRing className="w-5 h-5 text-amber-600" />
                Meus Alertas de Viagens Não Enviadas
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Defina quando você deseja receber lembretes por e-mail para viagens que terminaram e
                ainda não tiveram suas prestações de contas despachadas.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 bg-white">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="self-alert-toggle"
                    className="text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    Receber lembrete por e-mail
                  </Label>
                  <p className="text-[11px] text-slate-500">
                    Avisar quando eu esquecer de despachar o relatório da viagem
                  </p>
                </div>
                <Switch
                  id="self-alert-toggle"
                  checked={selfAlertEnabled}
                  onCheckedChange={setSelfAlertEnabled}
                />
              </div>

              {selfAlertEnabled && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="self-alert-days"
                      className="text-xs font-semibold text-slate-800"
                    >
                      Disparar e-mail após quantos dias do término?
                    </Label>
                    <span className="font-bold text-sm text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                      {selfAlertDays} {selfAlertDays === 1 ? 'dia' : 'dias'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <Input
                      id="self-alert-days"
                      type="number"
                      min={1}
                      max={90}
                      value={selfAlertDays}
                      onChange={(e) =>
                        setSelfAlertDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))
                      }
                      className="w-24 h-9 text-xs bg-white text-center font-semibold"
                    />
                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={selfAlertDays}
                      onChange={(e) => setSelfAlertDays(parseInt(e.target.value) || 1)}
                      className="flex-1 accent-amber-600 cursor-pointer"
                    />
                  </div>

                  <p className="text-[11px] text-slate-600 pt-1">
                    Você receberá um e-mail <strong>{selfAlertDays} dias</strong> após o fim da
                    viagem se ela continuar sem envio. Um único lembrete é enviado para cada viagem
                    para evitar mensagens repetitivas.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsSelfAlertModalOpen(false)}
                className="text-xs h-9"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={savingSelfAlert}
                className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs h-9"
              >
                Salvar Preferência
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
