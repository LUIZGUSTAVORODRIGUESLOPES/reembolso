import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  TrendingUp,
  Briefcase,
  AlertTriangle,
  CheckCircle2,
  Plus,
  UploadCloud,
  Eye,
  Plane,
  Car,
  CarFront,
  MoreHorizontal,
  MapPin,
  Calendar,
  Filter,
  ArrowRight,
  ShieldAlert,
  Trash2,
  Lock,
  Search,
  X,
  Receipt,
  FileCheck2,
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { Trip, TripStatus } from '@/types/database'
import {
  formatCurrencyBRL,
  formatDateRangeBR,
  TRIP_STATUS_CONFIG,
  TRANSPORT_LABELS,
  normalizeSearchText,
  getEffectiveTripStatus,
} from '@/lib/formatters'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CreateTripModal } from '@/components/CreateTripModal'
import { ReceiptSearchCard } from '@/components/ReceiptSearchCard'
import { TripPhaseToggle } from '@/components/TripPhaseToggle'
import { TripPhase, getTripPhase, countTripsByPhase } from '@/lib/tripPhase'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { showTripDeletedUndoToast } from '@/services/undoService'
import { useAuth } from '@/hooks/use-auth'

export default function Index() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState({
    totalToRefund: 0,
    openTripsCount: 0,
    activeAlertsCount: 0,
    totalReimbursedThisMonth: 0,
  })

  // Instant Trip Search query (synced with URL ?q=)
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')
  const [showReceiptModule, setShowReceiptModule] = useState(false)

  // Sync internal state if URL parameter changes
  useEffect(() => {
    const q = searchParams.get('q') || ''
    if (q !== searchQuery) {
      setSearchQuery(q)
    }
  }, [searchParams])

  const handleSearchChange = (newVal: string) => {
    setSearchQuery(newVal)
    const newParams = new URLSearchParams(searchParams)
    if (newVal.trim()) {
      newParams.set('q', newVal)
    } else {
      newParams.delete('q')
    }
    setSearchParams(newParams, { replace: true })
  }

  const [phaseFilter, setPhaseFilter] = useState<TripPhase>(
    (searchParams.get('fase') as TripPhase) || 'todas',
  )
  const [periodFilter, setPeriodFilter] = useState<string>('todos')
  const [statusFilter, setStatusFilter] = useState<string>('todos')
  const [modalOpen, setModalOpen] = useState(false)

  // Sync internal state if URL parameter 'fase' changes
  useEffect(() => {
    const f = (searchParams.get('fase') as TripPhase) || 'todas'
    if (f !== phaseFilter) {
      setPhaseFilter(f)
    }
  }, [searchParams])

  const handlePhaseChange = (newPhase: TripPhase) => {
    setPhaseFilter(newPhase)
    const newParams = new URLSearchParams(searchParams)
    if (newPhase && newPhase !== 'todas') {
      newParams.set('fase', newPhase)
    } else {
      newParams.delete('fase')
    }
    setSearchParams(newParams, { replace: true })
  }

  // Quick deletion from listing
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null)
  const [isDeletingTrip, setIsDeletingTrip] = useState(false)

  const loadData = async () => {
    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    setLoading(true)
    try {
      const allTrips = await storageService.listTrips()
      const m = await storageService.getDashboardMetrics()
      setTrips(allTrips)
      setMetrics(m)
    } catch (err: any) {
      console.error('Falha ao carregar viagens no Dashboard:', err)
      const errorMsg = err?.message || 'Erro de comunicação com o servidor'
      toast({
        title: 'Erro ao carregar viagens',
        description: `Não foi possível carregar suas viagens: ${errorMsg}`,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Only trigger query after auth state is resolved
    if (authLoading) return

    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    loadData()
  }, [authLoading, user?.id])

  // Extract unique month/years for period filtering based on trip start_date (regra virada de mês)
  const periodOptions = useMemo(() => {
    const map = new Map<string, string>()
    trips.forEach((t) => {
      if (t.start_date) {
        const [year, month] = t.start_date.split('-')
        const key = `${year}-${month}`
        const monthNames = [
          'Janeiro',
          'Fevereiro',
          'Março',
          'Abril',
          'Maio',
          'Junho',
          'Julho',
          'Agosto',
          'Setembro',
          'Outubro',
          'Novembro',
          'Dezembro',
        ]
        const label = `${monthNames[parseInt(month, 10) - 1]} ${year}`
        map.set(key, label)
      }
    })
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }))
  }, [trips])

  // Contagem de viagens por fase considerando os filtros complementares (período e busca por texto)
  // para que o badge mostre a quantidade exata disponível
  const phaseCounts = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery)
    const tripsMatchingOtherFilters = trips.filter((t) => {
      if (periodFilter !== 'todos' && !t.start_date.startsWith(periodFilter)) return false
      if (statusFilter !== 'todos' && t.status !== statusFilter) return false
      if (normalizedQuery) {
        const destination = normalizeSearchText(t.destination)
        const motivo = normalizeSearchText(t.motivo)
        const notes = normalizeSearchText(t.notes)
        const matches =
          destination.includes(normalizedQuery) ||
          motivo.includes(normalizedQuery) ||
          notes.includes(normalizedQuery)
        if (!matches) return false
      }
      return true
    })
    return countTripsByPhase(tripsMatchingOtherFilters)
  }, [trips, periodFilter, statusFilter, searchQuery])

  // Filter and sort trips: ordenação padrão pelo período (data de início), mais antigas primeiro
  const filteredTrips = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery)

    const result = trips.filter((t) => {
      // Phase filter: em_aberto, empacotadas, quitadas
      if (phaseFilter !== 'todas') {
        const phase = getTripPhase(t)
        if (phase !== phaseFilter) return false
      }

      // Period filter: starts with year-month
      if (periodFilter !== 'todos') {
        if (!t.start_date.startsWith(periodFilter)) return false
      }
      // Status filter
      if (statusFilter !== 'todos') {
        if (t.status !== statusFilter) return false
      }

      // Text search: Destino, Motivo ou Observações (notes)
      if (normalizedQuery) {
        const destination = normalizeSearchText(t.destination)
        const motivo = normalizeSearchText(t.motivo)
        const notes = normalizeSearchText(t.notes)

        const matches =
          destination.includes(normalizedQuery) ||
          motivo.includes(normalizedQuery) ||
          notes.includes(normalizedQuery)

        if (!matches) return false
      }

      return true
    })

    // Ordenação explícita pelo período da viagem (start_date) mais antigas primeiro (ASC),
    // desempatando por created_at ASC para estimular fechar/enviar viagens antigas primeiro.
    return result.sort((a, b) => {
      const dateA = a.start_date || ''
      const dateB = b.start_date || ''
      if (dateA && dateB) {
        const diff = dateA.localeCompare(dateB)
        if (diff !== 0) return diff
      } else if (dateA && !dateB) {
        return -1
      } else if (!dateA && dateB) {
        return 1
      }
      return (a.created_at || '').localeCompare(b.created_at || '')
    })
  }, [trips, phaseFilter, periodFilter, statusFilter, searchQuery])

  const confirmDeleteTrip = async () => {
    if (!tripToDelete) return
    const currentTripSnapshot = { ...tripToDelete }
    setIsDeletingTrip(true)
    try {
      // Carrega despesas em memória antes da exclusão para permitir restauração completa
      const attachedExpenses = await storageService.listExpenses(currentTripSnapshot.id)

      await storageService.deleteTrip(currentTripSnapshot.id, false)
      setTripToDelete(null)
      loadData()

      showTripDeletedUndoToast({
        trip: currentTripSnapshot,
        expenses: attachedExpenses,
        onRestored: () => {
          loadData()
        },
      })
    } catch (err: any) {
      toast({
        title: 'Exclusão não permitida',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    } finally {
      setIsDeletingTrip(false)
    }
  }

  const getTransportIcon = (type: string) => {
    switch (type) {
      case 'aéreo':
        return <Plane className="w-3.5 h-3.5 text-blue-600" />
      case 'carro_proprio':
        return <Car className="w-3.5 h-3.5 text-amber-600" />
      case 'carro_alugado':
        return <CarFront className="w-3.5 h-3.5 text-emerald-600" />
      default:
        return <MoreHorizontal className="w-3.5 h-3.5 text-slate-600" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Subtitle */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Visão Geral
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Acompanhe seus reembolsos corporativos e auditoria de viagens em tempo real
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant={showReceiptModule ? 'default' : 'outline'}
            onClick={() => setShowReceiptModule((prev) => !prev)}
            className={`font-medium text-xs sm:text-sm gap-1.5 transition-colors ${
              showReceiptModule
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                : 'text-blue-700 border-blue-300 hover:bg-blue-50'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>
              {showReceiptModule
                ? 'Ocultar Verificador de Recibos'
                : 'Verificar Recibo / Anti-Duplicidade'}
            </span>
          </Button>

          <Button
            variant="outline"
            onClick={() => setModalOpen(true)}
            className="text-slate-700 hover:text-slate-900 border-slate-300 font-medium text-xs sm:text-sm gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Nova Viagem Manual
          </Button>

          <Button
            onClick={() => navigate('/upload')}
            className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white shadow-sm font-medium text-xs sm:text-sm gap-1.5"
          >
            <UploadCloud className="w-4 h-4" />
            Upload em Lote de Comprovantes
          </Button>
        </div>
      </div>

      {/* Módulo de Busca & Verificação Anti-Duplicidade de Recibos */}
      {showReceiptModule && (
        <div className="transition-all animate-in fade-in-50 duration-200">
          <ReceiptSearchCard onClose={() => setShowReceiptModule(false)} />
        </div>
      )}

      {/* Metrics Row (4 Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total a Reembolsar */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 bg-gradient-to-br from-white to-emerald-50/40">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Total a Reembolsar
              </span>
              <div className="text-2xl font-black text-[#10b981] tabular-nums">
                {formatCurrencyBRL(metrics.totalToRefund)}
              </div>
              <p className="text-[11px] text-slate-500">Aguardando aprovação / conferência</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Viagens em Aberto */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 bg-gradient-to-br from-white to-blue-50/40">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Viagens em Aberto
              </span>
              <div className="text-2xl font-black text-blue-700 tabular-nums">
                {metrics.openTripsCount}
              </div>
              <p className="text-[11px] text-slate-500">Processos ativos no sistema</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-100/80 text-blue-700 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Alertas de Auditoria */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 bg-gradient-to-br from-white to-amber-50/40">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Alertas de Auditoria Ativos
              </span>
              <div className="text-2xl font-black text-amber-600 tabular-nums">
                {metrics.activeAlertsCount}
              </div>
              <p className="text-[11px] text-amber-700/80 font-medium">Pendências de compliance</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-100/80 text-amber-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Total Reembolsado no Mês */}
        <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 bg-gradient-to-br from-white to-emerald-50/30">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Reembolsado no Mês
              </span>
              <div className="text-2xl font-black text-slate-800 tabular-nums">
                {formatCurrencyBRL(metrics.totalReimbursedThisMonth)}
              </div>
              <p className="text-[11px] text-slate-500">Conforme regra da virada de mês</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trips Table Card */}
      <Card className="border border-slate-200 shadow-sm bg-white overflow-hidden">
        {/* Table Controls & Filters: Alternador de Fase + Filtros Específicos */}
        <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3.5">
          {/* Linha Superior: Cabeçalho com contagem + Alternador de Fase em destaque */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Briefcase className="w-4 h-4 text-blue-600" />
              <h3 className="font-bold text-slate-900 text-base">Prestação de Contas por Viagem</h3>
              <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
                {filteredTrips.length} {filteredTrips.length === 1 ? 'viagem' : 'viagens'}
              </span>
              {searchQuery && (
                <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-medium border border-blue-200">
                  Filtrado por: "{searchQuery}"
                </span>
              )}
            </div>

            {/* Alternador de Fase da Viagem (Em Aberto / Enviadas / Quitadas) */}
            <div className="flex items-center gap-2 flex-wrap">
              <TripPhaseToggle
                value={phaseFilter}
                onChange={handlePhaseChange}
                counts={phaseCounts}
                showAllOption={true}
              />
            </div>
          </div>

          {/* Linha Inferior: Busca por texto, período, status e atalho de recibos */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1 border-t border-slate-100">
            <div className="flex items-center gap-3 flex-wrap flex-1">
              {/* Campo de Busca Rápida de Viagens */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Buscar destino, motivo ou notas..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-8 pr-7 h-8 text-xs bg-slate-50 border-slate-200 focus:bg-white"
                />
                {searchQuery && (
                  <button
                    onClick={() => handleSearchChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    title="Limpar filtro"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Filter by Period */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden sm:inline">Período:</span>
                <Select value={periodFilter} onValueChange={setPeriodFilter}>
                  <SelectTrigger className="w-[150px] h-8 text-xs bg-slate-50">
                    <SelectValue placeholder="Todos os períodos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os períodos</SelectItem>
                    {periodOptions.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filter by Status */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="hidden sm:inline">Status:</span>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px] h-8 text-xs bg-slate-50">
                    <SelectValue placeholder="Todos os status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os status</SelectItem>
                    <SelectItem value="em_triagem">Em Triagem</SelectItem>
                    <SelectItem value="com_pendencias">Com Pendências</SelectItem>
                    <SelectItem value="auditada">Auditada</SelectItem>
                    <SelectItem value="fechada">Fechada</SelectItem>
                    <SelectItem value="reembolsada">Reembolsada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Quick button to open receipt verification */}
            {!showReceiptModule && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowReceiptModule(true)}
                className="h-8 text-xs text-blue-700 border-blue-200 hover:bg-blue-50 gap-1"
                title="Checar duplicidade de recibos"
              >
                <Receipt className="w-3.5 h-3.5 text-blue-600" />
                <span className="hidden lg:inline">Checar Recibos</span>
              </Button>
            )}
          </div>
        </div>

        {/* Table / List */}
        {authLoading || loading ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Carregando viagens corporativas...
          </div>
        ) : filteredTrips.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Briefcase className="w-6 h-6" />
            </div>
            <h4 className="font-semibold text-slate-800 text-sm">Nenhuma viagem encontrada</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
              Não foram localizadas prestações com os filtros selecionados. Tente alterar os filtros
              ou cadastrar uma nova viagem.
            </p>
            <Button
              size="sm"
              onClick={() => setModalOpen(true)}
              className="bg-[#1e40af] text-white text-xs"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Criar Nova Viagem
            </Button>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 border-b border-slate-200 uppercase text-[11px] font-semibold text-slate-500 tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Destino</th>
                    <th className="py-3 px-4">Colaborador</th>
                    <th className="py-3 px-4">Período</th>
                    <th className="py-3 px-4">Transporte</th>
                    <th className="py-3 px-4 text-right">Total Acumulado</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTrips.map((trip) => {
                    const effectiveStatus = getEffectiveTripStatus(trip)
                    const statusConf = TRIP_STATUS_CONFIG[effectiveStatus]
                    return (
                      <tr
                        key={trip.id}
                        className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                        onClick={() => navigate(`/trips/${trip.id}`)}
                      >
                        <td className="py-3.5 px-4 font-semibold text-slate-900">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                              <MapPin className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                {trip.destination}
                              </div>
                              <div className="text-[11px] text-slate-400 font-normal truncate max-w-xs">
                                {trip.motivo}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-slate-700">
                          <div className="text-xs font-medium text-slate-900">
                            {trip.user_profile?.full_name ||
                              (trip.user_id === user?.id ? 'Você' : 'Colaborador')}
                          </div>
                          {trip.user_profile?.email && (
                            <div className="text-[10px] text-slate-400">
                              {trip.user_profile.email}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>{formatDateRangeBR(trip.start_date, trip.end_date)}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                            {getTransportIcon(trip.transport_type)}
                            <span>{TRANSPORT_LABELS[trip.transport_type]}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right font-black text-[#10b981] text-sm tabular-nums">
                          {formatCurrencyBRL(trip.total_amount)}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`
                              inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border
                              ${statusConf.badgeClass}
                              ${statusConf.pulse ? 'animate-pulse' : ''}
                            `}
                          >
                            {statusConf.label}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            {storageService.isTripLocked(effectiveStatus) ? (
                              <div
                                className="h-8 w-8 flex items-center justify-center text-slate-300 cursor-not-allowed"
                                title="Viagem fechada/auditada/reembolsada — exclusão bloqueada por governança"
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setTripToDelete(trip)}
                                className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                title="Excluir Viagem"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}

                            <Button
                              size="sm"
                              onClick={() => navigate(`/trips/${trip.id}`)}
                              className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs h-8 px-3 gap-1 shadow-sm"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Auditar / Detalhes</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredTrips.map((trip) => {
                const effectiveStatus = getEffectiveTripStatus(trip)
                const statusConf = TRIP_STATUS_CONFIG[effectiveStatus]
                return (
                  <div
                    key={trip.id}
                    className="p-4 hover:bg-slate-50 transition-colors space-y-2.5 cursor-pointer"
                    onClick={() => navigate(`/trips/${trip.id}`)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                          <MapPin className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">{trip.destination}</h4>
                          <p className="text-xs text-slate-500">
                            {formatDateRangeBR(trip.start_date, trip.end_date)} •{' '}
                            <span className="font-medium text-slate-700">
                              {trip.user_profile?.full_name || 'Colaborador'}
                            </span>
                          </p>
                        </div>
                      </div>
                      <span
                        className={`
                          inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border
                          ${statusConf.badgeClass}
                        `}
                      >
                        {statusConf.label}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2">{trip.motivo}</p>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        {getTransportIcon(trip.transport_type)}
                        <span>{TRANSPORT_LABELS[trip.transport_type]}</span>
                      </div>
                      <div className="text-base font-extrabold text-[#10b981] tabular-nums">
                        {formatCurrencyBRL(trip.total_amount)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      {storageService.isTripLocked(effectiveStatus) ? (
                        <div
                          className="flex items-center justify-center gap-1 text-[11px] text-slate-400 py-1.5 px-2 bg-slate-100 rounded border border-slate-200 cursor-not-allowed flex-1"
                          title="Viagem fechada/auditada/reembolsada — exclusão bloqueada por governança"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Exclusão bloqueada</span>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setTripToDelete(trip)
                          }}
                          className="text-xs h-8 px-2.5 text-rose-600 border-rose-200 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Excluir
                        </Button>
                      )}

                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/trips/${trip.id}`)
                        }}
                        className="flex-1 bg-[#1e40af] text-white text-xs h-8"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Auditar / Ver Detalhes
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* New Trip Modal */}
      <CreateTripModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={(newTrip) => {
          loadData()
          navigate(`/trips/${newTrip.id}`)
        }}
      />

      {/* Delete Trip Alert Dialog */}
      <AlertDialog open={!!tripToDelete} onOpenChange={(open) => !open && setTripToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-600" />
              Excluir Viagem Inteira?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-xs sm:text-sm space-y-2">
              <p>
                Tem certeza que deseja excluir a viagem para{' '}
                <strong className="text-slate-900">"{tripToDelete?.destination}"</strong>?
              </p>
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-800 text-xs space-y-1">
                <p className="font-semibold">⚠️ Exclusão em cascata:</p>
                <p>
                  Todas as despesas associadas a esta viagem serão excluídas. Você terá{' '}
                  <strong>10 segundos</strong> após a exclusão para desfazer a ação pelo aviso na
                  tela.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-2">
            <AlertDialogCancel disabled={isDeletingTrip}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteTrip}
              disabled={isDeletingTrip}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {isDeletingTrip ? 'Excluindo...' : 'Sim, Excluir Viagem e Comprovantes'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
