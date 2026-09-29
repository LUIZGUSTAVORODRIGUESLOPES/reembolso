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
} from 'lucide-react'
import { userService } from '@/services/userService'
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

  const handleToggleRole = async (targetUser: Profile) => {
    if (targetUser.id === currentUser?.id) {
      toast({
        title: 'Operação não permitida',
        description: 'Você não pode alterar seu próprio papel de administrador.',
        variant: 'destructive',
      })
      return
    }

    const newRole: UserRole = targetUser.role === 'admin' ? 'solicitante' : 'admin'
    const confirmChange = window.confirm(
      `Deseja alterar o papel de "${targetUser.full_name}" para ${
        newRole === 'admin' ? 'Administrador' : 'Solicitante'
      }?`,
    )
    if (!confirmChange) return

    try {
      setActionLoadingId(targetUser.id)
      await userService.updateUser(targetUser.id, { role: newRole })
      toast({
        title: 'Papel atualizado!',
        description: `Usuário agora é ${newRole === 'admin' ? 'Administrador' : 'Solicitante'}.`,
      })
      setUsers((prev) => prev.map((u) => (u.id === targetUser.id ? { ...u, role: newRole } : u)))
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

  const handleToggleActive = async (targetUser: Profile) => {
    if (targetUser.id === currentUser?.id) {
      toast({
        title: 'Operação não permitida',
        description: 'Você não pode desativar seu próprio acesso.',
        variant: 'destructive',
      })
      return
    }

    const newStatus = !targetUser.is_active
    const confirmChange = window.confirm(
      `Deseja realmente ${newStatus ? 'reativar' : 'desativar'} o acesso de "${
        targetUser.full_name
      }"? As viagens já lançadas continuarão vinculadas ao colaborador.`,
    )
    if (!confirmChange) return

    try {
      setActionLoadingId(targetUser.id)
      await userService.updateUser(targetUser.id, { is_active: newStatus })
      toast({
        title: newStatus ? 'Usuário reativado!' : 'Usuário desativado!',
        description: `O acesso à plataforma foi ${newStatus ? 'liberado' : 'bloqueado'}.`,
      })
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, is_active: newStatus } : u)),
      )
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

        <div className="flex items-center gap-2">
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
                              disabled={isSelf || isRowBusy}
                              onClick={() => handleToggleRole(item)}
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
                              onClick={() => handleToggleActive(item)}
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
    </div>
  )
}
