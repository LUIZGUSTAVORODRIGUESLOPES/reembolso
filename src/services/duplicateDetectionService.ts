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

  // Stop words corporativas / sufixos comuns que não caracterizam a marca principal isoladamente
  const stopWords = new Set([
    'ltda',
    'sa',
    's/a',
    'brasil',
    'brazil',
    'tecnologia',
    'servicos',
    'pagamentos',
    'comercio',
    'varejista',
    'me',
    'epp',
    'eireli',
    'trip',
    'rides',
    'help',
  ])

  // Comparação de tokens significativos (ex: "Uber" vs "Uber * Trip" ou "Uber do Brasil Tecnologia Ltda")
  const tokens1 = n1.split(' ').filter((t) => t.length >= 3 && !stopWords.has(t))
  const tokens2 = n2.split(' ').filter((t) => t.length >= 3 && !stopWords.has(t))

  // Se ambos tiverem tokens significativos e qualquer um bater (ex: "uber", "latam", "gol", "ipiranga")
  for (const t1 of tokens1) {
    if (tokens2.includes(t1)) {
      return true
    }
  }

  return false
}

export interface DuplicateDetectionCriteria {
  amount: number | string
  issue_date: string
  merchant_name: string
  trip_id?: string | null
  cnpj?: string | null
  excludeExpenseId?: string
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean
  matchingExpense: Expense | null
  matchingExpenses: Expense[]
  reason?: string
}

/**
 * Função utilitária ÚNICA para detecção de duplicidade dentro do escopo da viagem (mesma trip_id).
 * Regra: mesmo fornecedor normalizado + mesmo valor numérico (diferença < R$ 0.01) + mesmo dia.
 */
export function detectDuplicateExpense(
  candidate: DuplicateDetectionCriteria,
  tripExpenses: Expense[],
): DuplicateDetectionResult {
  const candidateAmount = parseNormalizedAmount(candidate.amount)
  const candidateDay = normalizeDateToDay(candidate.issue_date)
  const candidateCnpj = candidate.cnpj ? candidate.cnpj.replace(/\D/g, '') : null

  if (candidateAmount <= 0 || !candidateDay) {
    return {
      isDuplicate: false,
      matchingExpense: null,
      matchingExpenses: [],
    }
  }

  const matches: Expense[] = []

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
    const isSameAmount = Math.abs(expAmount - candidateAmount) < 0.01
    if (!isSameAmount) continue

    const expDay = normalizeDateToDay(exp.issue_date)
    const isSameDay = expDay === candidateDay
    if (!isSameDay) continue

    // Verifica CNPJ se ambos tiverem
    let cnpjMatched = false
    if (candidateCnpj && exp.cnpj) {
      const expCnpj = exp.cnpj.replace(/\D/g, '')
      if (candidateCnpj === expCnpj && expCnpj.length >= 8) {
        cnpjMatched = true
      }
    }

    // Verifica fornecedor normalizado
    const merchantMatched = areMerchantsMatching(candidate.merchant_name, exp.merchant_name)

    if (cnpjMatched || merchantMatched) {
      matches.push(exp)
    }
  }

  const isDuplicate = matches.length > 0
  return {
    isDuplicate,
    matchingExpense: matches[0] || null,
    matchingExpenses: matches,
    reason: isDuplicate
      ? `Encontrado(s) ${matches.length} lançamento(s) com o mesmo fornecedor, valor idêntico e mesma data nesta viagem.`
      : undefined,
  }
}
