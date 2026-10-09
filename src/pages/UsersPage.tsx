import React, { useEffect, useState } from 'react'
import {
  Users,
  UserPlus,
  ShieldCheck,
  Shield,
  Search,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  Lock,
  Mail,
  User as UserIcon,
  Bell,
  BellRing,
  BellOff,
  Settings,
  Info,
  Clock,
  Sparkles,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { userService } from '@/services/userService'
import { reminderTriggerService } from '@/services/reminderTriggerService'
import { Profile, UserRole } from '@/types/database'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { formatDateBR } from '@/lib/formatters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
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
import { showUserStatusUndoToast } from '@/services/undoService'

export default function UsersPage() {
  const { user: currentUser, loading: authLoading } = useAuth()
  const { toast } = useToast()

  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Create User Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createRole, setCreateRole] = useState<UserRole>('solicitante')
  const [creating, setCreating] = useState(false)

  // Edit / Action state
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // Confirmation dialogs
  const [userToToggleStatus, setUserToToggleStatus] = useState<Profile | null>(null)
  const [userToToggleRole, setUserToToggleRole] = useState<Profile | null>(null)

  // Modal de Configuração de Alertas de Viagem Não Enviada
  const [userToConfigAlerts, setUserToConfigAlerts] = useState<Profile | null>(null)
  const [alertEnabled, setAlertEnabled] = useState<boolean>(true)
  const [alertDays, setAlertDays] = useState<number>(5)
  const [alertRepeatDays, setAlertRepeatDays] = useState<number>(7)
  const [savingAlertConfig, setSavingAlertConfig] = useState(false)
  const [testingAlerts, setTestingAlerts] = useState(false)
  const [executingRealAlerts, setExecutingRealAlerts] = useState(false)

  const loadUsers = async () => {
    try {
      setLoading(true)
      const data = await userService.listUsers()
      setUsers(data)
    } catch (err: any) {
      toast({
        title: 'Erro ao carregar usuários',
        description: err.message || 'Falha na comunicação com o banco.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    loadUsers()
  }, [authLoading, currentUser?.id])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createEmail || !createPassword || !createName) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha todos os campos do novo usuário.',
        variant: 'destructive',
      })
      return
    }

    if (createPassword.length < 6) {
      toast({
        title: 'Senha muito curta',
        description: 'Mínimo de 6 caracteres.',
        variant: 'destructive',
      })
      return
    }

    try {
      setCreating(true)
      const res = await userService.createUser({
        email: createEmail,
        password: createPassword,
        fullName: createName,
        role: createRole,
      })

      if (res.error) {
        toast({
          title: 'Erro ao criar usuário',
          description: res.error.message || 'Verifique os dados informados.',
          variant: 'destructive',
        })
        return
      }

      toast({
        title: 'Usuário cadastrado com sucesso!',
        description: `${createName} (${createRole === 'admin' ? 'Administrador' : 'Solicitante'}) já pode acessar.`,
      })

      setIsCreateOpen(false)
      setCreateName('')
      setCreateEmail('')
      setCreatePassword('')
      setCreateRole('solicitante')

      // Reload list after brief delay for trigger completion
      setTimeout(loadUsers, 600)
    } catch (err: any) {
      toast({
        title: 'Erro inesperado',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  const confirmToggleRole = async () => {
    if (!userToToggleRole) return
    const targetUser = userToToggleRole
    const newRole: UserRole = targetUser.role === 'admin' ? 'solicitante' : 'admin'

    try {
      setActionLoadingId(targetUser.id)
      await userService.updateUser(targetUser.id, { role: newRole })
      toast({
        title: 'Papel atualizado!',
        description: `O colaborador "${targetUser.full_name}" agora é ${
          newRole === 'admin' ? 'Administrador' : 'Solicitante'
        }.`,
      })
      setUsers((prev) => prev.map((u) => (u.id === targetUser.id ? { ...u, role: newRole } : u)))
      setUserToToggleRole(null)
    } catch (err: any) {
      toast({
        title: 'Falha ao atualizar papel',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setActionLoadingId(null)
    }
  }

  const confirmToggleActive = async () => {
    if (!userToToggleStatus) return
    const targetUser = userToToggleStatus
    const previousActive = targetUser.is_active
    const newStatus = !previousActive

    try {
      setActionLoadingId(targetUser.id)
      await userService.updateUser(targetUser.id, { is_active: newStatus })
      setUserToToggleStatus(null)

      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, is_active: newStatus } : u)),
      )

      // Toast com botão Desfazer para reverter o status de ativação
      showUserStatusUndoToast({
        user: targetUser,
        previousActiveState: previousActive,
        onReverted: (reverted) => {
          setUsers((prev) => prev.map((u) => (u.id === reverted.id ? reverted : u)))
        },
      })
    } catch (err: any) {
      toast({
        title: 'Falha ao alterar status',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleToggleRoleClick = (targetUser: Profile) => {
    if (targetUser.id === currentUser?.id) {
      toast({
        title: 'Operação não permitida',
        description: 'Você não pode alterar seu próprio papel de administrador.',
        variant: 'destructive',
      })
      return
    }
    setUserToToggleRole(targetUser)
  }

  const handleToggleActiveClick = (targetUser: Profile) => {
    if (targetUser.id === currentUser?.id) {
      toast({
        title: 'Operação não permitida',
        description: 'Você não pode desativar seu próprio acesso.',
        variant: 'destructive',
      })
      return
    }
    setUserToToggleStatus(targetUser)
  }

  const handleOpenAlertConfig = (targetUser: Profile) => {
    setUserToConfigAlerts(targetUser)
    setAlertEnabled(targetUser.alert_unsent_trip_enabled ?? true)
    setAlertDays(targetUser.alert_unsent_trip_days ?? 5)
    setAlertRepeatDays(targetUser.alert_unsent_trip_repeat_days ?? 7)
  }

  const handleSaveAlertConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userToConfigAlerts) return

    const sanitizedDays = Math.max(1, Math.min(90, Number(alertDays) || 5))
    const sanitizedRepeatDays = Math.max(1, Math.min(90, Number(alertRepeatDays) || 7))

    try {
      setSavingAlertConfig(true)
      const updated = await userService.updateUser(userToConfigAlerts.id, {
        alert_unsent_trip_enabled: alertEnabled,
        alert_unsent_trip_days: sanitizedDays,
        alert_unsent_trip_repeat_days: sanitizedRepeatDays,
      })

      setUsers((prev) =>
        prev.map((u) =>
          u.id === updated.id
            ? {
                ...u,
                alert_unsent_trip_enabled: updated.alert_unsent_trip_enabled,
                alert_unsent_trip_days: updated.alert_unsent_trip_days,
                alert_unsent_trip_repeat_days: updated.alert_unsent_trip_repeat_days,
              }
            : u,
        ),
      )

      toast({
        title: 'Preferências de alerta salvas!',
        description: alertEnabled
          ? `Lembrete ativo: 1º e-mail ${sanitizedDays} dias após o término, e reenvios a cada ${sanitizedRepeatDays} dias até o envio da prestação.`
          : 'Lembretes automáticos desativados para este colaborador.',
      })

      setUserToConfigAlerts(null)
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar configuração',
        description: err.message || 'Falha ao gravar preferências no banco.',
        variant: 'destructive',
      })
    } finally {
      setSavingAlertConfig(false)
    }
  }

  const handleTriggerTestReminder = async () => {
    try {
      setTestingAlerts(true)
      const res = await userService.triggerReminderCheck({ dryRun: true })
      const dueCount = res?.dueRemindersCount ?? res?.dueReminders?.length ?? 0
      const evaluated = res?.evaluatedCount ?? res?.evaluatedTripsCount ?? 0
      const firstCount = res?.firstReminderCount ?? 0
      const recurringCount = res?.recurringReminderCount ?? 0

      if (dueCount === 0) {
        toast({
          title: 'Simulação concluída',
          description: `Nenhuma viagem pendente atingiu a janela de alerta (${evaluated} viagem(ns) avaliada(s)).`,
        })
      } else {
        toast({
          title: 'Checagem simulada (Dry-Run)',
          description: `${dueCount} lembrete(s) devido(s) de ${evaluated} viagem(ns) avaliada(s): ${firstCount} no 1º alerta e ${recurringCount} na janela de reenvio periódico. Nenhum e-mail foi enviado.`,
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro na checagem de lembretes',
        description: err?.message || 'Falha ao executar a simulação.',
        variant: 'destructive',
      })
    } finally {
      setTestingAlerts(false)
    }
  }

  const handleExecuteRealReminderCheck = async () => {
    try {
      setExecutingRealAlerts(true)
      const res = await userService.triggerReminderCheck({ dryRun: false })

      // Atualiza timestamp local de checagem
      reminderTriggerService.recordCheckTimestamp()

      const sentCount = res?.remindersSent ?? 0
      const dueCount = res?.dueRemindersCount ?? 0

      if (res?.configured === false) {
        toast({
          title: 'Provedor de e-mail não configurado',
          description:
            res.message || 'A chave RESEND_API_KEY não foi configurada nos segredos do Supabase.',
          variant: 'destructive',
        })
        return
      }

      if (sentCount > 0) {
        toast({
          title: 'Checagem de lembretes concluída!',
          description: `${sentCount} e-mail(s) de lembrete enviado(s) com sucesso para colaboradores com viagens pendentes.`,
        })
      } else if (dueCount === 0) {
        toast({
          title: 'Nenhuma viagem pendente',
          description:
            'Todas as viagens finalizadas estão em dia ou com relatórios já enviados. Nenhum lembrete foi necessário.',
        })
      } else {
        toast({
          title: 'Checagem concluída',
          description:
            res?.message ||
            'Nenhum novo lembrete foi enviado (viagens já alertadas anteriormente).',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao executar checagem',
        description: err?.message || 'Falha ao disparar a edge function de lembretes.',
        variant: 'destructive',
      })
    } finally {
      setExecutingRealAlerts(false)
    }
  }

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase()
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-[#1e40af]" />
            Gestão de Usuários & Perfis
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Controle de acessos, papéis corporativos (Administrador / Solicitante) e vinculação de
            viagens.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={loadUsers}
            disabled={loading}
            className="text-xs h-9 gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>

          {/* Testar motor de lembretes diários (dry-run sem spam) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleTriggerTestReminder}
            disabled={testingAlerts || executingRealAlerts || loading}
            title="Simula a checagem diária de viagens não enviadas sem enviar e-mails reais (Dry Run)"
            className="text-xs h-9 gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50"
          >
            <Clock className={`w-3.5 h-3.5 ${testingAlerts ? 'animate-spin' : 'text-blue-600'}`} />
            <span className="hidden sm:inline">Simular Checagem de Alertas</span>
            <span className="sm:hidden">Simular</span>
          </Button>

          {/* Executar checagem agora (modo real) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExecuteRealReminderCheck}
            disabled={executingRealAlerts || testingAlerts || loading}
            title="Executa a checagem diária real agora e envia e-mails de lembrete para viagens pendentes que atingiram o prazo configurado"
            className="text-xs h-9 gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50"
          >
            <BellRing
              className={`w-3.5 h-3.5 ${executingRealAlerts ? 'animate-spin text-amber-600' : 'text-amber-600'}`}
            />
            <span className="hidden sm:inline">Executar checagem agora</span>
            <span className="sm:hidden">Checar agora</span>
          </Button>

          <Button
            onClick={() => setIsCreateOpen(true)}
            size="sm"
            className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs h-9 gap-1.5 shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Novo Usuário
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-slate-500 font-medium">
              Total de Colaboradores
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{users.length}</CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-slate-500 font-medium">
              Administradores
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-700">
              {users.filter((u) => u.role === 'admin').length}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-slate-500 font-medium">
              Solicitantes de Reembolso
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">
              {users.filter((u) => u.role === 'solicitante').length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="border-slate-200 shadow-sm bg-white overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold text-slate-900">
              Colaboradores Cadastrados
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Cada viagem lançada é rastreada com o colaborador responsável.
            </CardDescription>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por nome, e-mail ou perfil..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs bg-slate-50 border-slate-200"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-[#1e40af] mb-2" />
              <p className="text-xs">Carregando lista de colaboradores...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Users className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-700">Nenhum colaborador encontrado</p>
              <p className="text-xs text-slate-400 mt-1">
                {search ? 'Tente outros termos na busca.' : 'Cadastre o primeiro colaborador.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Colaborador</th>
                    <th className="py-3 px-4">Papel / Perfil</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Alerta de Viagem Não Enviada</th>
                    <th className="py-3 px-4 text-center">Viagens Vinculadas</th>
                    <th className="py-3 px-4">Data de Cadastro</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((item) => {
                    const isSelf = item.id === currentUser?.id
                    const isRowBusy = actionLoadingId === item.id

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center shrink-0 uppercase text-xs">
                              {item.full_name.slice(0, 2) || 'US'}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                                {item.full_name}
                                {isSelf && (
                                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded font-medium">
                                    Você
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-500 text-[11px]">{item.email}</div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          {item.role === 'admin' ? (
                            <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200 font-medium text-[11px] gap-1">
                              <ShieldCheck className="w-3 h-3 text-blue-700" />
                              Administrador
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200 font-medium text-[11px] gap-1">
                              <Shield className="w-3 h-3 text-slate-500" />
                              Solicitante
                            </Badge>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          {item.is_active ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Ativo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600">
                              <XCircle className="w-3.5 h-3.5" />
                              Inativo
                            </span>
                          )}
                        </td>

                        {/* Configuração de Alerta de Viagem Não Enviada */}
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => handleOpenAlertConfig(item)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors hover:bg-slate-100 border border-slate-200 text-left"
                            title="Clique para configurar o alerta deste usuário"
                          >
                            {item.alert_unsent_trip_enabled !== false ? (
                              <>
                                <BellRing className="w-3 h-3 text-amber-600 shrink-0" />
                                <div>
                                  <span className="text-slate-800 font-semibold">
                                    {item.alert_unsent_trip_days ?? 5}d
                                  </span>
                                  <span className="text-slate-500 text-[10px]"> após o fim</span>
                                  <span className="text-slate-400 mx-1">·</span>
                                  <span className="text-amber-700 font-semibold">
                                    +{item.alert_unsent_trip_repeat_days ?? 7}d
                                  </span>
                                  <span className="text-slate-500 text-[10px]"> repete</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <BellOff className="w-3 h-3 text-slate-400 shrink-0" />
                                <span className="text-slate-500">Desativado</span>
                              </>
                            )}
                            <Settings className="w-2.5 h-2.5 text-slate-400 ml-0.5" />
                          </button>
                        </td>

                        <td className="py-3 px-4 text-center">
                          <span className="inline-block px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 font-bold text-xs">
                            {item.trips_count || 0}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-slate-600">
                          {item.created_at ? formatDateBR(item.created_at) : '—'}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAlertConfig(item)}
                              title="Configurar alerta de viagem não enviada"
                              className="h-7 text-[11px] px-2 border-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 gap-1"
                            >
                              <Bell className="w-3 h-3 text-amber-600" />
                              <span className="hidden sm:inline">Alertas</span>
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isSelf || isRowBusy}
                              onClick={() => handleToggleRoleClick(item)}
                              title={
                                item.role === 'admin'
                                  ? 'Rebaixar para Solicitante'
                                  : 'Promover para Administrador'
                              }
                              className="h-7 text-[11px] px-2.5 border-slate-200 hover:bg-slate-100"
                            >
                              {item.role === 'admin' ? 'Mudar p/ Solicitante' : 'Mudar p/ Admin'}
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isSelf || isRowBusy}
                              onClick={() => handleToggleActiveClick(item)}
                              className={`h-7 text-[11px] px-2.5 border-slate-200 ${
                                item.is_active
                                  ? 'text-red-600 hover:text-red-700 hover:bg-red-50'
                                  : 'text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50'
                              }`}
                            >
                              {item.is_active ? 'Desativar' : 'Reativar'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal Create User */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateUser}>
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#1e40af]" />
                Cadastrar Novo Colaborador
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                O colaborador receberá acesso imediato e poderá registrar comprovantes e reembolsos.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="create-name" className="text-xs font-medium text-slate-700">
                  Nome Completo
                </Label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="create-name"
                    placeholder="Ex: Mariana Castro"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    required
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-email" className="text-xs font-medium text-slate-700">
                  E-mail Corporativo
                </Label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="create-email"
                    type="email"
                    placeholder="mariana@globexmultimodal.com.br"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    required
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-pass" className="text-xs font-medium text-slate-700">
                  Senha Provisória
                </Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="create-pass"
                    type="password"
                    placeholder="••••••••"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    required
                    minLength={6}
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-role" className="text-xs font-medium text-slate-700">
                  Papel no Sistema
                </Label>
                <Select value={createRole} onValueChange={(val) => setCreateRole(val as UserRole)}>
                  <SelectTrigger id="create-role" className="h-9 text-xs">
                    <SelectValue placeholder="Selecione o papel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solicitante" className="text-xs">
                      Solicitante (cria e audita apenas as próprias viagens)
                    </SelectItem>
                    <SelectItem value="admin" className="text-xs">
                      Administrador (gestão total + todas as viagens + usuários)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
                className="text-xs h-9"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={creating}
                className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs h-9 gap-1.5"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    Criar Colaborador
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog: Desativar / Reativar Colaborador */}
      <AlertDialog
        open={Boolean(userToToggleStatus)}
        onOpenChange={(open) => !open && setUserToToggleStatus(null)}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900 text-base">
              {userToToggleStatus?.is_active
                ? 'Desativar acesso do colaborador?'
                : 'Reativar acesso do colaborador?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600 space-y-2">
              <p>
                Colaborador: <strong>{userToToggleStatus?.full_name}</strong> (
                {userToToggleStatus?.email})
              </p>
              {userToToggleStatus?.is_active ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900 text-xs space-y-1">
                  <p className="font-semibold">O que acontece ao desativar:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-amber-800">
                    <li>O colaborador não poderá mais fazer login no sistema.</li>
                    <li>
                      As viagens e despesas já vinculadas continuam preservadas para auditoria.
                    </li>
                    <li>
                      Você poderá <strong>desfazer esta ação imediatamente</strong> através do aviso
                      na tela.
                    </li>
                  </ul>
                </div>
              ) : (
                <p>
                  O colaborador voltará a ter acesso ao sistema conforme o seu perfil cadastrado.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleActive}
              className={`text-xs ${
                userToToggleStatus?.is_active
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {userToToggleStatus?.is_active ? 'Sim, Desativar' : 'Sim, Reativar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation Dialog: Alterar Papel / Permissões */}
      <AlertDialog
        open={Boolean(userToToggleRole)}
        onOpenChange={(open) => !open && setUserToToggleRole(null)}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900 text-base">
              Alterar papel do colaborador?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600 space-y-2">
              <p>
                Deseja alterar o perfil de <strong>"{userToToggleRole?.full_name}"</strong> para{' '}
                <strong>
                  {userToToggleRole?.role === 'admin' ? 'Solicitante' : 'Administrador'}
                </strong>
                ?
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700 text-xs">
                {userToToggleRole?.role === 'admin'
                  ? 'O colaborador perderá privilégios administrativos e só terá acesso às próprias viagens.'
                  : 'O colaborador terá acesso completo a relatórios corporativos, aprovações e gestão de viagens de toda a equipe.'}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleRole}
              className="text-xs bg-[#1e40af] hover:bg-[#1d3d9e] text-white"
            >
              Confirmar Alteração
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Configuração de Alerta de Viagem Não Enviada */}
      <Dialog
        open={Boolean(userToConfigAlerts)}
        onOpenChange={(open) => !open && setUserToConfigAlerts(null)}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSaveAlertConfig}>
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <BellRing className="w-5 h-5 text-amber-600" />
                Alerta de Viagem Não Enviada
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Configure se e quando este colaborador receberá lembretes por e-mail para viagens
                finalizadas cujas prestações de contas ainda não foram enviadas.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Colaborador:</span>
                  <span className="font-semibold text-slate-800">
                    {userToConfigAlerts?.full_name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">E-mail de envio:</span>
                  <span className="text-slate-700 font-mono text-[11px]">
                    {userToConfigAlerts?.email}
                  </span>
                </div>
              </div>

              {/* Toggle Habilitar / Desabilitar */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 bg-white">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="alert-toggle"
                    className="text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    Habilitar lembretes automáticos
                  </Label>
                  <p className="text-[11px] text-slate-500">
                    Disparar e-mail de aviso quando houver viagem vencida não enviada
                  </p>
                </div>
                <Switch
                  id="alert-toggle"
                  checked={alertEnabled}
                  onCheckedChange={setAlertEnabled}
                />
              </div>

              {/* Quantidade de dias (X) */}
              {alertEnabled && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="alert-days-input"
                      className="text-xs font-semibold text-slate-800"
                    >
                      Disparar e-mail após quantos dias do fim da viagem?
                    </Label>
                    <span className="font-bold text-sm text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                      {alertDays} {alertDays === 1 ? 'dia' : 'dias'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <Input
                      id="alert-days-input"
                      type="number"
                      min={1}
                      max={90}
                      value={alertDays}
                      onChange={(e) =>
                        setAlertDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))
                      }
                      className="w-24 h-9 text-xs bg-white text-center font-semibold"
                    />
                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={alertDays}
                      onChange={(e) => setAlertDays(parseInt(e.target.value) || 1)}
                      className="flex-1 accent-amber-600 cursor-pointer"
                    />
                  </div>

                  {/* Feedback amigável do 1º alerta */}
                  <p className="text-[11px] text-slate-600">
                    O primeiro lembrete será enviado se a viagem não for despachada após este prazo.
                  </p>
                </div>
              )}

              {/* Intervalo de repetição periódica (Y) */}
              {alertEnabled && (
                <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="alert-repeat-days-input"
                      className="text-xs font-semibold text-slate-800"
                    >
                      Após o primeiro alerta, repetir a cada quantos dias?
                    </Label>
                    <span className="font-bold text-sm text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                      {alertRepeatDays} {alertRepeatDays === 1 ? 'dia' : 'dias'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <Input
                      id="alert-repeat-days-input"
                      type="number"
                      min={1}
                      max={90}
                      value={alertRepeatDays}
                      onChange={(e) =>
                        setAlertRepeatDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))
                      }
                      className="w-24 h-9 text-xs bg-white text-center font-semibold"
                    />
                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={alertRepeatDays}
                      onChange={(e) => setAlertRepeatDays(parseInt(e.target.value) || 1)}
                      className="flex-1 accent-blue-600 cursor-pointer"
                    />
                  </div>

                  {/* Feedback amigável da regra completa */}
                  <div className="flex items-start gap-2 pt-1 text-[11px] text-slate-600">
                    <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                    <p>
                      <strong>Regra de disparo:</strong> Você receberá o primeiro e-mail{' '}
                      <span className="text-slate-800 font-semibold">{alertDays} dias</span> após o
                      fim da viagem se ela não for enviada, e depois um lembrete a cada{' '}
                      <span className="text-blue-800 font-semibold">{alertRepeatDays} dias</span>{' '}
                      até o envio da prestação de contas.
                    </p>
                  </div>
                </div>
              )}

              {!alertEnabled && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
                  <BellOff className="w-4 h-4 text-slate-400 shrink-0" />
                  <p>
                    Os lembretes estão desativados para este colaborador. Nenhuma notificação por
                    e-mail será gerada sobre viagens pendentes de envio.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setUserToConfigAlerts(null)}
                className="text-xs h-9"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={savingAlertConfig}
                className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white text-xs h-9 gap-1.5"
              >
                {savingAlertConfig ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    Salvar Preferência
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
