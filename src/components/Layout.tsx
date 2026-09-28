import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  PlaneTakeoff,
  UploadCloud,
  FileCheck2,
  FileSpreadsheet,
  Bell,
  Search,
  Menu,
  X,
  ShieldCheck,
  ChevronRight,
  Database,
  RefreshCw,
  LogOut,
  ExternalLink,
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/trips', label: 'Viagens', icon: PlaneTakeoff },
  { path: '/upload', label: 'Upload de Comprovantes', icon: UploadCloud },
  { path: '/triage', label: 'Triagem & OCR', icon: FileCheck2 },
  { path: '/reports', label: 'Relatórios & Prestação', icon: FileSpreadsheet },
]

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeAlertsCount, setActiveAlertsCount] = useState<number>(0)
  const [searchQuery, setSearchQuery] = useState('')

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

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const handleResetData = () => {
    storageService.resetToSeed()
    toast({
      title: 'Dados restaurados',
      description: 'O banco de demonstração foi restaurado com as 3 viagens padrão.',
    })
    refreshAlertCount()
    window.location.reload()
  }

  // Generate dynamic breadcrumb
  const getBreadcrumb = () => {
    const path = location.pathname
    if (path === '/') return ['Dashboard']
    if (path === '/trips') return ['Dashboard', 'Viagens']
    if (path.startsWith('/trips/')) return ['Dashboard', 'Viagens', 'Detalhes & Auditoria']
    if (path === '/upload') return ['Dashboard', 'Upload em Lote']
    if (path === '/triage') return ['Dashboard', 'Triagem & OCR']
    if (path === '/reports') return ['Dashboard', 'Relatórios']
    return ['Dashboard']
  }

  const getPageTitle = () => {
    const path = location.pathname
    if (path === '/') return 'Dashboard Corporativo'
    if (path === '/trips') return 'Gestão de Viagens'
    if (path.startsWith('/trips/')) return 'Auditoria & Despesas da Viagem'
    if (path === '/upload') return 'Upload em Lote com OCR'
    if (path === '/triage') return 'Triagem & Conferência'
    if (path === '/reports') return 'Prestação de Contas & Relatórios'
    return 'Reembolso.ai'
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col text-slate-900">
      {/* Top Banner Notice: Demo mode explainer */}
      <div className="bg-slate-900 text-slate-300 text-xs px-4 py-1.5 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2 overflow-hidden">
          <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">
            <strong className="text-white">Modo Demonstração Ativo:</strong> Os dados estão
            persistidos em localStorage local (schema Supabase 1:1) até a conexão ao banco em nuvem.
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <button
            onClick={handleResetData}
            title="Restaurar as 3 viagens de demonstração"
            className="text-slate-400 hover:text-white inline-flex items-center gap-1 transition-colors underline cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span className="hidden sm:inline">Restaurar Seed</span>
          </button>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-400 font-medium flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Online
          </span>
        </div>
      </div>

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

            {NAV_ITEMS.map((item) => {
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
                Empacotar Relatório
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </nav>

          {/* User profile card bottom */}
          <div className="p-3 border-t border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/50 transition-colors">
              <div className="w-9 h-9 rounded-full bg-blue-700/50 text-blue-200 border border-blue-500/40 font-bold text-xs flex items-center justify-center shrink-0">
                CF
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">Carlos Ferreira</p>
                <p className="text-[11px] text-slate-400 truncate">auditoria@empresa.com.br</p>
              </div>
              <button
                onClick={() =>
                  toast({
                    title: 'Sessão Corporativa',
                    description: 'Ambiente seguro corporativo conectado.',
                  })
                }
                title="Status da Conta"
                className="text-slate-400 hover:text-white p-1 rounded"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
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
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-xs bg-slate-50 border-slate-200 focus:bg-white"
                />
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
              <span>Motor de OCR & Auditoria v2.4</span>
              <span>•</span>
              <span>Regras de Compliance Ativas</span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
