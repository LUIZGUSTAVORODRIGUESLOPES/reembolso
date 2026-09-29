import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
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
} from 'lucide-react'
import { storageService } from '@/services/storageService'
import { Trip, TripStatus } from '@/types/database'
import {
  formatCurrencyBRL,
  formatDateRangeBR,
  TRIP_STATUS_CONFIG,
  TRANSPORT_LABELS,
} from '@/lib/formatters'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CreateTripModal } from '@/components/CreateTripModal'
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
import { useAuth } from '@/hooks/use-auth'

export default function Index() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState({
    totalToRefund: 0,
    openTripsCount: 0,
    activeAlertsCount: 0,
    totalReimbursedThisMonth: 0,
  })

  const [periodFilter, setPeriodFilter] = useState<string>('todos')
  const [statusFilter, setStatusFilter] = useState<string>('todos')
  const [modalOpen, setModalOpen] = useState(false)

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

  // Filter trips
  const filteredTrips = useMemo(() => {
    return trips.filter((t) => {
      // Period filter: starts with year-month
      if (periodFilter !== 'todos') {
        if (!t.start_date.startsWith(periodFilter)) return false
      }
      // Status filter
      if (statusFilter !== 'todos') {
        if (t.status !== statusFilter) return false
      }
      return true
    })
  }, [trips, periodFilter, statusFilter])

  const confirmDeleteTrip = async () => {
    if (!tripToDelete) return
    setIsDeletingTrip(true)
    try {
      await storageService.deleteTrip(tripToDelete.id)
      toast({
        title: 'Viagem excluída',
        description: `A viagem para ${tripToDelete.destination} e todos os comprovantes vinculados foram removidos com sucesso.`,
      })
      setTripToDelete(null)
      loadData()
    } catch (err: any) {
      toast({
        title: 'Exclusão não permitida',
        description:
          err?.message || 'Viagens com status fechada ou reembolsada não podem ser excluídas.',
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
        {/* Table Controls & Filters */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-base">Prestação de Contas por Viagem</h3>
            <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
              {filteredTrips.length} {filteredTrips.length === 1 ? 'viagem' : 'viagens'}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Filter by Period */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden sm:inline">Período:</span>
              <Select value={periodFilter} onValueChange={setPeriodFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs bg-slate-50">
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
                <SelectTrigger className="w-[160px] h-8 text-xs bg-slate-50">
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
                    const statusConf = TRIP_STATUS_CONFIG[trip.status]
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
                            {storageService.isTripLockedForDeletion(trip.status) ? (
                              <div
                                className="h-8 w-8 flex items-center justify-center text-slate-300 cursor-not-allowed"
                                title="Viagem fechada — exclusão bloqueada"
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
                const statusConf = TRIP_STATUS_CONFIG[trip.status]
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
                      {storageService.isTripLockedForDeletion(trip.status) ? (
                        <div
                          className="flex items-center justify-center gap-1 text-[11px] text-slate-400 py-1.5 px-2 bg-slate-100 rounded border border-slate-200 cursor-not-allowed flex-1"
                          title="Viagem fechada — exclusão bloqueada"
                        >
                          <Lock className="w-3 h-3" />
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
                  Todas as despesas associadas e os respectivos arquivos de comprovantes fiscais
                  (PDFs e imagens) no bucket de armazenamento serão excluídos permanentemente.
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
