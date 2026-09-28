import {
  Trip,
  Expense,
  AuditRulesLog,
  ExpenseCategory,
  AuditEvaluationRule,
} from '@/types/database'

const STORAGE_KEYS = {
  TRIPS: 'reembolso_trips_v1',
  EXPENSES: 'reembolso_expenses_v1',
  AUDIT_LOGS: 'reembolso_audit_logs_v1',
  INITIALIZED: 'reembolso_initialized_v1',
}

// 3 Seed Trips
const SEED_TRIPS: Trip[] = [
  {
    id: 'trip-sp-001',
    user_id: 'user-default-01',
    destination: 'São Paulo, SP',
    start_date: '2025-03-10',
    end_date: '2025-03-12',
    transport_type: 'aéreo',
    status: 'auditada',
    total_amount: 2845.8,
    motivo:
      'Alinhamento estratégico com diretoria regional e visita a clientes chave na Av. Paulista',
    notes: 'Acomodação reservada próximo à Paulista. Voos Gol Linhas Aéreas.',
    created_at: '2025-03-08T10:00:00Z',
  },
  {
    id: 'trip-cwb-002',
    user_id: 'user-default-01',
    destination: 'Curitiba, PR',
    start_date: '2025-03-18',
    end_date: '2025-03-19',
    transport_type: 'carro_alugado',
    status: 'com_pendencias',
    total_amount: 512.4,
    motivo:
      'Visita técnica à planta fabril de São José dos Pinhais e auditoria de processos de expedição',
    notes:
      'Necessário verificar fatura de locação de veículo e recibo de pedágio que ainda não foram anexados.',
    created_at: '2025-03-17T14:30:00Z',
  },
  {
    id: 'trip-triage-003',
    user_id: 'user-default-01',
    destination: 'Belo Horizonte, MG',
    start_date: '2025-03-24',
    end_date: '2025-03-26',
    transport_type: 'aéreo',
    status: 'em_triagem',
    total_amount: 1948.3,
    motivo: 'Workshop de capacitação técnica de parceiros e homologação de software',
    notes: 'Recibos enviados em lote pendentes de conferência pelo usuário.',
    created_at: '2025-03-24T08:15:00Z',
  },
]

// Seed Expenses
const SEED_EXPENSES: Expense[] = [
  // --- VIAGEM 1: São Paulo (100% auditada / conforme) ---
  {
    id: 'exp-sp-01',
    trip_id: 'trip-sp-001',
    file_name: 'passagem_aerea_gol_ida_volta_sp.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-10',
    issue_time: '07:15',
    category: 'transporte',
    merchant_name: 'Gol Linhas Aéreas Inteligentes S.A.',
    amount: 1420.5,
    ocr_raw_text:
      'GOL LINHAS AEREAS S/A - BILHETE DE PASSAGEM ELETRONICO - TRECHO SDU-CGH / CGH-SDU - TOTAL R$ 1.420,50 - CNPJ 07.575.651/0001-59',
    is_verified: true,
    audit_flags: [],
    audit_status: 'conforme',
    cnpj: '07.575.651/0001-59',
  },
  {
    id: 'exp-sp-02',
    trip_id: 'trip-sp-001',
    file_name: 'hotel_ibis_paulista_2diarias.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-12',
    issue_time: '11:00',
    category: 'hospedagem',
    merchant_name: 'Hotel Ibis São Paulo Paulista',
    amount: 890.0,
    ocr_raw_text:
      'HOTEL IBIS PAULISTA - NOTA FISCAL DE SERVICOS - HOSPEDAGEM 2 DIARIAS - CHECKIN 10/03 CHECKOUT 12/03 - TOTAL R$ 890,00 - CNPJ 01.234.567/0001-89',
    is_verified: true,
    audit_flags: [],
    audit_status: 'conforme',
    cnpj: '01.234.567/0001-89',
  },
  {
    id: 'exp-sp-03',
    trip_id: 'trip-sp-001',
    file_name: 'recibo_uber_aeroporto_congonhas.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-10',
    issue_time: '08:45',
    category: 'uber_taxi',
    merchant_name: 'Uber do Brasil Tecnologia Ltda.',
    amount: 68.4,
    ocr_raw_text:
      'UBER RECIBO - VIAGEM CONGONHAS PARA AV PAULISTA - TOTAL R$ 68,40 - MOTORISTA CLAUDIO - CNPJ 17.895.646/0001-87',
    is_verified: true,
    audit_flags: [],
    audit_status: 'conforme',
    cnpj: '17.895.646/0001-87',
  },
  {
    id: 'exp-sp-04',
    trip_id: 'trip-sp-001',
    file_name: 'recibo_uber_retorno_congonhas.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-12',
    issue_time: '17:30',
    category: 'uber_taxi',
    merchant_name: 'Uber do Brasil Tecnologia Ltda.',
    amount: 74.9,
    ocr_raw_text:
      'UBER RECIBO - VIAGEM AV PAULISTA PARA CONGONHAS - TOTAL R$ 74,90 - CNPJ 17.895.646/0001-87',
    is_verified: true,
    audit_flags: [],
    audit_status: 'conforme',
    cnpj: '17.895.646/0001-87',
  },
  {
    id: 'exp-sp-05',
    trip_id: 'trip-sp-001',
    file_name: 'restaurante_sabor_mineiro_jantar.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-11',
    issue_time: '20:15',
    category: 'alimentacao',
    merchant_name: 'Restaurante Sabor Mineiro',
    amount: 392.0,
    ocr_raw_text:
      'RESTAURANTE SABOR MINEIRO LTDA - NFC-e - REFEICAO EXECUTIVA E BEBIDAS - VALOR TOTAL R$ 392,00 - CNPJ 12.987.654/0001-33',
    is_verified: true,
    audit_flags: [],
    audit_status: 'conforme',
    cnpj: '12.987.654/0001-33',
  },

  // --- VIAGEM 2: Curitiba (com pendências de transporte / aluguel) ---
  {
    id: 'exp-cwb-01',
    trip_id: 'trip-cwb-002',
    file_name: 'posto_ipiranga_abastecimento_cwb.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-18',
    issue_time: '10:20',
    category: 'combustivel',
    merchant_name: 'Posto Ipiranga Estrela do Sul',
    amount: 220.0,
    ocr_raw_text:
      'POSTO IPIRANGA - AUTO POSTO ESTRELA DO SUL LTDA - GASOLINA ADITIVADA 38.0L - TOTAL R$ 220,00 - CNPJ 33.123.456/0001-77',
    is_verified: true,
    audit_flags: ['falta_comprovante_aluguel'],
    audit_status: 'pendente',
    cnpj: '33.123.456/0001-77',
  },
  {
    id: 'exp-cwb-02',
    trip_id: 'trip-cwb-002',
    file_name: 'almoco_churrascaria_curitiba.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-18',
    issue_time: '13:00',
    category: 'alimentacao',
    merchant_name: 'Churrascaria Batel Grill',
    amount: 195.0,
    ocr_raw_text:
      'BATEL GRILL REFEICOES LTDA - NFC-e BUFFET COMPLETO - TOTAL R$ 195,00 - CNPJ 04.981.233/0001-44',
    is_verified: true,
    audit_flags: [],
    audit_status: 'conforme',
    cnpj: '04.981.233/0001-44',
  },
  {
    id: 'exp-cwb-03',
    trip_id: 'trip-cwb-002',
    file_name: 'estacionamento_central_cwb.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-19',
    issue_time: '16:40',
    category: 'estacionamento',
    merchant_name: 'Estacionamento Central Plaza',
    amount: 97.4,
    ocr_raw_text:
      'ESTACIONAMENTO CENTRAL PLAZA - DIARIA AVULSA - TOTAL R$ 97,40 - CNPJ 08.441.982/0001-12',
    is_verified: true,
    audit_flags: [],
    audit_status: 'conforme',
    cnpj: '08.441.982/0001-12',
  },

  // --- VIAGEM 3: Belo Horizonte (Em Triagem com recibo duplicado e recibos não verificados) ---
  {
    id: 'exp-triage-01',
    trip_id: 'trip-triage-003',
    file_name: 'passagem_voo_bh_ida.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-24',
    issue_time: '06:30',
    category: 'transporte',
    merchant_name: 'Gol Linhas Aéreas Inteligentes S.A.',
    amount: 920.0,
    ocr_raw_text:
      'GOL LINHAS AEREAS - VOO G3 1450 TRECHO GIG-CNF - VALOR TOTAL R$ 920,00 - CNPJ 07.575.651/0001-59',
    is_verified: false,
    audit_flags: ['falta_voo_retorno', 'voo_sem_transporte_aeroporto'],
    audit_status: 'pendente',
    cnpj: '07.575.651/0001-59',
  },
  {
    id: 'exp-triage-02',
    trip_id: 'trip-triage-003',
    file_name: 'recibo_posto_ipiranga_bh_duplicado.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-18', // MESMA DATA e VALOR do exp-cwb-01 (duplicata detectada)
    issue_time: '10:20',
    category: 'combustivel',
    merchant_name: 'Posto Ipiranga Estrela do Sul',
    amount: 220.0,
    ocr_raw_text:
      'POSTO IPIRANGA - AUTO POSTO ESTRELA DO SUL LTDA - GASOLINA ADITIVADA 38.0L - TOTAL R$ 220,00 - CNPJ 33.123.456/0001-77',
    is_verified: false,
    audit_flags: ['comprovante_duplicado'],
    audit_status: 'pendente',
    cnpj: '33.123.456/0001-77',
  },
  {
    id: 'exp-triage-03',
    trip_id: 'trip-triage-003',
    file_name: 'hotel_savassi_bh_estadia.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-26',
    issue_time: '12:00',
    category: 'hospedagem',
    merchant_name: 'Hotel Savassi Belo Horizonte',
    amount: 630.0,
    ocr_raw_text:
      'HOTEL SAVASSI BH - NFS-e - 2 DIARIAS STANDARD SINGLE - TOTAL R$ 630,00 - CNPJ 18.223.111/0001-90',
    is_verified: false,
    audit_flags: [],
    audit_status: 'pendente',
    cnpj: '18.223.111/0001-90',
  },
  {
    id: 'exp-triage-04',
    trip_id: 'trip-triage-003',
    file_name: 'restaurante_dona_lucinha_almoco.pdf',
    file_url: 'https://img.usecurling.com/p/800/600?q=abstract',
    issue_date: '2025-03-25',
    issue_time: '13:30',
    category: 'alimentacao',
    merchant_name: 'Restaurante Dona Lucinha BH',
    amount: 178.3,
    ocr_raw_text:
      'DONA LUCINHA REFEICOES MINEIRAS - NFC-e - ALMOCO COLETIVO - TOTAL R$ 178,30 - CNPJ 21.094.887/0001-52',
    is_verified: false,
    audit_flags: [],
    audit_status: 'pendente',
    cnpj: '21.094.887/0001-52',
  },
]

class LocalStorageService {
  constructor() {
    this.ensureInitialized()
  }

  private ensureInitialized() {
    if (typeof window === 'undefined') return
    const isInit = localStorage.getItem(STORAGE_KEYS.INITIALIZED)
    if (!isInit) {
      this.resetToSeed()
    }
  }

  public resetToSeed() {
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEYS.TRIPS, JSON.stringify(SEED_TRIPS))
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(SEED_EXPENSES))
    localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify([]))
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true')
  }

  // Trips CRUD
  public async listTrips(): Promise<Trip[]> {
    this.ensureInitialized()
    const raw = localStorage.getItem(STORAGE_KEYS.TRIPS)
    return raw ? JSON.parse(raw) : []
  }

  public async getTrip(id: string): Promise<Trip | null> {
    const trips = await this.listTrips()
    return trips.find((t) => t.id === id) || null
  }

  public async createTrip(
    tripData: Omit<Trip, 'id' | 'created_at' | 'total_amount' | 'user_id'> & {
      id?: string
      user_id?: string
      total_amount?: number
    },
  ): Promise<Trip> {
    const trips = await this.listTrips()
    const newTrip: Trip = {
      id: tripData.id || `trip-${Date.now()}`,
      user_id: tripData.user_id || 'user-default-01',
      destination: tripData.destination,
      start_date: tripData.start_date,
      end_date: tripData.end_date,
      transport_type: tripData.transport_type,
      status: tripData.status || 'em_triagem',
      total_amount: tripData.total_amount ?? 0,
      notes: tripData.notes || '',
      motivo: tripData.motivo || '',
      created_at: new Date().toISOString(),
    }
    trips.unshift(newTrip)
    localStorage.setItem(STORAGE_KEYS.TRIPS, JSON.stringify(trips))
    return newTrip
  }

  public async updateTrip(
    id: string,
    updates: Partial<Omit<Trip, 'id' | 'created_at'>>,
  ): Promise<Trip | null> {
    const trips = await this.listTrips()
    const index = trips.findIndex((t) => t.id === id)
    if (index === -1) return null

    trips[index] = { ...trips[index], ...updates }
    localStorage.setItem(STORAGE_KEYS.TRIPS, JSON.stringify(trips))
    return trips[index]
  }

  public async recalculateTripTotal(tripId: string): Promise<number> {
    const expenses = await this.listExpenses(tripId)
    const sum = expenses.reduce((acc, curr) => acc + (curr.amount || 0), 0)
    await this.updateTrip(tripId, { total_amount: Number(sum.toFixed(2)) })
    return Number(sum.toFixed(2))
  }

  // Expenses CRUD
  public async listExpenses(tripId?: string): Promise<Expense[]> {
    this.ensureInitialized()
    const raw = localStorage.getItem(STORAGE_KEYS.EXPENSES)
    const all: Expense[] = raw ? JSON.parse(raw) : []
    if (tripId) {
      return all.filter((e) => e.trip_id === tripId)
    }
    return all
  }

  public async getExpense(id: string): Promise<Expense | null> {
    const expenses = await this.listExpenses()
    return expenses.find((e) => e.id === id) || null
  }

  public async createExpense(expenseData: Omit<Expense, 'id'> & { id?: string }): Promise<Expense> {
    const expenses = await this.listExpenses()
    const newExp: Expense = {
      ...expenseData,
      id: expenseData.id || `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }
    expenses.unshift(newExp)
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses))
    if (newExp.trip_id) {
      await this.recalculateTripTotal(newExp.trip_id)
    }
    return newExp
  }

  public async updateExpense(
    id: string,
    updates: Partial<Omit<Expense, 'id'>>,
  ): Promise<Expense | null> {
    const expenses = await this.listExpenses()
    const index = expenses.findIndex((e) => e.id === id)
    if (index === -1) return null

    const oldTripId = expenses[index].trip_id
    expenses[index] = { ...expenses[index], ...updates }
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses))

    if (oldTripId) {
      await this.recalculateTripTotal(oldTripId)
    }
    if (expenses[index].trip_id && expenses[index].trip_id !== oldTripId) {
      await this.recalculateTripTotal(expenses[index].trip_id)
    }

    return expenses[index]
  }

  public async deleteExpense(id: string): Promise<boolean> {
    const expenses = await this.listExpenses()
    const target = expenses.find((e) => e.id === id)
    if (!target) return false

    const filtered = expenses.filter((e) => e.id !== id)
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(filtered))
    if (target.trip_id) {
      await this.recalculateTripTotal(target.trip_id)
    }
    return true
  }

  // Duplicate Check: same issue_date + exact amount + merchant_name/CNPJ
  public async findDuplicate(expense: {
    issue_date: string
    amount: number
    merchant_name: string
    cnpj?: string
    excludeId?: string
  }): Promise<Expense | null> {
    const all = await this.listExpenses()
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()

    const targetMerchant = normalize(expense.merchant_name)
    const targetCnpj = expense.cnpj ? expense.cnpj.replace(/\D/g, '') : null

    for (const item of all) {
      if (expense.excludeId && item.id === expense.excludeId) continue

      const sameDate = item.issue_date === expense.issue_date
      const sameAmount = Math.abs(item.amount - expense.amount) < 0.01

      if (sameDate && sameAmount) {
        if (targetCnpj && item.cnpj) {
          const itemCnpj = item.cnpj.replace(/\D/g, '')
          if (itemCnpj === targetCnpj) return item
        }
        const itemMerchant = normalize(item.merchant_name)
        if (itemMerchant.includes(targetMerchant) || targetMerchant.includes(itemMerchant)) {
          return item
        }
      }
    }
    return null
  }

  // Audit Rules Engine
  public async evaluateTripAudit(tripId: string): Promise<AuditEvaluationRule[]> {
    const trip = await this.getTrip(tripId)
    if (!trip) return []

    const expenses = await this.listExpenses(tripId)
    const logs = await this.listAuditLogs(tripId)

    const rules: AuditEvaluationRule[] = []

    // Regra 1: Viagem Aérea sem transporte terrestre (uber/táxi/estacionamento) nas datas
    if (trip.transport_type === 'aéreo') {
      const groundExpenses = expenses.filter((e) =>
        ['uber_taxi', 'estacionamento', 'transporte'].includes(e.category),
      )
      const existingLog = logs.find((l) => l.rule_key === 'voo_sem_transporte_aeroporto')

      if (groundExpenses.length === 0) {
        rules.push({
          key: 'voo_sem_transporte_aeroporto',
          title: 'Transporte Terrestre para Aeroporto',
          message:
            'Viagem aérea detectada — não há comprovante de transporte terrestre (Uber/Táxi/Estacionamento) registrado no período. Adicione o comprovante ou justifique.',
          severity: 'warning',
          status: existingLog?.status === 'justified' ? 'justified' : 'warning',
          justification: existingLog?.message,
        })
      } else {
        rules.push({
          key: 'voo_sem_transporte_aeroporto',
          title: 'Transporte Terrestre para Aeroporto',
          message: `${groundExpenses.length} comprovante(s) de transporte terrestre/Uber identificado(s) com sucesso.`,
          severity: 'pass',
          status: 'pass',
        })
      }
    }

    // Regra 2: Viagem >= 2 dias sem comprovante de hospedagem
    const tripDays = calculateDaysBetween(trip.start_date, trip.end_date)
    if (tripDays >= 2) {
      const lodgingExpenses = expenses.filter((e) => e.category === 'hospedagem')
      const existingLog = logs.find((l) => l.rule_key === 'sem_comprovante_hotel')

      if (lodgingExpenses.length === 0) {
        rules.push({
          key: 'sem_comprovante_hotel',
          title: 'Comprovante de Hospedagem',
          message: `Viagem com duração de ${tripDays} dias — não há despesa de hospedagem registrada. Adicione o comprovante de hotel/pousada ou justifique.`,
          severity: 'warning',
          status: existingLog?.status === 'justified' ? 'justified' : 'warning',
          justification: existingLog?.message,
        })
      } else {
        rules.push({
          key: 'sem_comprovante_hotel',
          title: 'Comprovante de Hospedagem',
          message: `Comprovante de hospedagem anexado (${lodgingExpenses.length} comprovante(s) registrado(s)).`,
          severity: 'pass',
          status: 'pass',
        })
      }
    }

    // Regra 3: Consistência de despesas com carro alugado
    if (trip.transport_type === 'carro_alugado') {
      const hasFuel = expenses.some((e) => e.category === 'combustivel')
      const hasRentalInvoice = expenses.some(
        (e) =>
          e.category === 'transporte' &&
          (e.merchant_name.toLowerCase().includes('localiza') ||
            e.merchant_name.toLowerCase().includes('movida') ||
            e.merchant_name.toLowerCase().includes('aluguel') ||
            e.merchant_name.toLowerCase().includes('rent')),
      )
      const existingLog = logs.find((l) => l.rule_key === 'falta_comprovante_aluguel')

      if (hasFuel && !hasRentalInvoice) {
        rules.push({
          key: 'falta_comprovante_aluguel',
          title: 'Fatura de Aluguel de Veículo',
          message:
            'Foram anexados comprovantes de combustível/estacionamento, mas não há fatura da locadora de veículos vinculada. Adicione o contrato/recibo ou justifique.',
          severity: 'warning',
          status: existingLog?.status === 'justified' ? 'justified' : 'warning',
          justification: existingLog?.message,
        })
      } else if (hasRentalInvoice) {
        rules.push({
          key: 'falta_comprovante_aluguel',
          title: 'Fatura de Aluguel de Veículo',
          message: 'Comprovante de locação de veículo identificado.',
          severity: 'pass',
          status: 'pass',
        })
      }
    }

    // Regra 4: Detecção de duplicidade interna na viagem
    const duplicates = expenses.filter(
      (e) => e.audit_flags && e.audit_flags.includes('comprovante_duplicado'),
    )
    if (duplicates.length > 0) {
      rules.push({
        key: 'comprovante_duplicado',
        title: 'Comprovante(s) Marcado(s) como Duplicata',
        message: `${duplicates.length} comprovante(s) possui(em) alerta de duplicidade. Revise e descarte ou justifique a inclusão.`,
        severity: 'warning',
        status: 'warning',
      })
    } else {
      rules.push({
        key: 'comprovante_duplicado',
        title: 'Verificação Anti-Duplicidade',
        message: 'Nenhum comprovante duplicado detectado para esta viagem.',
        severity: 'pass',
        status: 'pass',
      })
    }

    // Regra 5: Alimentação para viagens de dia todo
    const foodExpenses = expenses.filter((e) => e.category === 'alimentacao')
    if (foodExpenses.length === 0) {
      const existingLog = logs.find((l) => l.rule_key === 'sem_alimentacao')
      rules.push({
        key: 'sem_alimentacao',
        title: 'Despesas de Alimentação',
        message:
          'Nenhum comprovante de refeição/alimentação registrado no período. Caso tenha sido fornecido pela empresa/evento, favor justificar.',
        severity: 'info',
        status: existingLog?.status === 'justified' ? 'justified' : 'warning',
        justification: existingLog?.message,
      })
    } else {
      rules.push({
        key: 'sem_alimentacao',
        title: 'Despesas de Alimentação',
        message: `${foodExpenses.length} comprovante(s) de refeição identificado(s).`,
        severity: 'pass',
        status: 'pass',
      })
    }

    return rules
  }

  // Audit Logs CRUD
  public async listAuditLogs(tripId: string): Promise<AuditRulesLog[]> {
    this.ensureInitialized()
    const raw = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS)
    const all: AuditRulesLog[] = raw ? JSON.parse(raw) : []
    return all.filter((l) => l.trip_id === tripId)
  }

  public async saveAuditLog(log: {
    trip_id: string
    rule_key: string
    status: 'pass' | 'warning' | 'justified'
    message: string
  }): Promise<AuditRulesLog> {
    const raw = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS)
    const all: AuditRulesLog[] = raw ? JSON.parse(raw) : []

    const index = all.findIndex((l) => l.trip_id === log.trip_id && l.rule_key === log.rule_key)

    const updatedLog: AuditRulesLog = {
      id: index >= 0 ? all[index].id : `audit-log-${Date.now()}`,
      trip_id: log.trip_id,
      rule_key: log.rule_key,
      status: log.status,
      message: log.message,
    }

    if (index >= 0) {
      all[index] = updatedLog
    } else {
      all.push(updatedLog)
    }

    localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(all))
    return updatedLog
  }

  // Metrics helper for Dashboard
  public async getDashboardMetrics() {
    const trips = await this.listTrips()
    const expenses = await this.listExpenses()

    // Total a reembolsar: soma de todas as viagens em aberto (em_triagem, com_pendencias, auditada)
    const openTrips = trips.filter((t) =>
      ['em_triagem', 'com_pendencias', 'auditada'].includes(t.status),
    )
    const totalToRefund = openTrips.reduce((acc, t) => acc + (t.total_amount || 0), 0)

    // Viagens em aberto
    const openTripsCount = openTrips.length

    // Alertas de auditoria ativos
    let activeAlertsCount = 0
    for (const trip of openTrips) {
      const evaluation = await this.evaluateTripAudit(trip.id)
      const warnings = evaluation.filter((r) => r.status === 'warning')
      activeAlertsCount += warnings.length
    }

    // Total reembolsado no mês atual (baseado em status reembolsada ou fechada)
    const currentMonth = new Date().getMonth()
    const currentYear = new Date().getFullYear()

    const reimbursedTrips = trips.filter((t) => {
      if (t.status !== 'reembolsada' && t.status !== 'fechada') return false
      // Regra da virada do mês: data de início determina o mês financeiro
      const tripDate = new Date(t.start_date + 'T00:00:00')
      return tripDate.getMonth() === currentMonth && tripDate.getFullYear() === currentYear
    })

    const totalReimbursedThisMonth = reimbursedTrips.reduce(
      (acc, t) => acc + (t.total_amount || 0),
      0,
    )

    return {
      totalToRefund,
      openTripsCount,
      activeAlertsCount,
      totalReimbursedThisMonth,
    }
  }
}

function calculateDaysBetween(start: string, end: string): number {
  if (!start || !end) return 1
  const d1 = new Date(start + 'T00:00:00')
  const d2 = new Date(end + 'T00:00:00')
  const diffTime = Math.abs(d2.getTime() - d1.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
  return diffDays || 1
}

export const storageService = new LocalStorageService()
