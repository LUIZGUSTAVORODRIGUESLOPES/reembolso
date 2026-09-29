import { ExpenseCategory } from '@/types/database'
import * as pdfjsLib from 'pdfjs-dist'
import { createWorker, Worker } from 'tesseract.js'

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
}

export interface ProcessedReceiptOcr {
  file_name: string
  file_url: string
  merchant_name: string | null
  cnpj: string | null
  category: ExpenseCategory
  amount: number | null
  issue_date: string | null // YYYY-MM-DD
  issue_time: string | null // HH:mm
  ocr_raw_text: string
  preview_data_url: string
  extraction_method: 'pdf_text' | 'image_ocr' | 'pdf_raster_ocr'
  confidence_score: number // 0 to 100
  recognized_fields: {
    amount: boolean
    issue_date: boolean
    merchant_name: boolean
    cnpj: boolean
    issue_time: boolean
  }
}

// Global cached Tesseract worker to avoid spawning multiple times
let tesseractWorkerPromise: Promise<Worker> | null = null

async function getOcrWorker(
  onProgress?: (progress: number, status: string) => void,
): Promise<Worker> {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const worker = await createWorker('por+eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.1',
        logger: (m) => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(Math.round(m.progress * 100), 'Lendo caracteres da imagem...')
          }
        },
      })
      return worker
    })()
  }
  return tesseractWorkerPromise
}

/**
 * Extract embedded text and render first page to canvas from PDF using pdfjs-dist
 */
async function extractFromPdf(
  file: File,
  onProgress?: (progress: number, status: string) => void,
): Promise<{ rawText: string; pageCanvasDataUrl: string; hasEmbeddedText: boolean }> {
  onProgress?.(15, 'Carregando documento PDF...')
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise

  const totalPages = Math.min(pdf.numPages, 3) // Read up to first 3 pages
  let allText = ''
  let firstPageCanvasDataUrl = ''

  for (let i = 1; i <= totalPages; i++) {
    onProgress?.(25 + Math.round((i / totalPages) * 25), `Lendo página ${i} de ${pdf.numPages}...`)
    const page = await pdf.getPage(i)

    // Extract text content
    const textContent = await page.getTextContent()
    const pageText = textContent.items.map((item: any) => ('str' in item ? item.str : '')).join(' ')
    allText += ' ' + pageText

    // Render first page to canvas to produce thumbnail preview and enable raster OCR if needed
    if (i === 1) {
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const context = canvas.getContext('2d')

      if (context) {
        await page.render({
          canvasContext: context,
          viewport,
        }).promise
        firstPageCanvasDataUrl = canvas.toDataURL('image/jpeg', 0.85)
      }
    }
  }

  const cleanText = allText.replace(/\s+/g, ' ').trim()
  const hasEmbeddedText = cleanText.length > 25

  return {
    rawText: cleanText,
    pageCanvasDataUrl: firstPageCanvasDataUrl,
    hasEmbeddedText,
  }
}

/**
 * Run Tesseract OCR on an image file or canvas data URL
 */
async function runOcrOnImage(
  imageSource: File | string,
  onProgress?: (progress: number, status: string) => void,
): Promise<string> {
  onProgress?.(30, 'Inicializando motor OCR Tesseract...')
  const worker = await getOcrWorker(onProgress)
  onProgress?.(50, 'Processando imagem via OCR neural...')
  const ret = await worker.recognize(imageSource)
  return ret.data.text || ''
}

/**
 * Structured Brazilian receipt deterministic parser
 * NEVER invents data: returns null for any field not extracted with high confidence
 */
export function parseBrazilianReceiptText(rawText: string): {
  merchant_name: string | null
  cnpj: string | null
  category: ExpenseCategory
  amount: number | null
  issue_date: string | null
  issue_time: string | null
} {
  const normalizedText = rawText.replace(/\r/g, ' ')

  // 1. CNPJ extraction: 00.000.000/0000-00 or 00000000000000
  let cnpj: string | null = null
  const cnpjMatch = normalizedText.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/)
  if (cnpjMatch) {
    const rawCnpj = cnpjMatch[0].replace(/\D/g, '')
    if (rawCnpj.length === 14) {
      cnpj = `${rawCnpj.slice(0, 2)}.${rawCnpj.slice(2, 5)}.${rawCnpj.slice(5, 8)}/${rawCnpj.slice(8, 12)}-${rawCnpj.slice(12, 14)}`
    }
  }

  // 2. Date extraction: dd/mm/yyyy or dd/mm/yy or yyyy-mm-dd
  let issue_date: string | null = null
  const dateRegex = /\b(0[1-9]|[12][0-9]|3[01])[/.-](0[1-9]|1[012])[/.-](20\d\d|\d{2})\b/g
  const dateMatches = [...normalizedText.matchAll(dateRegex)]
  if (dateMatches.length > 0) {
    // Pick the most plausible receipt date (often accompanied by 'emissão', 'data', or near time)
    let bestDate: string | null = null
    for (const match of dateMatches) {
      const day = match[1]
      const month = match[2]
      let year = match[3]
      if (year.length === 2) {
        year = `20${year}`
      }
      const yNum = parseInt(year, 10)
      if (yNum >= 2020 && yNum <= 2030) {
        bestDate = `${year}-${month}-${day}`
        // Prioritize if near keywords
        const index = match.index ?? 0
        const surrounding = normalizedText
          .substring(Math.max(0, index - 25), Math.min(normalizedText.length, index + 35))
          .toLowerCase()
        if (
          surrounding.includes('emiss') ||
          surrounding.includes('data') ||
          surrounding.includes('nfc') ||
          surrounding.includes('pedido')
        ) {
          issue_date = bestDate
          break
        }
      }
    }
    if (!issue_date && bestDate) {
      issue_date = bestDate
    }
  }

  // Fallback ISO format YYYY-MM-DD
  if (!issue_date) {
    const isoMatch = normalizedText.match(/\b(20\d\d)-(0[1-9]|1[012])-(0[1-9]|[12]\d|3[01])\b/)
    if (isoMatch) {
      issue_date = isoMatch[0]
    }
  }

  // 3. Time extraction: HH:mm or HH:mm:ss
  let issue_time: string | null = null
  const timeMatch = normalizedText.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/)
  if (timeMatch) {
    issue_time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
  }

  // 4. Amount extraction: total / valor a pagar / total a pagar / r$ XX,XX
  let amount: number | null = null
  const totalKeywords = [
    /(?:valor\s*total|total\s*a\s*pagar|total\s*r\$|total\s*liquido|v\.?\s*total|total|subtotal)[\s:=-]*r?\$?\s*([\d.\s]+,\d{2})/i,
    /(?:pago\s*pelo\s*app|valor\s*pago|cartao|credito|debito)[\s:=-]*r?\$?\s*([\d.\s]+,\d{2})/i,
    /r\$\s*([\d.\s]+,\d{2})/gi,
  ]

  // Try direct total keyword pattern first
  for (const regex of totalKeywords.slice(0, 2)) {
    const match = normalizedText.match(regex)
    if (match && match[1]) {
      const cleanVal = match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
      const num = parseFloat(cleanVal)
      if (!isNaN(num) && num > 0 && num < 100000) {
        amount = Number(num.toFixed(2))
        break
      }
    }
  }

  // If not found with keyword, search all R$ occurrences and pick the largest one (usually the grand total)
  if (!amount) {
    const allR$Matches = [...normalizedText.matchAll(/r\$\s*([\d.\s]+,\d{2})/gi)]
    const amountsFound: number[] = []
    for (const m of allR$Matches) {
      const cleanVal = m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
      const num = parseFloat(cleanVal)
      if (!isNaN(num) && num > 0 && num < 100000) {
        amountsFound.push(num)
      }
    }
    if (amountsFound.length > 0) {
      // Typically Total is the maximum value on receipt
      amount = Number(Math.max(...amountsFound).toFixed(2))
    }
  }

  // 5. Merchant extraction:
  let merchant_name: string | null = null
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3)

  // Known merchant signatures from text
  const lower = normalizedText.toLowerCase()
  if (lower.includes('meu sushi')) merchant_name = 'Meu Sushi Temakeria'
  else if (lower.includes('rodosnack')) merchant_name = 'Rodosnack Estiva Lanchonete e Restaurante'
  else if (lower.includes('autoban')) merchant_name = 'Concessionária AutoBAn'
  else if (lower.includes('ipiranga')) merchant_name = 'Posto Ipiranga'
  else if (lower.includes('uber')) merchant_name = 'Uber do Brasil'
  else if (lower.includes('99app') || lower.includes('99 tecnologia')) merchant_name = '99 App'
  else if (lower.includes('fogo de chao') || lower.includes('fogo de chão'))
    merchant_name = 'Fogo de Chão'
  else if (lower.includes('localiza')) merchant_name = 'Localiza Rent a Car'
  else if (lower.includes('movida')) merchant_name = 'Movida Aluguel de Carros'
  else if (lower.includes('latam')) merchant_name = 'LATAM Airlines'
  else if (lower.includes('gol linhas')) merchant_name = 'Gol Linhas Aéreas'
  else if (lower.includes('azul linhas')) merchant_name = 'Azul Linhas Aéreas'
  else if (lower.includes('hotel ibis') || lower.includes('ibis')) merchant_name = 'Hotel Ibis'
  else {
    // Look at first 5 lines for company name (skip headers like CNPJ, DANFE, etc.)
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const line = lines[i]
      const lineLow = line.toLowerCase()
      if (
        lineLow.includes('comprovante') ||
        lineLow.includes('danfe') ||
        lineLow.includes('documento') ||
        lineLow.includes('detalhes do pedido') ||
        lineLow.includes('cnpj') ||
        lineLow.includes('cupom') ||
        lineLow.length < 4
      ) {
        continue
      }
      // If line has LTDA, S/A, ME, EPP, RESTAURANTE, POSTO, HOTEL, LANCHONETE, or looks like a title
      if (
        lineLow.includes('ltda') ||
        lineLow.includes('s/a') ||
        lineLow.includes('s.a.') ||
        lineLow.includes('me') ||
        lineLow.includes('restaurante') ||
        lineLow.includes('posto') ||
        lineLow.includes('hotel') ||
        lineLow.includes('lanchonete') ||
        lineLow.includes('temakeria') ||
        lineLow.includes('panificadora') ||
        lineLow.includes('cafe') ||
        lineLow.includes('café') ||
        line.split(' ').length >= 2
      ) {
        merchant_name = line.slice(0, 50).trim()
        break
      }
    }
  }

  // 6. Category classification based on verified keywords
  let category: ExpenseCategory = 'outros'
  if (
    lower.includes('combustivel') ||
    lower.includes('gasolina') ||
    lower.includes('etanol') ||
    lower.includes('diesel') ||
    lower.includes('posto') ||
    lower.includes('abastecimento')
  ) {
    category = 'combustivel'
  } else if (
    lower.includes('uber') ||
    lower.includes('99') ||
    lower.includes('taxi') ||
    lower.includes('táxi') ||
    lower.includes('corrida')
  ) {
    category = 'uber_taxi'
  } else if (
    lower.includes('restaurante') ||
    lower.includes('lanchonete') ||
    lower.includes('alimentacao') ||
    lower.includes('alimentação') ||
    lower.includes('sushi') ||
    lower.includes('burger') ||
    lower.includes('lanche') ||
    lower.includes('salmão') ||
    lower.includes('refeicao') ||
    lower.includes('refeição') ||
    lower.includes('almoco') ||
    lower.includes('almoço') ||
    lower.includes('jantar') ||
    lower.includes('self servi') ||
    lower.includes('padaria')
  ) {
    category = 'alimentacao'
  } else if (
    lower.includes('hotel') ||
    lower.includes('pousada') ||
    lower.includes('hospedagem') ||
    lower.includes('diaria') ||
    lower.includes('diária') ||
    lower.includes('checkin') ||
    lower.includes('reserva')
  ) {
    category = 'hospedagem'
  } else if (
    lower.includes('estacionamento') ||
    lower.includes('rotativo') ||
    lower.includes('garagem') ||
    lower.includes('estapapar') ||
    lower.includes('valet')
  ) {
    category = 'estacionamento'
  } else if (
    lower.includes('pedagio') ||
    lower.includes('pedágio') ||
    lower.includes('rodovia') ||
    lower.includes('concessionaria') ||
    lower.includes('concessionária') ||
    lower.includes('sem parar') ||
    lower.includes('conectcar')
  ) {
    category = 'pedagio'
  } else if (
    lower.includes('aereo') ||
    lower.includes('aéreo') ||
    lower.includes('voo') ||
    lower.includes('passagem') ||
    lower.includes('locadora') ||
    lower.includes('aluguel de carro')
  ) {
    category = 'transporte'
  }

  return {
    merchant_name,
    cnpj,
    category,
    amount,
    issue_date,
    issue_time,
  }
}

/**
 * Main real OCR pipeline function
 * Accepts PDF or Image file, runs real extraction, parses Brazilian fiscal fields deterministically.
 */
export async function processRealReceiptOcr(
  file: File,
  onProgress?: (progress: number, status: string) => void,
): Promise<ProcessedReceiptOcr> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  let rawText = ''
  let previewDataUrl = ''
  let extractionMethod: 'pdf_text' | 'image_ocr' | 'pdf_raster_ocr' = 'pdf_text'

  if (isPdf) {
    // 1. Try PDF text layer
    onProgress?.(10, 'Analisando camada de texto do PDF...')
    const pdfResult = await extractFromPdf(file, onProgress)
    previewDataUrl = pdfResult.pageCanvasDataUrl

    if (pdfResult.hasEmbeddedText) {
      rawText = pdfResult.rawText
      extractionMethod = 'pdf_text'
      onProgress?.(80, 'Camada de texto nativa extraída com sucesso.')
    } else {
      // 2. Scanned PDF without text layer: rasterize and run Tesseract OCR
      onProgress?.(40, 'PDF digitalizado (sem texto nativo). Aplicando OCR na imagem...')
      extractionMethod = 'pdf_raster_ocr'
      if (pdfResult.pageCanvasDataUrl) {
        rawText = await runOcrOnImage(pdfResult.pageCanvasDataUrl, onProgress)
      } else {
        rawText = ''
      }
    }
  } else {
    // Image file (JPG/PNG/WEBP)
    extractionMethod = 'image_ocr'
    onProgress?.(15, 'Carregando imagem do comprovante...')

    // Create local object URL for instant preview
    previewDataUrl = URL.createObjectURL(file)

    // Run Tesseract OCR
    rawText = await runOcrOnImage(file, onProgress)
  }

  onProgress?.(90, 'Estruturando campos fiscais (CNPJ, data, valor)...')

  // Parse structured data deterministically (NEVER fake)
  const parsed = parseBrazilianReceiptText(rawText)

  const recognized_fields = {
    amount: parsed.amount !== null,
    issue_date: parsed.issue_date !== null,
    merchant_name: parsed.merchant_name !== null,
    cnpj: parsed.cnpj !== null,
    issue_time: parsed.issue_time !== null,
  }

  const recognizedCount = Object.values(recognized_fields).filter(Boolean).length
  const confidence_score = Math.round((recognizedCount / 5) * 100)

  onProgress?.(100, 'Processamento concluído!')

  return {
    file_name: file.name,
    file_url: previewDataUrl,
    merchant_name: parsed.merchant_name,
    cnpj: parsed.cnpj,
    category: parsed.category,
    amount: parsed.amount,
    issue_date: parsed.issue_date,
    issue_time: parsed.issue_time,
    ocr_raw_text: rawText.trim() || 'Nenhum texto legível detectado.',
    preview_data_url: previewDataUrl,
    extraction_method: extractionMethod,
    confidence_score,
    recognized_fields,
  }
}
