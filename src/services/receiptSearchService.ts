import { supabase } from '@/lib/supabase/client'
import { Expense, Trip } from '@/types/database'
import { normalizeSearchText } from '@/lib/formatters'
import { processRealReceiptOcr, ProcessedReceiptOcr } from './ocrService'

export interface ExpenseSearchResult {
  expense: Expense
  trip: Trip | null
  matchType?: 'exact_duplicate' | 'close_match' | 'text_match'
}

export interface DuplicateCheckResult {
  hasIdentical: boolean
  identicalMatch: ExpenseSearchResult | null
  nearMatches: ExpenseSearchResult[]
  ocrData?: ProcessedReceiptOcr
  searchedCriteria: {
    amount: number | null
    date: string | null
    merchant?: string | null
  }
}

class ReceiptSearchService {
  private get client(): any {
    return supabase as any
  }

  /**
   * Busca todas as despesas acessíveis ao usuário, com as viagens relacionadas em join
   */
  public async listAllExpensesWithTrips(): Promise<ExpenseSearchResult[]> {
    try {
      const { data, error } = await this.client
        .from('expenses')
        .select('*, trips(*)')
        .order('issue_date', { ascending: false })

      if (error) {
        console.warn('Erro ao consultar despesas com trips join:', error)
        return this.fallbackListWithTrips()
      }

      return (data || []).map((row: any) => ({
        expense: {
          id: row.id,
          trip_id: row.trip_id,
          file_url: row.file_url || '',
          file_name: row.file_name,
          issue_date: row.issue_date,
          issue_time: row.issue_time,
          category: row.category,
          merchant_name: row.merchant_name,
          amount: Number(row.amount || 0),
          ocr_raw_text: row.ocr_raw_text,
          is_verified: row.is_verified,
          audit_flags: row.audit_flags || [],
          audit_status: row.audit_status,
          audit_justification: row.audit_justification,
          cnpj: row.cnpj,
          created_at: row.created_at,
          audit_manual_checked: row.audit_manual_checked,
          audit_manual_checked_at: row.audit_manual_checked_at,
          audit_manual_checked_by_id: row.audit_manual_checked_by_id,
          audit_manual_checked_by_name: row.audit_manual_checked_by_name,
        },
        trip: row.trips || null,
      }))
    } catch (err) {
      console.error('Falha geral em listAllExpensesWithTrips:', err)
      return this.fallbackListWithTrips()
    }
  }

  private async fallbackListWithTrips(): Promise<ExpenseSearchResult[]> {
    try {
      const [{ data: expenses }, { data: trips }] = await Promise.all([
        this.client.from('expenses').select('*').order('issue_date', { ascending: false }),
        this.client.from('trips').select('*'),
      ])

      const tripMap = new Map<string, Trip>()
      ;(trips || []).forEach((t: Trip) => tripMap.set(t.id, t))

      return (expenses || []).map((exp: any) => ({
        expense: {
          ...exp,
          amount: Number(exp.amount || 0),
        },
        trip: exp.trip_id ? tripMap.get(exp.trip_id) || null : null,
      }))
    } catch (err) {
      console.error('Falha no fallback de busca de despesas:', err)
      return []
    }
  }

  /**
   * Busca client-side por múltiplos parâmetros de texto:
   * Estabelecimento, Categoria, Valor exato ou aproximado, Data, CNPJ ou Destino da viagem
   */
  public searchByText(items: ExpenseSearchResult[], rawQuery: string): ExpenseSearchResult[] {
    const term = normalizeSearchText(rawQuery)
    if (!term) return []

    // Verificar se o usuário digitou um número monetário (ex: 150, 150.00, 150,00)
    const cleanNumericString = term.replace('r$', '').replace(/\s/g, '').replace(',', '.')
    const parsedAmount = parseFloat(cleanNumericString)
    const isNumericSearch =
      !isNaN(parsedAmount) &&
      cleanNumericString.length > 0 &&
      /^\d+(\.\d+)?$/.test(cleanNumericString)

    return items.filter(({ expense, trip }) => {
      // 1. Busca por valor exato se for numérico
      if (isNumericSearch) {
        if (Math.abs(expense.amount - parsedAmount) < 0.01) {
          return true
        }
      }

      // 2. Busca em texto nos campos da despesa
      const merchant = normalizeSearchText(expense.merchant_name)
      const category = normalizeSearchText(expense.category)
      const date = expense.issue_date || ''
      const amountStr = String(expense.amount || '')
      const cnpj = (expense.cnpj || '').replace(/\D/g, '')
      const notes = normalizeSearchText(expense.ocr_raw_text)

      // Viagem associada
      const destination = normalizeSearchText(trip?.destination)
      const motivo = normalizeSearchText(trip?.motivo)

      // Data formatada pt-BR (dd/mm/aaaa)
      let brDate = ''
      if (date && date.includes('-')) {
        const [y, m, d] = date.split('-')
        brDate = `${d}/${m}/${y}`
      }

      return (
        merchant.includes(term) ||
        category.includes(term) ||
        date.includes(term) ||
        brDate.includes(term) ||
        amountStr.includes(cleanNumericString) ||
        (cnpj && cnpj.includes(term.replace(/\D/g, ''))) ||
        destination.includes(term) ||
        motivo.includes(term) ||
        notes.includes(term)
      )
    })
  }

  /**
   * Verifica se já existe um recibo cadastrado idêntico ou muito próximo:
   * Idêntico: MESMA data E MESMO valor (com tolerância de centavos <= 0.01)
   * Próximo: MESMO valor E data dentro de +- 2 dias
   */
  public verifyDuplicate(
    items: ExpenseSearchResult[],
    criteria: {
      amount: number | null
      date: string | null
      merchant?: string | null
      excludeExpenseId?: string
    },
  ): DuplicateCheckResult {
    const { amount, date, excludeExpenseId } = criteria

    const result: DuplicateCheckResult = {
      hasIdentical: false,
      identicalMatch: null,
      nearMatches: [],
      searchedCriteria: {
        amount,
        date,
        merchant: criteria.merchant,
      },
    }

    if (amount === null || !date) {
      return result
    }

    const targetDate = new Date(`${date}T00:00:00`)
    const isValidTargetDate = !isNaN(targetDate.getTime())

    for (const item of items) {
      if (excludeExpenseId && item.expense.id === excludeExpenseId) continue

      const itemAmount = Number(item.expense.amount || 0)
      const isSameAmount = Math.abs(itemAmount - amount) < 0.01

      if (!isSameAmount) {
        continue
      }

      // Se tem mesmo valor, checar data
      if (item.expense.issue_date === date) {
        // MESMA data E mesmo valor -> IDÊNTICO!
        if (!result.hasIdentical) {
          result.hasIdentical = true
          result.identicalMatch = { ...item, matchType: 'exact_duplicate' }
        } else {
          result.nearMatches.push({ ...item, matchType: 'exact_duplicate' })
        }
      } else if (isValidTargetDate && item.expense.issue_date) {
        // Checar proximidade de dias (+- 2 dias) com mesmo valor
        const itemDate = new Date(`${item.expense.issue_date}T00:00:00`)
        if (!isNaN(itemDate.getTime())) {
          const diffDays = Math.abs(
            (targetDate.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24),
          )
          if (diffDays <= 2) {
            result.nearMatches.push({ ...item, matchType: 'close_match' })
          }
        }
      }
    }

    return result
  }

  /**
   * Executa OCR no comprovante (imagem ou PDF) e verifica duplicidade automaticamente
   */
  public async analyzeReceiptFileForDuplicates(
    file: File,
    allExpenses: ExpenseSearchResult[],
    onProgress?: (progress: number, status: string) => void,
  ): Promise<DuplicateCheckResult> {
    const ocrResult = await processRealReceiptOcr(file, onProgress)

    const check = this.verifyDuplicate(allExpenses, {
      amount: ocrResult.amount,
      date: ocrResult.issue_date,
      merchant: ocrResult.merchant_name,
    })

    return {
      ...check,
      ocrData: ocrResult,
    }
  }
}

export const receiptSearchService = new ReceiptSearchService()
