/**
 * batchSpreadsheetService.ts
 *
 * Serviço para importação assistida por planilha de referência ("Pacote de Viagem Pré-Processado")
 * no fluxo de Upload em Lote do Reembolso.ai.
 *
 * Suporta planilhas .xlsx (via SheetJS dynamic/bundled ou parser nativo) e arquivos .csv.
 */

import { ExpenseCategory } from '@/types/database'

export interface SpreadsheetExpenseRow {
  data: string // DD/MM/AAAA formatado original
  dataIso: string // YYYY-MM-DD
  nomeEstabelecimento: string
  cnpj: string
  classificacao: string // Alimentação, Transporte, Combustível, Hospedagem, Outros
  category: ExpenseCategory
  pontos: number // inteiro
  valorTotal: number // decimal em R$
  valorTaxaEmbarque: number // caso haja pontos, o valor total da planilha representa a taxa
  valorConvertidoPontos: number // pontos * 0.017
  valorFinalCalculado: number // valorTotal + (pontos * 0.017) se pontos > 0, senão valorTotal
  formaPagamento: 'Pontos + Taxas' | 'Dinheiro'
  arquivoComprovante: string // Nome exato do arquivo no lote
  rawRow: Record<string, any>
}

export interface SpreadsheetParseResult {
  fileName: string
  rows: SpreadsheetExpenseRow[]
  errors: string[]
}

export interface SpreadsheetDiscrepancy {
  field: 'date' | 'amount' | 'category'
  label: string
  sheetValue: string
  ocrValue: string
  rawSheetVal: any
  rawOcrVal: any
  differenceDescription: string
}

export interface MatchEvaluationResult {
  hasSheetMatch: boolean
  sheetRow?: SpreadsheetExpenseRow
  is100PercentMatch: boolean
  discrepancies: SpreadsheetDiscrepancy[]
  suggestedValues: {
    issue_date: string
    merchant_name: string
    cnpj: string
    category: ExpenseCategory
    amount: number
    points: number
    payment_method: 'Pontos + Taxas' | 'Dinheiro'
  }
  auditFlags: string[]
  metadataNote?: string
}

import { appSettingsService, DEFAULT_AZUL_POINT_RATE } from './appSettingsService'

// Taxa padrão canônica do Reembolso.ai para conversão de pontos/milhas (mantida para compatibilidade de tipos/testes)
export const POINT_CONVERSION_RATE = DEFAULT_AZUL_POINT_RATE

/**
 * Retorna a taxa dinâmica atual de conversão configurada no sistema.
 */
export function getActivePointConversionRate(): number {
  return appSettingsService.getPointRateSync()
}

/**
 * Normaliza nome de arquivo para comparação insensível a maiúsculas/minúsculas e espaços extras.
 */
export function normalizeFileName(fileName: string): string {
  if (!fileName) return ''
  return fileName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Converte data DD/MM/AAAA ou variações para YYYY-MM-DD
 */
export function parseDateToIso(dateStr: string): string {
  if (!dateStr) return ''
  const trimmed = dateStr.trim()

  // Já em formato YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  // Formato DD/MM/AAAA ou D/M/AAAA
  const parts = trimmed.split(/[/.-]/)
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY/MM/DD
      const y = parts[0]
      const m = parts[1].padStart(2, '0')
      const d = parts[2].padStart(2, '0')
      return `${y}-${m}-${d}`
    } else {
      // DD/MM/YYYY
      const d = parts[0].padStart(2, '0')
      const m = parts[1].padStart(2, '0')
      const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2]
      return `${y}-${m}-${d}`
    }
  }

  return trimmed
}

/**
 * Converte valor em moeda brasileira (ex: "22,10", "1.234,56", 22.1) para número decimal
 */
export function parseCurrencyNumber(val: any): number {
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : Number(val.toFixed(2))
  }
  if (!val) return 0
  const str = String(val).trim()
  if (!str) return 0

  // Se tiver formato brasileiro "1.234,56"
  if (str.includes(',') && str.includes('.')) {
    const cleaned = str.replace(/\./g, '').replace(',', '.')
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? 0 : Number(parsed.toFixed(2))
  }

  if (str.includes(',')) {
    const cleaned = str.replace(',', '.')
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? 0 : Number(parsed.toFixed(2))
  }

  const parsed = parseFloat(str)
  return isNaN(parsed) ? 0 : Number(parsed.toFixed(2))
}

/**
 * Converte classificação em texto para ExpenseCategory do app
 */
export function mapClassificationToCategory(classification: string): ExpenseCategory {
  if (!classification) return 'outros'
  const norm = classification
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (norm.includes('aliment')) return 'alimentacao'
  if (
    norm.includes('transp') ||
    norm.includes('passag') ||
    norm.includes('aereo') ||
    norm.includes('voo')
  )
    return 'transporte'
  if (
    norm.includes('combust') ||
    norm.includes('gasolina') ||
    norm.includes('etanol') ||
    norm.includes('diesel')
  )
    return 'combustivel'
  if (norm.includes('hosped') || norm.includes('hotel') || norm.includes('pousada'))
    return 'hospedagem'
  if (norm.includes('pedag')) return 'pedagio'
  if (norm.includes('uber') || norm.includes('taxi') || norm.includes('99')) return 'uber_taxi'
  if (norm.includes('estacion')) return 'estacionamento'
  return 'outros'
}

/**
 * Verifica se um arquivo é planilha suportada (.xlsx ou .csv)
 */
export function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.xlsx') || name.endsWith('.csv') || name.endsWith('.xls')
}

/**
 * Parser de linhas de CSV com suporte a aspas duplas, ponto-e-vírgula e vírgula
 */
export function parseCsvText(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  // Detecta delimitador (, ou ;)
  const firstLine = lines[0]
  const semiCount = (firstLine.match(/;/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length
  const delimiter =
    semiCount >= commaCount && semiCount >= tabCount ? ';' : tabCount > commaCount ? '\t' : ','

  const parseLine = (line: string): string[] => {
    const values: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    values.push(current.trim())
    return values
  }

  const rawHeaders = parseLine(lines[0])
  const headers = rawHeaders.map((h) => h.replace(/^["']|["']$/g, '').trim())

  const records: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const rowVals = parseLine(lines[i])
    if (rowVals.length === 0 || rowVals.every((v) => v === '')) continue

    const record: Record<string, string> = {}
    headers.forEach((header, idx) => {
      record[header] = rowVals[idx] || ''
    })
    records.push(record)
  }

  return records
}

/**
 * Parser de planilha XLSX via SheetJS carregado sob demanda (CDN ou global)
 * com fallback gracioso se não disponível.
 */
async function getXlsxLib(): Promise<any> {
  if (typeof (window as any).XLSX !== 'undefined') {
    return (window as any).XLSX
  }

  // Tenta carregar dinamicamente via script CDN se não estiver no bundle
  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById('sheetjs-cdn')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve((window as any).XLSX))
      existingScript.addEventListener('error', (e) => reject(e))
      return
    }

    const script = document.createElement('script')
    script.id = 'sheetjs-cdn'
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
    script.async = true
    script.onload = () => {
      if ((window as any).XLSX) {
        resolve((window as any).XLSX)
      } else {
        reject(new Error('Biblioteca XLSX não inicializou corretamente.'))
      }
    }
    script.onerror = (e) =>
      reject(new Error('Falha ao carregar biblioteca de leitura de Excel (.xlsx).'))
    document.head.appendChild(script)
  })
}

/**
 * Encontra a chave do objeto que corresponde a um dos nomes prováveis de coluna
 */
function findColValue(record: Record<string, any>, possibleNames: string[]): any {
  const keys = Object.keys(record)
  for (const name of possibleNames) {
    const target = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    for (const key of keys) {
      const normKey = key
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
      if (normKey === target || normKey.includes(target)) {
        return record[key]
      }
    }
  }
  return undefined
}

/**
 * Mapeia um registro bruto de planilha para SpreadsheetExpenseRow
 */
function mapRawRecordToSpreadsheetRow(record: Record<string, any>): SpreadsheetExpenseRow | null {
  const rawArquivo = findColValue(record, [
    'arquivo do comprovante',
    'arquivo',
    'comprovante',
    'file_name',
    'nome do arquivo',
  ])
  const arquivoComprovante = String(rawArquivo || '').trim()

  const rawData = findColValue(record, ['data', 'data de emissao', 'emissao', 'date'])
  const data = String(rawData || '').trim()

  const rawEstabelecimento = findColValue(record, [
    'nome do estabelecimento',
    'estabelecimento',
    'fornecedor',
    'razao social',
    'merchant',
    'local',
  ])
  const nomeEstabelecimento = String(rawEstabelecimento || '').trim()

  const rawCnpj = findColValue(record, ['cnpj do estabelecimento', 'cnpj'])
  const cnpj = String(rawCnpj || '').trim()

  const rawClassificacao = findColValue(record, ['classificacao', 'categoria', 'tipo'])
  const classificacao = String(rawClassificacao || 'Outros').trim()

  const rawPontos = findColValue(record, ['pontos', 'milhas', 'pts'])
  const pontos =
    typeof rawPontos === 'number'
      ? Math.round(rawPontos)
      : parseInt(String(rawPontos || '0').replace(/\D/g, ''), 10) || 0

  const rawValor = findColValue(record, ['valor total', 'valor', 'total', 'amount'])
  const valorTotal = parseCurrencyNumber(rawValor)

  // Deve ter ao menos arquivo ou estabelecimento/valor para ser linha válida
  if (!arquivoComprovante && !nomeEstabelecimento && valorTotal === 0) {
    return null
  }

  const category = mapClassificationToCategory(classificacao)
  const dataIso = parseDateToIso(data)

  const activeRate = getActivePointConversionRate()
  const valorTaxaEmbarque = valorTotal
  const valorConvertidoPontos = pontos > 0 ? Number((pontos * activeRate).toFixed(2)) : 0
  const valorFinalCalculado =
    pontos > 0 ? Number((valorTaxaEmbarque + valorConvertidoPontos).toFixed(2)) : valorTotal
  const formaPagamento: 'Pontos + Taxas' | 'Dinheiro' = pontos > 0 ? 'Pontos + Taxas' : 'Dinheiro'

  return {
    data,
    dataIso,
    nomeEstabelecimento,
    cnpj,
    classificacao,
    category,
    pontos,
    valorTotal,
    valorTaxaEmbarque,
    valorConvertidoPontos,
    valorFinalCalculado,
    formaPagamento,
    arquivoComprovante,
    rawRow: record,
  }
}

/**
 * Faz o parse de arquivo de planilha (.xlsx ou .csv) e devolve as linhas estruturadas
 */
export async function parseSpreadsheetFile(file: File): Promise<SpreadsheetParseResult> {
  const fileName = file.name
  const isCsv = fileName.toLowerCase().endsWith('.csv')

  if (isCsv) {
    try {
      const text = await file.text()
      const rawRecords = parseCsvText(text)
      const rows: SpreadsheetExpenseRow[] = []
      for (const rec of rawRecords) {
        const mapped = mapRawRecordToSpreadsheetRow(rec)
        if (mapped) rows.push(mapped)
      }
      return {
        fileName,
        rows,
        errors: [],
      }
    } catch (err: any) {
      return {
        fileName,
        rows: [],
        errors: [`Erro ao ler arquivo CSV: ${err?.message || 'formato inválido'}`],
      }
    }
  }

  // Arquivo .xlsx / .xls
  try {
    const XLSX = await getXlsxLib()
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })

    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) {
      return {
        fileName,
        rows: [],
        errors: ['A planilha não contém nenhuma aba/pasta de trabalho.'],
      }
    }

    const worksheet = workbook.Sheets[firstSheetName]
    const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false })

    const rows: SpreadsheetExpenseRow[] = []
    for (const rec of rawJson) {
      const mapped = mapRawRecordToSpreadsheetRow(rec)
      if (mapped) rows.push(mapped)
    }

    return {
      fileName,
      rows,
      errors: [],
    }
  } catch (err: any) {
    return {
      fileName,
      rows: [],
      errors: [
        `Erro ao processar planilha Excel (.xlsx): ${err?.message || 'formato não suportado'}`,
      ],
    }
  }
}

/**
 * Reconcilia comprovante com a linha correspondente da planilha (match por nome do arquivo)
 * e avalia compatibilidade de 3 campos-chave com o OCR do app:
 * 1. Data de Emissão
 * 2. Valor Monetário (com tolerância <= 0.01)
 * 3. Tipo/Categoria
 */
export function evaluateReceiptAgainstSpreadsheet(params: {
  receiptFileName: string
  ocrData: {
    issue_date: string | null
    amount: number | null
    category: ExpenseCategory | null
    merchant_name?: string | null
    cnpj?: string | null
  }
  spreadsheetRows: SpreadsheetExpenseRow[]
  tripPeriod?: {
    startDate: string
    endDate: string
  }
  existingExpenses?: Array<{
    cnpj?: string | null
    issue_date: string
    amount: number
    id?: string
  }>
}): MatchEvaluationResult {
  const { receiptFileName, ocrData, spreadsheetRows, tripPeriod, existingExpenses } = params

  const normalizedReceiptName = normalizeFileName(receiptFileName)

  // Encontra linha na planilha por nome do arquivo
  const matchedRow = spreadsheetRows.find((row) => {
    const rowFileNorm = normalizeFileName(row.arquivoComprovante)
    if (!rowFileNorm) return false
    return (
      rowFileNorm === normalizedReceiptName ||
      rowFileNorm.includes(normalizedReceiptName) ||
      normalizedReceiptName.includes(rowFileNorm)
    )
  })

  // Se não tem linha na planilha, não há match de planilha
  if (!matchedRow) {
    return {
      hasSheetMatch: false,
      is100PercentMatch: false,
      discrepancies: [],
      suggestedValues: {
        issue_date: ocrData.issue_date || '',
        merchant_name: ocrData.merchant_name || '',
        cnpj: ocrData.cnpj || '',
        category: ocrData.category || 'outros',
        amount: ocrData.amount ?? 0,
        points: 0,
        payment_method: 'Dinheiro',
      },
      auditFlags: [],
    }
  }

  // A Planilha é a sugestão principal:
  const suggestedDate = matchedRow.dataIso || ocrData.issue_date || ''
  const suggestedMerchant = matchedRow.nomeEstabelecimento || ocrData.merchant_name || ''
  const suggestedCnpj = matchedRow.cnpj || ocrData.cnpj || ''
  const suggestedCategory = matchedRow.category || ocrData.category || 'outros'
  const suggestedAmount = matchedRow.valorFinalCalculado || ocrData.amount || 0
  const suggestedPoints = matchedRow.pontos
  const suggestedPaymentMethod = matchedRow.formaPagamento

  const discrepancies: SpreadsheetDiscrepancy[] = []
  const auditFlags: string[] = []

  // 1. Comparação de Data de Emissão (Data da planilha vs. issue_date do OCR)
  if (matchedRow.dataIso && ocrData.issue_date) {
    if (matchedRow.dataIso !== ocrData.issue_date) {
      discrepancies.push({
        field: 'date',
        label: 'Data de Emissão',
        sheetValue: matchedRow.data,
        ocrValue: ocrData.issue_date,
        rawSheetVal: matchedRow.dataIso,
        rawOcrVal: ocrData.issue_date,
        differenceDescription: `Planilha: ${matchedRow.data} | OCR App: ${ocrData.issue_date}`,
      })
      auditFlags.push(
        `divergencia_ocr_data:planilha=${matchedRow.dataIso}|ocr=${ocrData.issue_date}`,
      )
    }
  } else if (!ocrData.issue_date && matchedRow.dataIso) {
    // OCR não detectou data com certeza, mas planilha possui
    discrepancies.push({
      field: 'date',
      label: 'Data de Emissão',
      sheetValue: matchedRow.data,
      ocrValue: 'Não detectada',
      rawSheetVal: matchedRow.dataIso,
      rawOcrVal: '',
      differenceDescription: `Planilha: ${matchedRow.data} | OCR App: não identificada`,
    })
    auditFlags.push(`divergencia_ocr_data:planilha=${matchedRow.dataIso}|ocr=nao_detectada`)
  }

  // 2. Comparação de Valor Monetário (Valor total da planilha vs. amount do OCR, tolerância <= 0.01)
  // Nota: para despesas com pontos, o valor na planilha para comparação é o valor em dinheiro informado
  const sheetBaseAmount = matchedRow.valorTotal
  const ocrAmount =
    ocrData.amount !== null && ocrData.amount !== undefined ? Number(ocrData.amount) : null

  if (ocrAmount !== null) {
    // Se a despesa tiver pontos > 0, o OCR pode ter lido a taxa em dinheiro OU o total convertido
    const diffWithTax = Math.abs(sheetBaseAmount - ocrAmount)
    const diffWithTotal = Math.abs(matchedRow.valorFinalCalculado - ocrAmount)
    const isAmountMatch = diffWithTax <= 0.01 || diffWithTotal <= 0.01

    if (!isAmountMatch) {
      const sheetFmt = `R$ ${matchedRow.valorTotal.toFixed(2).replace('.', ',')}`
      const ocrFmt = `R$ ${ocrAmount.toFixed(2).replace('.', ',')}`
      discrepancies.push({
        field: 'amount',
        label: 'Valor Monetário',
        sheetValue: sheetFmt,
        ocrValue: ocrFmt,
        rawSheetVal: matchedRow.valorTotal,
        rawOcrVal: ocrAmount,
        differenceDescription: `Planilha: ${sheetFmt} | OCR App: ${ocrFmt}`,
      })
      auditFlags.push(`divergencia_ocr_valor:planilha=${matchedRow.valorTotal}|ocr=${ocrAmount}`)
    }
  } else {
    // OCR não detectou valor
    const sheetFmt = `R$ ${matchedRow.valorTotal.toFixed(2).replace('.', ',')}`
    discrepancies.push({
      field: 'amount',
      label: 'Valor Monetário',
      sheetValue: sheetFmt,
      ocrValue: 'Não detectado',
      rawSheetVal: matchedRow.valorTotal,
      rawOcrVal: 0,
      differenceDescription: `Planilha: ${sheetFmt} | OCR App: não detectado`,
    })
    auditFlags.push(`divergencia_ocr_valor:planilha=${matchedRow.valorTotal}|ocr=nao_detectado`)
  }

  // 3. Comparação de Tipo/Categoria (Classificação da planilha vs. category do OCR)
  if (ocrData.category) {
    if (matchedRow.category !== ocrData.category) {
      discrepancies.push({
        field: 'category',
        label: 'Categoria',
        sheetValue: matchedRow.classificacao,
        ocrValue: ocrData.category,
        rawSheetVal: matchedRow.category,
        rawOcrVal: ocrData.category,
        differenceDescription: `Planilha: ${matchedRow.classificacao} | OCR App: ${ocrData.category}`,
      })
      auditFlags.push(
        `divergencia_ocr_categoria:planilha=${matchedRow.category}|ocr=${ocrData.category}`,
      )
    }
  }

  // REGRA DE NEGÓCIO: Validação de Janela da Viagem
  if (tripPeriod && suggestedDate) {
    if (suggestedDate < tripPeriod.startDate || suggestedDate > tripPeriod.endDate) {
      auditFlags.push('alerta_data_fora_periodo_viagem')
    }
  }

  // REGRA DE NEGÓCIO: Prevenção de Duplicidade (Deduplicação por CNPJ + Data + Valor total)
  if (existingExpenses && existingExpenses.length > 0 && suggestedDate && suggestedAmount > 0) {
    const hasExactDuplicate = existingExpenses.some((exp) => {
      const sameDate = exp.issue_date === suggestedDate
      const sameAmount = Math.abs(exp.amount - suggestedAmount) <= 0.01
      const sameCnpj =
        suggestedCnpj && exp.cnpj
          ? exp.cnpj.replace(/\D/g, '') === suggestedCnpj.replace(/\D/g, '')
          : false

      // Match exato por CNPJ + Data + Valor total OU Data + Valor total
      return (sameDate && sameAmount && sameCnpj) || (sameDate && sameAmount)
    })

    if (hasExactDuplicate) {
      auditFlags.push('alerta_possivel_duplicidade_planilha')
      if (!auditFlags.includes('comprovante_duplicado')) {
        auditFlags.push('comprovante_duplicado')
      }
    }
  }

  // Flag especial de pontos/milhas se houver
  if (suggestedPoints > 0) {
    auditFlags.push(`pontos_aplicados:${suggestedPoints}`)
    auditFlags.push(`taxa_embarque_dinheiro:${matchedRow.valorTaxaEmbarque}`)
    auditFlags.push(`forma_pagamento:pontos_e_taxas`)
  }

  const is100PercentMatch = discrepancies.length === 0

  return {
    hasSheetMatch: true,
    sheetRow: matchedRow,
    is100PercentMatch,
    discrepancies,
    suggestedValues: {
      issue_date: suggestedDate,
      merchant_name: suggestedMerchant,
      cnpj: suggestedCnpj,
      category: suggestedCategory,
      amount: suggestedAmount,
      points: suggestedPoints,
      payment_method: suggestedPaymentMethod,
    },
    auditFlags,
    metadataNote: `Vinculado à planilha (${matchedRow.arquivoComprovante}). Forma de pagamento: ${suggestedPaymentMethod}.`,
  }
}
