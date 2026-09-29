import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ShieldCheck,
  Mail,
  Lock,
  User,
  ArrowRight,
  Loader2,
  Sparkles,
  CheckCircle2,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn, signUp, user } = useAuth()
  const { toast } = useToast()

  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)

  // Login form state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Register form state
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('')
  const [registerFullName, setRegisterFullName] = useState('')

  const from = (location.state as any)?.from?.pathname || '/'

  // Redirect if already logged in
  React.useEffect(() => {
    if (user) {
      navigate(from, { replace: true })
    }
  }, [user, navigate, from])

  const translateAuthError = (err: any): string => {
    const msg = err?.message || ''
    if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
      return 'E-mail ou senha incorretos. Verifique suas credenciais.'
    }
    if (msg.includes('Email not confirmed')) {
      return 'E-mail ainda não confirmado. Verifique sua caixa de entrada.'
    }
    if (msg.includes('User already registered') || msg.includes('already exists')) {
      return 'Já existe uma conta cadastrada com este e-mail.'
    }
    if (msg.includes('Password should be at least')) {
      return 'A senha deve ter pelo menos 6 caracteres.'
    }
    if (msg.includes('rate limit')) {
      return 'Muitas tentativas em sequência. Aguarde alguns instantes.'
    }
    return msg || 'Ocorreu um erro ao processar sua solicitação.'
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginEmail || !loginPassword) {
      toast({
        title: 'Campos incompletos',
        description: 'Informe seu e-mail e senha para continuar.',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    const { error } = await signIn(loginEmail, loginPassword)
    setLoading(false)

    if (error) {
      toast({
        title: 'Falha no login',
        description: translateAuthError(error),
        variant: 'destructive',
      })
      return
    }

    toast({
      title: 'Acesso liberado',
      description: 'Sessão iniciada com sucesso.',
    })
    navigate(from, { replace: true })
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!registerEmail || !registerPassword || !registerFullName) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha seu nome completo, e-mail e senha.',
        variant: 'destructive',
      })
      return
    }

    if (registerPassword.length < 6) {
      toast({
        title: 'Senha muito curta',
        description: 'A senha deve conter no mínimo 6 caracteres.',
        variant: 'destructive',
      })
      return
    }

    if (registerPassword !== registerPasswordConfirm) {
      toast({
        title: 'Confirmação de senha',
        description: 'A confirmação de senha não confere.',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    const { error } = await signUp(registerEmail, registerPassword, registerFullName)
    setLoading(false)

    if (error) {
      toast({
        title: 'Falha no cadastro',
        description: translateAuthError(error),
        variant: 'destructive',
      })
      return
    }

    toast({
      title: 'Cadastro realizado!',
      description:
        'Sua conta foi criada. Caso seja o primeiro usuário do sistema, você foi configurado como Administrador com todas as viagens vinculadas.',
    })
    navigate(from, { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

      {/* Main card */}
      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#1e40af] to-blue-500 text-white shadow-xl shadow-blue-500/25 mb-3 border border-blue-400/30">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center justify-center gap-1.5">
            Reembolso<span className="text-blue-400">.ai</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 uppercase font-semibold tracking-wider">
            Gestão Corporativa de Prestação de Contas
          </p>
        </div>

        <Card className="border-slate-800 bg-slate-900/90 backdrop-blur-md text-slate-100 shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold text-white text-center">
              {tab === 'login' ? 'Acessar Plataforma' : 'Criar Nova Conta'}
            </CardTitle>
            <CardDescription className="text-xs text-slate-400 text-center">
              {tab === 'login'
                ? 'Entre com suas credenciais corporativas'
                : 'Cadastre-se para solicitar e auditar reembolsos'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Tabs
              value={tab}
              onValueChange={(val) => setTab(val as 'login' | 'register')}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 bg-slate-800/80 mb-5 p-1">
                <TabsTrigger
                  value="login"
                  className="data-[state=active]:bg-[#1e40af] data-[state=active]:text-white text-xs py-1.5"
                >
                  Entrar
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  className="data-[state=active]:bg-[#1e40af] data-[state=active]:text-white text-xs py-1.5"
                >
                  Criar Conta
                </TabsTrigger>
              </TabsList>

              {/* TAB LOGIN */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email" className="text-xs text-slate-300 font-medium">
                      E-mail Corporativo
                    </Label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="seu.nome@empresa.com.br"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 h-10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="login-password"
                        className="text-xs text-slate-300 font-medium"
                      >
                        Senha
                      </Label>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        id="login-password"
                        type="password"
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 h-10 text-sm"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#1e40af] hover:bg-[#1d3d9e] text-white font-medium h-10 shadow-lg shadow-blue-900/30 transition-all text-sm mt-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Autenticando...
                      </>
                    ) : (
                      <>
                        Entrar no Sistema
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* TAB REGISTER */}
              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-3.5">
                  <div className="p-2.5 rounded-lg bg-blue-950/40 border border-blue-500/20 text-xs text-blue-200 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <span>
                      O primeiro usuário cadastrado torna-se <strong>Administrador</strong> e herda
                      automaticamente todas as viagens existentes.
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="register-name" className="text-xs text-slate-300 font-medium">
                      Nome Completo
                    </Label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        id="register-name"
                        type="text"
                        placeholder="Ex: Luiz Fernando Silva"
                        value={registerFullName}
                        onChange={(e) => setRegisterFullName(e.target.value)}
                        required
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 h-10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="register-email" className="text-xs text-slate-300 font-medium">
                      E-mail Corporativo
                    </Label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        id="register-email"
                        type="email"
                        placeholder="luiz@globexmultimodal.com.br"
                        value={registerEmail}
                        onChange={(e) => setRegisterEmail(e.target.value)}
                        required
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 h-10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="register-password"
                      className="text-xs text-slate-300 font-medium"
                    >
                      Senha (mínimo 6 caracteres)
                    </Label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        id="register-password"
                        type="password"
                        placeholder="••••••••"
                        value={registerPassword}
                        onChange={(e) => setRegisterPassword(e.target.value)}
                        required
                        minLength={6}
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 h-10 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="register-password-confirm"
                      className="text-xs text-slate-300 font-medium"
                    >
                      Confirmar Senha
                    </Label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        id="register-password-confirm"
                        type="password"
                        placeholder="••••••••"
                        value={registerPasswordConfirm}
                        onChange={(e) => setRegisterPasswordConfirm(e.target.value)}
                        required
                        minLength={6}
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 h-10 text-sm"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#1e40af] hover:bg-[#1d3d9e] text-white font-medium h-10 shadow-lg shadow-blue-900/30 transition-all text-sm mt-3"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Criando conta...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Cadastrar e Acessar
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Security badge footer */}
        <div className="mt-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <span>Ambiente Seguro SSL</span>
          <span>•</span>
          <span>RLS & Supabase Auth</span>
        </div>
      </div>
    </div>
  )
}
