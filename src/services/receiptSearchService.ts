import { supabase } from '@/lib/supabase/client'
import { Expense, Trip } from '@/types/database'
import { normalizeSearchText } from '@/lib/formatters'
import { processRealReceiptOcr, ProcessedReceiptOcr } from './ocrService'
import {
  parseNormalizedAmount,
  normalizeDateToDay,
  detectDuplicateExpense,
} from './duplicateDetectionService'

export interface ExpenseSearchResult {
  expense: Expense
  trip: Trip | null
  matchType?: 'exact_duplicate' | 'close_match' | 'text_match'
  matchReason?: string
}

export interface DuplicateCheckResult {
  hasIdentical: boolean
  identicalMatch: ExpenseSearchResult | null
  nearMatches: ExpenseSearchResult[]
  reason?: string
  ocrData?: ProcessedReceiptOcr
  searchedCriteria: {
    amount: number | null
    date: string | null
    merchant?: string | null
    category?: string | null
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
   * Verifica duplicidade delegando para o motor unificado detectDuplicateExpense:
   * Funciona mesmo quando a data for nula/não identificada pelo OCR,
   * cobrindo janela de 30 dias, proximidade de centavos/valor na mesma categoria
   * e mesmo fornecedor + categoria com valor próximo.
   */
  public verifyDuplicate(
    items: ExpenseSearchResult[],
    criteria: {
      amount: number | null
      date?: string | null
      merchant?: string | null
      category?: string | null
      cnpj?: string | null
      excludeExpenseId?: string
    },
  ): DuplicateCheckResult {
    const { amount, date, merchant, category, cnpj, excludeExpenseId } = criteria

    const result: DuplicateCheckResult = {
      hasIdentical: false,
      identicalMatch: null,
      nearMatches: [],
      reason: undefined,
      searchedCriteria: {
        amount,
        date: date || null,
        merchant: merchant || null,
        category: category || null,
      },
    }

    if (amount === null || amount === undefined || Number(amount) <= 0) {
      return result
    }

    // Mapa de itens para recuperar o trip do ExpenseSearchResult
    const itemMap = new Map<string, ExpenseSearchResult>()
    const expenseList: Expense[] = []

    for (const item of items) {
      itemMap.set(item.expense.id, item)
      expenseList.push(item.expense)
    }

    const dupeDetection = detectDuplicateExpense(
      {
        amount,
        issue_date: date || null,
        merchant_name: merchant || '',
        category: category || null,
        cnpj: cnpj || null,
        excludeExpenseId,
      },
      expenseList,
    )

    if (!dupeDetection.isDuplicate || !dupeDetection.matchingExpense) {
      return result
    }

    const matchDetails = dupeDetection.matchDetails || []
    result.reason = dupeDetection.reason

    matchDetails.forEach((detail, index) => {
      const parentSearchResult = itemMap.get(detail.expense.id)
      const mappedResult: ExpenseSearchResult = {
        expense: detail.expense,
        trip: parentSearchResult?.trip || null,
        matchType: detail.priority === 1 ? 'exact_duplicate' : 'close_match',
        matchReason: detail.reason,
      }

      if (index === 0) {
        result.hasIdentical = true
        result.identicalMatch = mappedResult
      } else {
        result.nearMatches.push(mappedResult)
      }
    })

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
      category: ocrResult.category,
      cnpj: ocrResult.cnpj,
    })

    return {
      ...check,
      ocrData: ocrResult,
    }
  }
}

export const receiptSearchService = new ReceiptSearchService()
