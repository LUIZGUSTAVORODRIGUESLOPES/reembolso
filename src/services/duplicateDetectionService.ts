import { Expense } from '@/types/database'

/**
 * Normaliza valores monetários para número de ponto flutuante com 2 casas.
 * Suporta formatos numéricos e strings como "17,54", "17.54", "R$ 17,54", etc.
 */
export function parseNormalizedAmount(val: number | string | null | undefined): number {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : Math.round(val * 100) / 100
  }
  const str = String(val).trim()
  if (!str) return 0

  // Remove símbolos monetários, espaços e caracteres invisíveis
  const cleaned = str
    .replace(/[R$\s\u00a0]/gi, '')
    // Se tiver formato brasileiro "1.234,56", remove pontos de milhar e troca vírgula por ponto
    .replace(/\.(?=\d{3}(?:[.,]|$))/g, '')
    .replace(',', '.')

  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100
}

/**
 * Normaliza datas para o formato de dia 'YYYY-MM-DD'.
 * Ignora hora/minuto/segundo e fuso horário.
 * Suporta 'YYYY-MM-DD', ISO 8601 com 'T', e 'DD/MM/YYYY'.
 */
export function normalizeDateToDay(val: string | null | undefined): string {
  if (!val) return ''
  const trimmed = val.trim()
  if (!trimmed) return ''

  // Formato DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(trimmed)) {
    const parts = trimmed.split('/')
    const day = parts[0].padStart(2, '0')
    const month = parts[1].padStart(2, '0')
    const year = parts[2].slice(0, 4)
    return `${year}-${month}-${day}`
  }

  // Formato ISO 'YYYY-MM-DD...'
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10)
  }

  // Fallback via Date parsing
  try {
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
  } catch {
    // ignore
  }

  return trimmed
}

/**
 * Normaliza o nome do fornecedor/estabelecimento:
 * - minúsculas
 * - remoção de acentuação gráfica (NFD)
 * - remoção de caracteres não-alfanuméricos e pontuação
 * - compressão de múltiplos espaços
 */
export function normalizeMerchant(val: string | null | undefined): string {
  if (!val) return ''
  return val
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Avalia se dois fornecedores são equivalentes:
 * 1. Iguais após normalização
 * 2. Um contém o outro (ex: "uber" vs "uber do brasil tecnologia ltda")
 * 3. Mesma palavra-chave principal (ex: se começar com palavra com 3+ letras)
 * 4. Nomes genéricos manuais ("comprovante manual", "despesa") são considerados equivalentes
 */
export function areMerchantsMatching(m1: string, m2: string): boolean {
  const n1 = normalizeMerchant(m1)
  const n2 = normalizeMerchant(m2)

  // Se ambos estiverem vazios ou ambos forem genéricos de inserção manual
  const genericKeywords = [
    'comprovante manual',
    'recibo manual',
    'despesa',
    'comprovante',
    'recibo',
    '',
  ]
  const isG1 = genericKeywords.includes(n1)
  const isG2 = genericKeywords.includes(n2)
  if (isG1 && isG2) return true

  if (!n1 || !n2) return false
  if (n1 === n2) return true

  // Substring mútua (se um nome tem 3+ letras)
  if ((n1.length >= 3 && n2.includes(n1)) || (n2.length >= 3 && n1.includes(n2))) {
    return true
  }

  // Palavras genéricas / corporativas a serem ignoradas na comparação de tokens:
  // linhas, aereas, auto, posto, restaurante, lanchonete, hotel, pousada, estacionamento, locadora, rent, car, ltda, sa, me, epp, comercio, brasil
  const stopWords = new Set([
    'linhas',
    'aereas',
    'auto',
    'posto',
    'restaurante',
    'lanchonete',
    'hotel',
    'pousada',
    'estacionamento',
    'locadora',
    'rent',
    'car',
    'ltda',
    'sa',
    's/a',
    'me',
    'epp',
    'comercio',
    'brasil',
    'brazil',
    'eireli',
    'tecnologia',
    'servicos',
    'pagamentos',
    'varejista',
    'trip',
    'rides',
    'help',
  ])

  // Comparação de tokens significativos (ex: "Azul" vs "Azul Linhas Aéreas", "Unidas" vs "Unidas Locadora")
  const tokens1 = n1.split(' ').filter((t) => t.length >= 3 && !stopWords.has(t))
  const tokens2 = n2.split(' ').filter((t) => t.length >= 3 && !stopWords.has(t))

  // Se ambos tiverem tokens significativos e qualquer um bater
  for (const t1 of tokens1) {
    if (tokens2.includes(t1)) {
      return true
    }
  }

  return false
}

export interface DuplicateDetectionCriteria {
  amount: number | string
  issue_date?: string | null
  merchant_name?: string | null
  trip_id?: string | null
  cnpj?: string | null
  category?: import('@/types/database').ExpenseCategory | string | null
  excludeExpenseId?: string
}

export interface DuplicateMatchDetail {
  expense: Expense
  matchedRule:
    | 'rule1_exact_amount_30d'
    | 'rule2_close_amount_category'
    | 'rule3_merchant_category_close'
  priority: number
  diffDays: number | null
  diffAmount: number
  reason: string
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean
  matchingExpense: Expense | null
  matchingExpenses: Expense[]
  reason?: string
  matchDetails?: DuplicateMatchDetail[]
}

/**
 * Calcula a diferença absoluta em dias entre duas datas (formato YYYY-MM-DD).
 * Retorna null se alguma das datas for vazia ou inválida.
 */
export function calculateDateDiffDays(d1: string, d2: string): number | null {
  if (!d1 || !d2) return null
  const t1 = new Date(`${d1}T12:00:00Z`).getTime()
  const t2 = new Date(`${d2}T12:00:00Z`).getTime()
  if (isNaN(t1) || isNaN(t2)) return null
  return Math.round(Math.abs((t1 - t2) / (1000 * 60 * 60 * 24)))
}

function formatBRLValue(val: number): string {
  return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateBRFromIso(iso: string): string {
  if (!iso) return 'data não identificada'
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const [y, m, d] = iso.slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  return iso
}

/**
 * Função utilitária unificada para detecção de duplicidade.
 * O fornecedor NUNCA deve ser pré-requisito para bloquear as Regras 1 e 2.
 * Uma despesa é marcada como suspeita se atender a QUALQUER UMA destas condições:
 *
 * Regra 1 — Mesmo valor em janela de 30 dias (independente de fornecedor/categoria):
 *   - Math.abs(expAmount - candidateAmount) < 0.01
 *   - diffDays <= 30 OU uma das datas vazia
 *   - Motivo: "Mesmo valor (R$ X) encontrado em lançamento de DD/MM/AAAA (diferença de N dias)."
 *
 * Regra 2 — Valor muito próximo na mesma categoria (suspeita de erro de OCR no valor):
 *   - Mesma categoria (candidate.category && exp.category === candidate.category)
 *   - diffDays <= 7 OU uma das datas vazia
 *   - a) Mesmos centavos com Math.abs(expAmount - candidateAmount) <= 20.00; OU
 *   - b) Math.abs(expAmount - candidateAmount) <= 5.00 (ou <= 5% do valor, limitado a R$ 15.00) quando diffDays <= 1
 *   - Motivo: "Valor muito próximo (R$ X vs R$ Y) para a mesma categoria (possível divergência de leitura OCR)."
 *
 * Regra 3 — Mesmo tipo + mesmo fornecedor com valor próximo:
 *   - Mesma categoria E (areMerchantsMatching OU CNPJ igual)
 *   - diffDays <= 30 (ou uma das datas vazia)
 *   - Diferença de valor de até 10% ou R$ 15,00
 *   - Motivo: "Mesmo fornecedor/referência e categoria com valor próximo (R$ X) em DD/MM/AAAA."
 *
 * Ordenação priorizando:
 *   1º mesmo valor + mesmo dia (priority = 1)
 *   2º mesmo valor + fornecedor compatível (priority = 2)
 *   3º menor diferença de dias/valor (priority = 3)
 */
export function detectDuplicateExpense(
  candidate: DuplicateDetectionCriteria,
  tripExpenses: Expense[],
): DuplicateDetectionResult {
  const candidateAmount = parseNormalizedAmount(candidate.amount)
  const candidateDay = normalizeDateToDay(candidate.issue_date)
  const candidateCnpj = candidate.cnpj ? candidate.cnpj.replace(/\D/g, '') : null
  const candidateCategory = candidate.category ? String(candidate.category).trim() : null
  const candidateMerchant = candidate.merchant_name || ''

  // Se o valor do candidato for <= 0, não é possível avaliar duplicidade
  if (candidateAmount <= 0) {
    return {
      isDuplicate: false,
      matchingExpense: null,
      matchingExpenses: [],
    }
  }

  const matchDetails: DuplicateMatchDetail[] = []

  for (const exp of tripExpenses) {
    // Ignora a própria despesa se estiver editando
    if (candidate.excludeExpenseId && exp.id === candidate.excludeExpenseId) {
      continue
    }

    // Se o escopo da trip_id for fornecido e a despesa tiver trip_id diferente, ignora
    if (candidate.trip_id && exp.trip_id && exp.trip_id !== candidate.trip_id) {
      continue
    }

    const expAmount = parseNormalizedAmount(exp.amount)
    if (expAmount <= 0) continue

    const expDay = normalizeDateToDay(exp.issue_date)
    const diffDays = calculateDateDiffDays(candidateDay, expDay)
    const isDateWithin30 = diffDays === null || diffDays <= 30
    const diffAmount = Math.abs(expAmount - candidateAmount)
    const isSameAmount = diffAmount < 0.01

    // Comparações auxiliares de fornecedor / CNPJ
    let cnpjMatched = false
    if (candidateCnpj && exp.cnpj) {
      const expCnpj = exp.cnpj.replace(/\D/g, '')
      if (candidateCnpj === expCnpj && expCnpj.length >= 8) {
        cnpjMatched = true
      }
    }
    const merchantMatched = Boolean(
      (candidateMerchant &&
        exp.merchant_name &&
        areMerchantsMatching(candidateMerchant, exp.merchant_name)) ||
      cnpjMatched,
    )

    const isSameCategory = Boolean(
      candidateCategory && exp.category && candidateCategory === exp.category,
    )

    let matched = false
    let matchedRule: DuplicateMatchDetail['matchedRule'] = 'rule1_exact_amount_30d'
    let reasonText = ''

    // REGRA 1: Mesmo valor em janela de 30 dias (independente de fornecedor/categoria)
    if (isSameAmount && isDateWithin30) {
      matched = true
      matchedRule = 'rule1_exact_amount_30d'
      const dateText = formatDateBRFromIso(expDay)
      const diffText =
        diffDays !== null ? ` (diferença de ${diffDays} dia${diffDays === 1 ? '' : 's'})` : ''
      reasonText = `Mesmo valor (R$ ${formatBRLValue(candidateAmount)}) encontrado em lançamento de ${dateText}${diffText}.`
    }

    // REGRA 2: Valor muito próximo na mesma categoria (suspeita de erro de OCR no valor)
    if (!matched && isSameCategory) {
      const isDateWithin7 = diffDays === null || diffDays <= 7
      if (isDateWithin7) {
        // a) Mesmos centavos com diferença de até R$ 20,00
        const expCents = Math.round((expAmount % 1) * 100)
        const candCents = Math.round((candidateAmount % 1) * 100)
        const sameCentsAndWithin20 = expCents === candCents && diffAmount <= 20.0 + 1e-4

        // b) Diferença absoluta <= R$ 5,00 (ou <= 5% do valor, limitado a R$ 15,00) quando na mesma data (diffDays <= 1)
        const isSameOrNearDay = diffDays === null || diffDays <= 1
        const maxAllowedNearDay = Math.min(15.0, Math.max(5.0, candidateAmount * 0.05))
        const closeValueSameDay = isSameOrNearDay && diffAmount <= maxAllowedNearDay + 1e-4

        if (sameCentsAndWithin20 || closeValueSameDay) {
          matched = true
          matchedRule = 'rule2_close_amount_category'
          reasonText = `Valor muito próximo (R$ ${formatBRLValue(candidateAmount)} vs R$ ${formatBRLValue(expAmount)}) para a mesma categoria (possível divergência de leitura OCR).`
        }
      }
    }

    // REGRA 3: Mesmo tipo + mesmo fornecedor (referência parcial) com valor próximo
    if (!matched && isSameCategory && merchantMatched && isDateWithin30) {
      const maxAllowedDiff = Math.max(15.0, candidateAmount * 0.1)
      if (diffAmount <= maxAllowedDiff + 1e-4) {
        matched = true
        matchedRule = 'rule3_merchant_category_close'
        const dateText = formatDateBRFromIso(expDay)
        reasonText = `Mesmo fornecedor/referência e categoria com valor próximo (R$ ${formatBRLValue(expAmount)}) em ${dateText}.`
      }
    }

    if (matched) {
      // Prioridade:
      // 1º: mesmo valor + mesmo dia
      // 2º: mesmo valor + fornecedor compatível
      // 3º: menor diferença de dias/valor
      let priority = 3
      if (isSameAmount && diffDays === 0) {
        priority = 1
      } else if (isSameAmount && merchantMatched) {
        priority = 2
      } else {
        priority = 3
      }

      matchDetails.push({
        expense: exp,
        matchedRule,
        priority,
        diffDays,
        diffAmount,
        reason: reasonText,
      })
    }
  }

  // Ordenar priorizando:
  // 1º priority menor (1 antes de 2 antes de 3)
  // 2º menor diferença de dias (dias null tratados com peso intermediário, ex: 15)
  // 3º menor diferença de valor
  matchDetails.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority
    }
    const daysA = a.diffDays === null ? 15 : a.diffDays
    const daysB = b.diffDays === null ? 15 : b.diffDays
    if (daysA !== daysB) {
      return daysA - daysB
    }
    return a.diffAmount - b.diffAmount
  })

  const matchingExpenses = matchDetails.map((m) => m.expense)
  const isDuplicate = matchDetails.length > 0
  const topMatch = matchDetails[0] || null

  return {
    isDuplicate,
    matchingExpense: topMatch?.expense || null,
    matchingExpenses,
    reason: topMatch?.reason,
    matchDetails,
  }
}
