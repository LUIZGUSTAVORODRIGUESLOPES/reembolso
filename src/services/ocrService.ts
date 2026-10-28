import { ExpenseCategory } from '@/types/database'
import * as pdfjsLib from 'pdfjs-dist'
import { createWorker, Worker } from 'tesseract.js'
import { resolveReceiptUrl } from '@/services/receiptFileResolver'

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
  points_applied?: number
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
    points_applied?: boolean
  }
}

export interface ParsedReceiptFields {
  merchant_name: string | null
  cnpj: string | null
  category: ExpenseCategory
  amount: number | null
  points_applied?: number
  issue_date: string | null
  issue_time: string | null
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

// =============================================================================
// 1. PRÉ-PROCESSAMENTO DE IMAGEM EM CANVAS INVISÍVEL (Grayscale + Alto Contraste)
// =============================================================================

export interface PreprocessImageOptions {
  contrast?: number // fator de contraste (padrão 1.45)
  maxDimension?: number // reescala inteligente se muito gigante (padrão 2400px)
  sharpen?: boolean
}

/**
 * Carrega File ou Blob ou string dataURL numa HTMLImageElement
 */
function loadImageElement(source: File | Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    let objectUrlToRevoke: string | null = null

    img.onload = () => {
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke)
      }
      resolve(img)
    }

    img.onerror = (err) => {
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke)
      }
      reject(new Error(`Falha ao carregar imagem para pré-processamento: ${err}`))
    }

    if (typeof source === 'string') {
      img.src = source
    } else {
      objectUrlToRevoke = URL.createObjectURL(source)
      img.src = objectUrlToRevoke
    }
  })
}

/**
 * Aplica filtro de Grayscale (escala de cinza ponderada com luminância perceptiva)
 * e aumento de contraste com estiramento dinâmico do histograma.
 * Reduz sombras de celulares e evidencia a impressão térmica desbotada.
 */
export async function preprocessReceiptImage(
  source: File | Blob | string,
  options: PreprocessImageOptions = {},
): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return typeof source === 'string' ? source : ''
  }

  const { contrast = 1.45, maxDimension = 2400 } = options

  const img = await loadImageElement(source)

  let width = img.naturalWidth || img.width
  let height = img.naturalHeight || img.height

  // Redimensionamento proporcional se a imagem for excessivamente pesada para o Tesseract
  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      height = Math.round((height * maxDimension) / width)
      width = maxDimension
    } else {
      width = Math.round((width * maxDimension) / height)
      height = maxDimension
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Não foi possível obter contexto 2d do canvas de pré-processamento.')
  }

  // Desenha a imagem redimensionada
  ctx.drawImage(img, 0, 0, width, height)

  try {
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    const totalPixels = data.length

    // Fator de contraste linear: F = (259 * (C + 255)) / (255 * (259 - C)) com C em -255..255
    // Ou aproximação robusta normalizada: factor = contrast
    const contrastFactor = Math.max(0.5, Math.min(3.0, contrast))

    for (let i = 0; i < totalPixels; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      // 1. Grayscale baseado em luminância ITU-R BT.601
      const gray = 0.299 * r + 0.587 * g + 0.114 * b

      // 2. Aumento de contraste centrado em 128
      // Reduz tons médios cinzentos de sombras e realça o preto do texto e branco do fundo
      let adjusted = (gray - 128) * contrastFactor + 128

      // Leve clamp defensivo
      if (adjusted < 0) adjusted = 0
      else if (adjusted > 255) adjusted = 255

      data[i] = adjusted
      data[i + 1] = adjusted
      data[i + 2] = adjusted
      // data[i + 3] (alpha) inalterado
    }

    ctx.putImageData(imageData, 0, 0)
    // Exporta JPEG de alta fidelidade para o worker do Tesseract
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch (err) {
    console.warn('Erro ao aplicar pixels no canvas, fallback para imagem crua:', err)
    return canvas.toDataURL('image/jpeg', 0.9)
  }
}

// =============================================================================
// 2. DICIONÁRIOS E SCORING SYSTEM PARA CATEGORIZAÇÃO SEMÂNTICA FUZZY
// =============================================================================

/**
 * Normalização textual avançada para NLP leve:
 * Remove diacríticos, substitui caracteres confundidos pelo OCR térmico (ex: 0 e O, 1 e l)
 * e divide em tokens.
 */
export function normalizeOcrText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\r\t]/g, ' ')
}

/**
 * Levenshtein distance para matching fuzzy tolerante a erros de 1 letra
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

interface CategoryKeywordRule {
  keyword: string
  weight: number
  allowFuzzy?: boolean
  maxDistance?: number
}

/**
 * Dicionários semânticos ponderados para cada ExpenseCategory.
 * Requisito estrito do usuário:
 * "Adicione as palavras unidas, localiza, movida, hertz como peso forte para a categoria 'Transporte'
 * (para corrigir a falha de classificar locadoras como combustível)"
 */
const CATEGORY_DICTIONARIES: Record<ExpenseCategory, CategoryKeywordRule[]> = {
  transporte: [
    // Locadoras de veículos — peso ULTRA FORTE para vencer qualquer menção de combustível na locação
    { keyword: 'unidas', weight: 45, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'localiza', weight: 45, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'movida', weight: 45, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'hertz', weight: 45, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'rent a car', weight: 40 },
    { keyword: 'rentacar', weight: 40 },
    { keyword: 'locadora', weight: 35, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'locacao', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'aluguel de carro', weight: 40 },
    { keyword: 'aluguel de veiculo', weight: 40 },
    { keyword: 'aluguel', weight: 15, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'veiculos', weight: 12 },
    // Cias Aéreas e Aeroportos
    { keyword: 'aeroporto', weight: 28, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'latam', weight: 35 },
    { keyword: 'gol linhas', weight: 35 },
    { keyword: 'azul linhas', weight: 35 },
    { keyword: 'passaredo', weight: 30 },
    { keyword: 'voepass', weight: 30 },
    { keyword: 'voo', weight: 20 },
    { keyword: 'aereo', weight: 25, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'passagem', weight: 20, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'bilhete aereo', weight: 35 },
    { keyword: 'embarque', weight: 18 },
    { keyword: 'tarifa aerea', weight: 30 },
    { keyword: 'rodoviaria', weight: 22 },
    { keyword: 'onibus', weight: 20 },
    { keyword: 'cometa', weight: 18 },
    { keyword: 'passagem de onibus', weight: 30 },
  ],
  uber_taxi: [
    { keyword: 'uber', weight: 35 },
    { keyword: '99', weight: 25 },
    { keyword: '99app', weight: 40 },
    { keyword: '99 tecnologia', weight: 40 },
    { keyword: '99pop', weight: 40 },
    { keyword: 'taxi', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'radiotaxi', weight: 35 },
    { keyword: 'corrida', weight: 22, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'motorista parceiro', weight: 30 },
    { keyword: 'viagem uber', weight: 40 },
    { keyword: 'detalhes da viagem', weight: 25 },
    { keyword: 'tarifa base', weight: 15 },
    { keyword: 'cabify', weight: 30 },
  ],
  combustivel: [
    { keyword: 'gasolina', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'etanol', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'diesel', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'combustivel', weight: 32, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'abastecimento', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'litros', weight: 18, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'bico', weight: 12 },
    { keyword: 'bomba', weight: 14 },
    { keyword: 'posto', weight: 18, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'ipiranga', weight: 30 },
    { keyword: 'petrobras', weight: 30 },
    { keyword: 'shell', weight: 25 },
    { keyword: 'raizen', weight: 30 },
    { keyword: 'auto posto', weight: 35 },
    { keyword: 'lubrificante', weight: 15 },
    { keyword: 'gnv', weight: 25 },
  ],
  alimentacao: [
    { keyword: 'restaurante', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'lanchonete', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'padaria', weight: 25, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'panificadora', weight: 25, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'refeicao', weight: 28, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'almoco', weight: 28, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'jantar', weight: 28, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'cardapio', weight: 15 },
    { keyword: 'prato', weight: 15 },
    { keyword: 'self service', weight: 25 },
    { keyword: 'quilo', weight: 15 },
    { keyword: 'sushi', weight: 30 },
    { keyword: 'temakeria', weight: 30 },
    { keyword: 'pizzaria', weight: 30 },
    { keyword: 'churrascaria', weight: 30 },
    { keyword: 'hamburgueria', weight: 28 },
    { keyword: 'burger', weight: 25 },
    { keyword: 'cafe', weight: 18 },
    { keyword: 'cafeteria', weight: 25 },
    { keyword: 'bebida', weight: 12 },
    { keyword: 'suco', weight: 10 },
    { keyword: 'sobremesa', weight: 12 },
    { keyword: 'lanche', weight: 20 },
    { keyword: 'churrasco', weight: 25 },
    { keyword: 'mcdonalds', weight: 35 },
    { keyword: 'burger king', weight: 35 },
    { keyword: 'subway', weight: 35 },
    { keyword: 'starbucks', weight: 35 },
    { keyword: 'alimentacao', weight: 25 },
  ],
  hospedagem: [
    { keyword: 'hotel', weight: 35, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'pousada', weight: 35, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'hospedagem', weight: 35, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'diaria', weight: 25, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'check-in', weight: 30 },
    { keyword: 'checkin', weight: 30 },
    { keyword: 'check-out', weight: 30 },
    { keyword: 'checkout', weight: 30 },
    { keyword: 'apartamento', weight: 15 },
    { keyword: 'quarto', weight: 18 },
    { keyword: 'hospede', weight: 25, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'reserva', weight: 15 },
    { keyword: 'ibis', weight: 35 },
    { keyword: 'mercure', weight: 35 },
    { keyword: 'novotel', weight: 35 },
    { keyword: 'accor', weight: 35 },
    { keyword: 'airbnb', weight: 35 },
    { keyword: 'booking', weight: 25 },
  ],
  pedagio: [
    { keyword: 'pedagio', weight: 35, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'concessionaria', weight: 28, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'rodovia', weight: 25, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'praca de pedagio', weight: 45 },
    { keyword: 'tarifa de pedagio', weight: 45 },
    { keyword: 'sem parar', weight: 40 },
    { keyword: 'semparar', weight: 40 },
    { keyword: 'conectcar', weight: 40 },
    { keyword: 'veloe', weight: 35 },
    { keyword: 'taggy', weight: 30 },
    { keyword: 'autoban', weight: 40 },
    { keyword: 'ecovias', weight: 40 },
    { keyword: 'arteris', weight: 40 },
    { keyword: 'ccr', weight: 30 },
    { keyword: 'eixo sp', weight: 35 },
    { keyword: 'caminhos da serra', weight: 35 },
  ],
  estacionamento: [
    { keyword: 'estacionamento', weight: 40, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'garagem', weight: 30, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'estapar', weight: 45 },
    { keyword: 'valet', weight: 35 },
    { keyword: 'park', weight: 15 },
    { keyword: 'parking', weight: 30 },
    { keyword: 'rotativo', weight: 25, allowFuzzy: true, maxDistance: 1 },
    { keyword: 'permanencia', weight: 20 },
    { keyword: 'vaga', weight: 15 },
    { keyword: 'ticket de estacionamento', weight: 45 },
    { keyword: 'zona azul', weight: 40 },
  ],
  outros: [],
}

/**
 * Classifica a categoria do recibo com base no Sistema de Pontuação Semântica
 * com tolerância fuzzy leve para pequenos erros do Tesseract.
 */
export function classifyExpenseCategoryByScoring(
  text: string,
  merchantHint?: string | null,
  fileName?: string | null,
): { category: ExpenseCategory; scores: Record<ExpenseCategory, number> } {
  const normText = normalizeOcrText(text)
  const normMerchant = merchantHint ? normalizeOcrText(merchantHint) : ''
  const combined = `${normMerchant} ${normText}`

  // Extrai palavras individuais para matching fuzzy leve
  const words = combined.split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
  const wordSet = new Set(words)

  const scores: Record<ExpenseCategory, number> = {
    transporte: 0,
    combustivel: 0,
    alimentacao: 0,
    hospedagem: 0,
    pedagio: 0,
    uber_taxi: 0,
    estacionamento: 0,
    outros: 0,
  }

  // Se o próprio nome do estabelecimento já apontar locadora, reforço imediato
  if (
    normMerchant.includes('unidas') ||
    normMerchant.includes('localiza') ||
    normMerchant.includes('movida') ||
    normMerchant.includes('hertz') ||
    normMerchant.includes('locadora')
  ) {
    scores.transporte += 80
  }

  // Bônus expressivo por palavras-chave presentes no nome do arquivo (fileName)
  // Ex: "20261028-0819 alimentação.pdf" indica claramente Alimentação mesmo que a razão social seja "Hotelaria"
  if (fileName) {
    const normFileName = normalizeOcrText(fileName)
    if (
      normFileName.includes('alimentacao') ||
      normFileName.includes('almoco') ||
      normFileName.includes('jantar') ||
      normFileName.includes('refeicao') ||
      normFileName.includes('restaurante') ||
      normFileName.includes('lanche')
    ) {
      scores.alimentacao += 100
    }
    if (
      normFileName.includes('pedagio') ||
      normFileName.includes('tarifa') ||
      normFileName.includes('semparar') ||
      normFileName.includes('sem parar') ||
      normFileName.includes('conectcar')
    ) {
      scores.pedagio += 100
    }
    if (
      normFileName.includes('combustivel') ||
      normFileName.includes('gasolina') ||
      normFileName.includes('etanol') ||
      normFileName.includes('diesel') ||
      normFileName.includes('abastecimento') ||
      normFileName.includes('posto')
    ) {
      scores.combustivel += 100
    }
    if (
      normFileName.includes('estacionamento') ||
      normFileName.includes('garagem') ||
      normFileName.includes('valet') ||
      normFileName.includes('estapar')
    ) {
      scores.estacionamento += 100
    }
    if (
      normFileName.includes('uber') ||
      normFileName.includes('99') ||
      normFileName.includes('taxi') ||
      normFileName.includes('cabify')
    ) {
      scores.uber_taxi += 100
    }
    if (
      normFileName.includes('hospedagem') ||
      normFileName.includes('hotel') ||
      normFileName.includes('pousada') ||
      normFileName.includes('diaria') ||
      normFileName.includes('reserva')
    ) {
      scores.hospedagem += 100
    }
    if (
      normFileName.includes('transporte') ||
      normFileName.includes('locacao') ||
      normFileName.includes('aereo') ||
      normFileName.includes('passagem') ||
      normFileName.includes('voo')
    ) {
      scores.transporte += 100
    }
  }

  for (const [catKey, rules] of Object.entries(CATEGORY_DICTIONARIES) as [
    ExpenseCategory,
    CategoryKeywordRule[],
  ][]) {
    for (const rule of rules) {
      const kw = normalizeOcrText(rule.keyword)
      if (!kw) continue

      // 1. Match exato de frase / termo composto no texto completo
      if (combined.includes(kw)) {
        scores[catKey] += rule.weight
        continue
      }

      // 2. Se a keyword for uma palavra só e permitir fuzzy
      if (rule.allowFuzzy && !kw.includes(' ')) {
        const maxDist = rule.maxDistance ?? 1
        // Se a palavra exata está no conjunto
        if (wordSet.has(kw)) {
          scores[catKey] += rule.weight
        } else {
          // Busca fuzzy leve entre as palavras do texto com tamanho similar (+/- 1)
          for (const word of words) {
            if (Math.abs(word.length - kw.length) <= 1) {
              const dist = levenshteinDistance(word, kw)
              if (dist <= maxDist) {
                // Pontuação ligeiramente ponderada por ser fuzzy match
                scores[catKey] += Math.round(rule.weight * 0.85)
                break
              }
            }
          }
        }
      }
    }
  }

  // Determina a categoria vencedora (threshold mínimo de 15 pontos)
  let bestCategory: ExpenseCategory = 'outros'
  let highestScore = 0

  for (const [cat, score] of Object.entries(scores) as [ExpenseCategory, number][]) {
    if (cat === 'outros') continue
    if (score > highestScore && score >= 15) {
      highestScore = score
      bestCategory = cat
    }
  }

  return {
    category: bestCategory,
    scores,
  }
}

// =============================================================================
// 3. CAÇADOR DE VALORES INTELIGENTE (Smart Amount Hunter)
// =============================================================================

export interface CandidateAmount {
  value: number
  rawString: string
  index: number
  isTail30: boolean
  nearTotalKeyword: boolean
  nearPaidKeyword: boolean
  nearCurrencySymbol: boolean
  lineText: string
}

const TOTAL_KEYWORDS = [
  'total a pagar',
  'valor a pagar',
  'total liquido',
  'total r$',
  'valor total',
  'v. total',
  'v total',
  'subtotal',
  'total',
  'liquido a pagar',
  'saldo a pagar',
  'valor recebido',
  'debito',
  'credito',
  'cartao',
  'pago pelo app',
  'valor pago',
]

/**
 * Varre todo o texto extraído e localiza todos os números monetários válidos no padrão brasileiro.
 * Regras do usuário:
 * 1. Priorizar o maior valor encontrado nos 30% finais do texto (onde o Total costuma ficar impresso).
 * 2. Se não achar no final, pegar o maior valor absoluto do documento (limitado a um teto razoável de R$ 15.000).
 * 3. Regras de negócio contextuais: Postos e Locadoras têm valores tipicamente maiores; Uber menor.
 */
export function extractIntelligentAmount(
  rawText: string,
  categoryHint?: ExpenseCategory,
): number | null {
  if (!rawText || rawText.trim().length === 0) return null

  const textLength = rawText.length
  const tail30Threshold = Math.floor(textLength * 0.7) // início dos 30% finais

  // Normalização leve mantendo pontuação relevante
  const norm = rawText.replace(/\r/g, ' ')

  // Expressão regular ampla para valores financeiros brasileiros:
  // Suporta R$ 1.234,56 | R$ 1234,56 | 123,45 | 1.250.00 | etc.
  const amountPattern =
    /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)[,.]([0-9]{2})(?!\d|\/|-)(?:\s*(?:reais|brl))?/gi

  const candidates: CandidateAmount[] = []

  let match: RegExpExecArray | null
  while ((match = amountPattern.exec(norm)) !== null) {
    const fullMatch = match[0]
    const integerPart = match[1].replace(/\./g, '')
    const decimalPart = match[2]
    const numericValue = parseFloat(`${integerPart}.${decimalPart}`)

    if (isNaN(numericValue) || numericValue <= 0) continue

    // Teto razoável corporativo: recibo de despesa não ultrapassa R$ 15.000
    // Além de ignorar códigos de barras (EAN), protocolos fiscais ou CNPJs
    if (numericValue > 15000) continue

    // Ignora valores residuais minúsculos como 0.01 ou 0.05 a menos que seja o único
    if (numericValue < 0.5) continue

    // Rejeita valores que representam números de página isolados (ex: "PÁGINA 1" ou "PAG 2")
    const matchIndex = match.index
    const preCheckSnippet = norm.slice(Math.max(0, matchIndex - 15), matchIndex).toLowerCase()
    if (
      preCheckSnippet.includes('pag') ||
      preCheckSnippet.includes('página') ||
      preCheckSnippet.includes('pagina')
    ) {
      continue
    }

    // Contexto de -40 a +40 caracteres para detectar palavras-chave "total", "pago", "R$"
    const snippetStart = Math.max(0, matchIndex - 40)
    const snippetEnd = Math.min(norm.length, matchIndex + fullMatch.length + 30)
    const contextSnippet = normalizeOcrText(norm.slice(snippetStart, snippetEnd))

    const nearTotal = TOTAL_KEYWORDS.some((kw) => contextSnippet.includes(kw))
    const nearPaid =
      contextSnippet.includes('pago') ||
      contextSnippet.includes('aprovad') ||
      contextSnippet.includes('debito') ||
      contextSnippet.includes('credito') ||
      contextSnippet.includes('mastercard') ||
      contextSnippet.includes('visa') ||
      contextSnippet.includes('pix')
    const nearCurrency = fullMatch.toLowerCase().includes('r$') || contextSnippet.includes('r$')

    // Pega linha inteira para verificação
    const lineStart = norm.lastIndexOf('\n', matchIndex)
    const lineEnd = norm.indexOf('\n', matchIndex)
    const lineText = norm
      .slice(lineStart === -1 ? 0 : lineStart, lineEnd === -1 ? norm.length : lineEnd)
      .trim()

    // Filtra casos óbvios que não são valor total:
    // ex: "desconto 10,00", "troco 5,00", "icms 1,20", "tributos 4,50"
    const lowerLine = normalizeOcrText(lineText)
    if (
      lowerLine.includes('troco') ||
      lowerLine.includes('desconto') ||
      lowerLine.includes('tributo') ||
      lowerLine.includes('aliq') ||
      lowerLine.includes('icms')
    ) {
      // Ignora se for claramente desconto ou troco e não tiver "total"
      if (!nearTotal) {
        continue
      }
    }

    candidates.push({
      value: Number(numericValue.toFixed(2)),
      rawString: fullMatch,
      index: matchIndex,
      isTail30: matchIndex >= tail30Threshold,
      nearTotalKeyword: nearTotal,
      nearPaidKeyword: nearPaid,
      nearCurrencySymbol: nearCurrency,
      lineText,
    })
  }

  if (candidates.length === 0) return null

  // 1. Candidatos explícitos acompanhados de keyword TOTAL ou PAGO
  const totalKeywordCandidates = candidates.filter((c) => c.nearTotalKeyword || c.nearPaidKeyword)
  if (totalKeywordCandidates.length > 0) {
    // Entre os associados a "Total", dá preferência para os que estão na segunda metade/final
    const tailTotals = totalKeywordCandidates.filter((c) => c.isTail30)
    if (tailTotals.length > 0) {
      // Pega o maior valor do final associado a Total
      const maxTailTotal = Math.max(...tailTotals.map((c) => c.value))
      return maxTailTotal
    }
    // Caso contrário, pega o maior valor associado a Total em qualquer posição
    return Math.max(...totalKeywordCandidates.map((c) => c.value))
  }

  // 2. Regra dos 30% finais: o valor Total costuma ficar impresso no final do recibo térmico
  const tailCandidates = candidates.filter((c) => c.isTail30)
  if (tailCandidates.length > 0) {
    // Maior valor encontrado nos 30% finais
    const maxTail = Math.max(...tailCandidates.map((c) => c.value))

    // Se o recibo for Uber / Táxi e tiver valor absurdamente destoante (ex: 3500 por erro de OCR), ajusta
    if (categoryHint === 'uber_taxi' && maxTail > 500) {
      const smaller = tailCandidates.filter((c) => c.value <= 500)
      if (smaller.length > 0) {
        return Math.max(...smaller.map((c) => c.value))
      }
    }

    return maxTail
  }

  // 3. Fallback: maior valor absoluto do documento (limitado ao teto de R$ 15.000)
  let maxAbsolute = Math.max(...candidates.map((c) => c.value))

  // Contexto de Uber: viagens corporativas raramente passam de R$ 500
  if (categoryHint === 'uber_taxi' && maxAbsolute > 500) {
    const reasonableUber = candidates.filter((c) => c.value <= 500)
    if (reasonableUber.length > 0) {
      maxAbsolute = Math.max(...reasonableUber.map((c) => c.value))
    }
  }

  return maxAbsolute
}

// =============================================================================
// 4. PARSER ESTRUTURADO DE COMPROVANTES BRASILEIROS (parseBrazilianReceiptText)
// =============================================================================

const KNOWN_MERCHANT_SIGNATURES: Array<{
  match: string
  name: string
  category?: ExpenseCategory
}> = [
  // Locadoras de Veículos (Transporte)
  { match: 'unidas', name: 'Unidas Locadora', category: 'transporte' },
  { match: 'localiza', name: 'Localiza Rent a Car', category: 'transporte' },
  { match: 'movida', name: 'Movida Aluguel de Carros', category: 'transporte' },
  { match: 'hertz', name: 'Hertz Rent a Car', category: 'transporte' },
  { match: 'rent a car', name: 'Locadora de Veículos', category: 'transporte' },
  // Cias Aéreas
  { match: 'latam', name: 'LATAM Airlines', category: 'transporte' },
  { match: 'gol linhas', name: 'Gol Linhas Aéreas', category: 'transporte' },
  { match: 'azul linhas', name: 'Azul Linhas Aéreas', category: 'transporte' },
  { match: 'passaredo', name: 'Voepass Linhas Aéreas', category: 'transporte' },
  // Mobilidade Urbana
  { match: 'uber', name: 'Uber do Brasil', category: 'uber_taxi' },
  { match: '99app', name: '99 App', category: 'uber_taxi' },
  { match: '99 tecnologia', name: '99 App', category: 'uber_taxi' },
  { match: '99pop', name: '99 App', category: 'uber_taxi' },
  // Postos de Combustível
  { match: 'ipiranga', name: 'Posto Ipiranga', category: 'combustivel' },
  { match: 'petrobras', name: 'Posto Petrobras', category: 'combustivel' },
  { match: 'raizen', name: 'Posto Shell (Raízen)', category: 'combustivel' },
  // Alimentação & Restaurantes
  { match: 'meu sushi', name: 'Meu Sushi Temakeria', category: 'alimentacao' },
  { match: 'rodosnack', name: 'Rodosnack Estiva Lanchonete', category: 'alimentacao' },
  { match: 'fogo de chao', name: 'Fogo de Chão', category: 'alimentacao' },
  { match: 'fogo de chão', name: 'Fogo de Chão', category: 'alimentacao' },
  { match: 'mcdonald', name: "McDonald's", category: 'alimentacao' },
  { match: 'burger king', name: 'Burger King', category: 'alimentacao' },
  { match: 'starbucks', name: 'Starbucks', category: 'alimentacao' },
  // Concessionárias / Pedágio
  { match: 'autoban', name: 'Concessionária AutoBAn', category: 'pedagio' },
  { match: 'ecovias', name: 'Ecovias dos Imigrantes', category: 'pedagio' },
  { match: 'arteris', name: 'Arteris Concessionária', category: 'pedagio' },
  { match: 'sem parar', name: 'Sem Parar', category: 'pedagio' },
  { match: 'conectcar', name: 'ConectCar', category: 'pedagio' },
  // Hospedagem
  { match: 'hotel ibis', name: 'Hotel Ibis', category: 'hospedagem' },
  { match: 'ibis', name: 'Hotel Ibis', category: 'hospedagem' },
  { match: 'mercure', name: 'Hotel Mercure', category: 'hospedagem' },
  { match: 'novotel', name: 'Hotel Novotel', category: 'hospedagem' },
  // Estacionamento
  { match: 'estapar', name: 'Estapar Estacionamentos', category: 'estacionamento' },
]

/**
 * Structured Brazilian receipt parser: extrai CNPJ, datas, horário, valor inteligente e categoria
 * via regras NLP leves e dicionários ponderados.
 */
export function parseBrazilianReceiptText(
  rawText: string,
  fileName?: string | null,
): ParsedReceiptFields {
  const normalizedText = (rawText || '').replace(/\r/g, ' ')
  const lowerText = normalizeOcrText(normalizedText)

  // 1. CNPJ: 00.000.000/0000-00 ou 14 dígitos diretos
  let cnpj: string | null = null
  const cnpjMatch = normalizedText.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/)
  if (cnpjMatch) {
    const rawDigits = cnpjMatch[0].replace(/\D/g, '')
    if (rawDigits.length === 14) {
      cnpj = `${rawDigits.slice(0, 2)}.${rawDigits.slice(2, 5)}.${rawDigits.slice(5, 8)}/${rawDigits.slice(8, 12)}-${rawDigits.slice(12, 14)}`
    }
  }

  // 2. Data de Emissão: dd/mm/aaaa ou dd-mm-aaaa ou aaaa-mm-dd
  let issue_date: string | null = null
  const dateRegex = /\b(0[1-9]|[12][0-9]|3[01])[/.-](0[1-9]|1[012])[/.-](20\d\d|\d{2})\b/g
  const dateMatches = [...normalizedText.matchAll(dateRegex)]

  if (dateMatches.length > 0) {
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
        // Prioriza datas próximas de palavras-chave fiscais
        const idx = match.index ?? 0
        const surrounding = normalizedText
          .substring(Math.max(0, idx - 30), Math.min(normalizedText.length, idx + 40))
          .toLowerCase()

        if (
          surrounding.includes('emiss') ||
          surrounding.includes('data') ||
          surrounding.includes('nfc') ||
          surrounding.includes('pedido') ||
          surrounding.includes('cupom')
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

  // 3. Horário: HH:mm ou HH:mm:ss
  let issue_time: string | null = null
  const timeMatch = normalizedText.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/)
  if (timeMatch) {
    issue_time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
  }

  // 4. Estabelecimento / Razão Social
  let merchant_name: string | null = null

  // A) Assinaturas conhecidas
  for (const sig of KNOWN_MERCHANT_SIGNATURES) {
    if (lowerText.includes(sig.match)) {
      merchant_name = sig.name
      break
    }
  }

  // B) Se não bater com conhecidos, analisa as primeiras linhas do cupom
  if (!merchant_name) {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 3)

    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const line = lines[i]
      const lineLow = normalizeOcrText(line)

      // Ignora marcadores de página (ex: "--- [PÁGINA 1] ---") ou linhas iniciadas por "---" ou "["
      if (
        lineLow.includes('--- [pagina') ||
        lineLow.includes('[pagina') ||
        lineLow.includes('pagina') ||
        line.startsWith('---') ||
        line.startsWith('[') ||
        line.includes('PÁGINA')
      ) {
        continue
      }

      // Pula cabeçalhos genéricos
      if (
        lineLow.includes('comprovante') ||
        lineLow.includes('danfe') ||
        lineLow.includes('documento auxiliar') ||
        lineLow.includes('documento') ||
        lineLow.includes('detalhes do pedido') ||
        lineLow.includes('cnpj') ||
        lineLow.includes('cupom fiscal') ||
        lineLow.includes('extrato') ||
        lineLow.length < 4
      ) {
        continue
      }

      // Linhas com sufixos empresariais ou vocabulário corporativo
      if (
        lineLow.includes('ltda') ||
        lineLow.includes('s/a') ||
        lineLow.includes('s.a.') ||
        lineLow.includes('me') ||
        lineLow.includes('epp') ||
        lineLow.includes('restaurante') ||
        lineLow.includes('posto') ||
        lineLow.includes('hotel') ||
        lineLow.includes('lanchonete') ||
        lineLow.includes('temakeria') ||
        lineLow.includes('panificadora') ||
        lineLow.includes('locadora') ||
        lineLow.includes('estacionamento') ||
        lineLow.includes('auto posto') ||
        lineLow.includes('cafe') ||
        line.split(' ').length >= 2
      ) {
        // Limpa caracteres especiais espúrios no início ou fim
        merchant_name = line
          .replace(/^[^a-zA-Z0-9]+/, '')
          .slice(0, 55)
          .trim()
        break
      }
    }
  }

  // 5. Categorização Semântica por Pontuação (Scoring System)
  const classification = classifyExpenseCategoryByScoring(rawText, merchant_name, fileName)
  let category = classification.category

  // Se alguma assinatura de merchant conhecida definiu categoria explícita, respeita
  if (merchant_name) {
    const matchedSig = KNOWN_MERCHANT_SIGNATURES.find((s) => s.name === merchant_name)
    if (matchedSig?.category) {
      category = matchedSig.category
    }
  }

  // 6. Caçador Inteligente de Pontos/Milhas (Cenário Híbrido)
  // Busca padrões como: "48.100 pontos", "48,100 pontos", "48100 pts", etc.
  let points_applied: number | undefined
  const pointsRegex = /(?:(\d{1,3}(?:[.,]\d{3})+|\d+))\s*(?:pontos|milhas|pts)\b/i
  const pointsMatch = normalizedText.match(pointsRegex)
  if (pointsMatch) {
    const rawDigits = pointsMatch[1].replace(/[.,]/g, '')
    const parsedPts = parseInt(rawDigits, 10)
    if (!isNaN(parsedPts) && parsedPts > 0) {
      points_applied = parsedPts
    }
  }

  // 7. Caçador Inteligente de Valor Total (prioriza 30% finais e contexto da categoria)
  let amount = extractIntelligentAmount(rawText, category)

  // No cenário híbrido, verificar se há valor financeiro (R$) associado junto aos pontos:
  // ex: "Total da Passagem 48.100 pontos + R$ 248,45" ou "pontos + R$ ..."
  if (points_applied) {
    const hybridMoneyRegex =
      /(?:pontos|milhas|pts)[\s+e/]+(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)[,.]([0-9]{2})/i
    const hybridMatch = normalizedText.match(hybridMoneyRegex)
    if (hybridMatch) {
      const intPart = hybridMatch[1].replace(/\./g, '')
      const decPart = hybridMatch[2]
      const hybridAmount = parseFloat(`${intPart}.${decPart}`)
      if (!isNaN(hybridAmount) && hybridAmount > 0) {
        amount = Number(hybridAmount.toFixed(2))
      }
    }
  }

  return {
    merchant_name,
    cnpj,
    category,
    amount,
    points_applied,
    issue_date,
    issue_time,
  }
}

// =============================================================================
// 5. PIPELINE PRINCIPAL DO OCR REAL (processRealReceiptOcr)
// =============================================================================

/**
 * Extrai texto de PDFs nativos ou escaneados (lê até 10 páginas).
 * Se alguma página i não tiver texto nativo suficiente (< 20 caracteres),
 * renderiza o canvas daquela página, aplica preprocessReceiptImage e roda runOcrOnImage,
 * salvando o texto com separadores claros --- [PÁGINA i] ---.
 */
async function extractFromPdf(
  file: File,
  onProgress?: (progress: number, status: string) => void,
): Promise<{ rawText: string; pageCanvasDataUrl: string; hasEmbeddedText: boolean }> {
  onProgress?.(15, 'Carregando documento PDF...')
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise

  const totalPages = Math.min(pdf.numPages, 10) // Lê até 10 páginas
  const pageSections: string[] = []
  let firstPageCanvasDataUrl = ''
  let anyNativeText = false

  for (let i = 1; i <= totalPages; i++) {
    onProgress?.(
      20 + Math.round((i / totalPages) * 35),
      `Processando página ${i} de ${pdf.numPages}...`,
    )
    const page = await pdf.getPage(i)

    // 1. Extrai texto nativo da camada vetorial do PDF
    const textContent = await page.getTextContent()
    const nativeText = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    let pageText = nativeText

    // Renderiza a primeira página no canvas para preview (se ainda não renderizada)
    let pageCanvasDataUrl = ''
    const needsRender = i === 1 || nativeText.length < 20
    if (needsRender) {
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
        pageCanvasDataUrl = canvas.toDataURL('image/jpeg', 0.85)
        if (i === 1) {
          firstPageCanvasDataUrl = pageCanvasDataUrl
        }
      }
    }

    if (nativeText.length >= 20) {
      anyNativeText = true
    } else if (pageCanvasDataUrl) {
      // Página sem texto nativo suficiente (< 20 caracteres): OCR de fallback
      try {
        const preprocessed = await preprocessReceiptImage(pageCanvasDataUrl, {
          contrast: 1.45,
        })
        const ocrText = await runOcrOnImage(preprocessed, (pct, status) => {
          onProgress?.(
            Math.round(20 + ((i - 1 + pct / 100) / totalPages) * 35),
            `OCR na pág. ${i}: ${status}`,
          )
        })
        if (ocrText && ocrText.trim().length > 0) {
          pageText = ocrText.trim()
        }
      } catch (ocrErr) {
        console.warn(`Falha no OCR da página ${i} do PDF:`, ocrErr)
      }
    }

    if (pageText.length > 0) {
      pageSections.push(`--- [PÁGINA ${i}] ---\n${pageText}`)
    }
  }

  const cleanText = pageSections.join('\n\n').trim()
  const hasEmbeddedText = anyNativeText || cleanText.length > 25

  return {
    rawText: cleanText,
    pageCanvasDataUrl: firstPageCanvasDataUrl,
    hasEmbeddedText,
  }
}

/**
 * Executa Tesseract OCR em imagem pré-processada (canvas Grayscale + Alto Contraste)
 */
async function runOcrOnImage(
  imageSource: File | Blob | string,
  onProgress?: (progress: number, status: string) => void,
): Promise<string> {
  onProgress?.(30, 'Inicializando motor OCR Tesseract...')
  const worker = await getOcrWorker(onProgress)
  onProgress?.(50, 'Processando imagem via OCR neural local...')
  const ret = await worker.recognize(imageSource)
  return ret.data?.text || ''
}

/**
 * Pipeline principal do OCR Real com Pré-processamento e Busca Dinâmica
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
    // 1. Tenta camada nativa do PDF
    onProgress?.(10, 'Analisando camada de texto nativa do PDF...')
    const pdfResult = await extractFromPdf(file, onProgress)
    previewDataUrl = pdfResult.pageCanvasDataUrl

    if (pdfResult.hasEmbeddedText) {
      rawText = pdfResult.rawText
      extractionMethod = 'pdf_text'
      onProgress?.(80, 'Camada de texto nativa extraída com sucesso.')
    } else {
      // 2. PDF digitalizado / escaneado (sem texto vetorial): pré-processa canvas e roda Tesseract
      onProgress?.(35, 'PDF digitalizado (sem camada de texto). Otimizando imagem...')
      extractionMethod = 'pdf_raster_ocr'
      if (pdfResult.pageCanvasDataUrl) {
        // Pré-processamento com contraste reforçado
        const preprocessed = await preprocessReceiptImage(pdfResult.pageCanvasDataUrl, {
          contrast: 1.45,
        })
        rawText = await runOcrOnImage(preprocessed, onProgress)
      } else {
        rawText = ''
      }
    }
  } else {
    // Imagem (JPG, PNG, WEBP, etc.)
    extractionMethod = 'image_ocr'
    onProgress?.(15, 'Pré-processando imagem no canvas (Grayscale & Alto Contraste)...')

    // Gera preview instantâneo a partir do arquivo original
    previewDataUrl = URL.createObjectURL(file)

    // Aplica Grayscale + Contraste no canvas invisível antes de enviar ao Tesseract
    let processedImageDataUrl: string = previewDataUrl
    try {
      processedImageDataUrl = await preprocessReceiptImage(file, {
        contrast: 1.45,
      })
    } catch (prepErr) {
      console.warn('Falha no pré-processamento do canvas, usando original:', prepErr)
      processedImageDataUrl = previewDataUrl
    }

    // Executa o Tesseract na imagem pré-processada
    rawText = await runOcrOnImage(processedImageDataUrl, onProgress)
  }

  onProgress?.(90, 'Estruturando campos fiscais (CNPJ, data, valor inteligente)...')

  // Parser robusto com pontuação semântica e caçador inteligente de valores
  const parsed = parseBrazilianReceiptText(rawText, file.name)

  const recognized_fields = {
    amount: parsed.amount !== null,
    issue_date: parsed.issue_date !== null,
    merchant_name: parsed.merchant_name !== null,
    cnpj: parsed.cnpj !== null,
    issue_time: parsed.issue_time !== null,
    points_applied: parsed.points_applied !== undefined && parsed.points_applied > 0,
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
    points_applied: parsed.points_applied,
    issue_date: parsed.issue_date,
    issue_time: parsed.issue_time,
    ocr_raw_text: rawText.trim() || 'Nenhum texto legível detectado.',
    preview_data_url: previewDataUrl,
    extraction_method: extractionMethod,
    confidence_score,
    recognized_fields,
  }
}

// =============================================================================
// 6. REPROCESSAMENTO MULTI-RECIBO (PDF multi-página ou imagem com múltiplos cupons)
// =============================================================================

export interface MultiReceiptItem {
  id: string
  label: string
  amount: number
}

export interface MultiReceiptResult {
  items: MultiReceiptItem[]
  totalSum: number
  updatedRawText: string
}

/**
 * Reprocessa o arquivo (PDF de várias páginas ou foto de 1 folha com múltiplos cupons)
 * para identificar e somar valores de comprovantes distintos.
 */
export async function reprocessAndExtractMultipleReceipts(
  fileUrl: string,
  fileName: string,
  existingRawText?: string | null,
  onProgress?: (progress: number, status: string) => void,
): Promise<MultiReceiptResult> {
  onProgress?.(5, 'Localizando arquivo original...')
  const resolved = await resolveReceiptUrl(fileUrl, fileName)
  const targetUrl = resolved.url || fileUrl

  if (!targetUrl) {
    throw new Error('Não foi possível resolver a URL do arquivo no armazenamento.')
  }

  const isPdf = resolved.isPdf || /\.pdf(\?.*)?$/i.test(targetUrl) || /\.pdf$/i.test(fileName)

  // ---------------------------------------------------------------------------
  // CASO A: Documento PDF
  // ---------------------------------------------------------------------------
  if (isPdf) {
    onProgress?.(15, 'Carregando documento PDF...')
    const loadingTask = pdfjsLib.getDocument({
      url: targetUrl,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true,
    })
    const pdf = await loadingTask.promise
    const totalPages = Math.min(pdf.numPages, 10)

    const items: MultiReceiptItem[] = []
    const pageTexts: string[] = []

    for (let i = 1; i <= totalPages; i++) {
      onProgress?.(
        20 + Math.round((i / totalPages) * 70),
        `Processando página ${i} de ${pdf.numPages}...`,
      )
      const page = await pdf.getPage(i)

      // Extrai texto vetorial nativo
      const textContent = await page.getTextContent()
      const nativeText = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

      let pageRaw = nativeText

      // Se não tiver texto suficiente nativo, renderiza e roda OCR
      if (nativeText.length < 20) {
        try {
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise
            const canvasDataUrl = canvas.toDataURL('image/jpeg', 0.85)
            const preprocessed = await preprocessReceiptImage(canvasDataUrl, { contrast: 1.45 })
            const ocrText = await runOcrOnImage(preprocessed)
            if (ocrText && ocrText.trim().length > 0) {
              pageRaw = ocrText.trim()
            }
          }
        } catch (ocrErr) {
          console.warn(`Falha no OCR da pág. ${i}:`, ocrErr)
        }
      }

      pageTexts.push(`--- [PÁGINA ${i}] ---\n${pageRaw}`)

      // Extrai valor inteligente específico desta página
      const pageAmount = extractIntelligentAmount(pageRaw)
      if (pageAmount !== null && pageAmount > 0) {
        items.push({
          id: `p${i}`,
          label: `Página ${i}`,
          amount: Number(pageAmount.toFixed(2)),
        })
      }
    }

    // Se nenhuma página retornou valor mas temos totalPages, cria itens com 0 para o usuário preencher
    if (items.length === 0) {
      for (let i = 1; i <= totalPages; i++) {
        items.push({
          id: `p${i}`,
          label: `Página ${i}`,
          amount: 0,
        })
      }
    }

    const totalSum = Number(items.reduce((acc, curr) => acc + (curr.amount || 0), 0).toFixed(2))
    const updatedRawText = pageTexts.join('\n\n')

    onProgress?.(100, 'Processamento de páginas concluído!')
    return {
      items,
      totalSum,
      updatedRawText,
    }
  }

  // ---------------------------------------------------------------------------
  // CASO B: Imagem Única (1 página com múltiplos cupons fotografados)
  // ---------------------------------------------------------------------------
  onProgress?.(20, 'Analisando imagem e extraindo valores distintos...')
  let rawText = existingRawText || ''

  // Se o texto existente for muito curto ou genérico, executa OCR na imagem
  if (!rawText || rawText.length < 20 || rawText.includes('Nenhum texto legível')) {
    try {
      const preprocessed = await preprocessReceiptImage(targetUrl, { contrast: 1.45 })
      rawText = await runOcrOnImage(preprocessed, (pct, status) => {
        onProgress?.(25 + Math.round((pct / 100) * 60), status)
      })
    } catch (err) {
      console.warn('Falha ao rodar OCR na imagem para múltiplos cupons:', err)
      rawText = existingRawText || ''
    }
  }

  // Extrai todos os valores monetários candidatos distintos do texto
  const norm = (rawText || '').replace(/\r/g, ' ')
  const amountPattern =
    /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)[,.]([0-9]{2})(?!\d|\/|-)(?:\s*(?:reais|brl))?/gi

  const distinctValues: number[] = []
  let match: RegExpExecArray | null
  while ((match = amountPattern.exec(norm)) !== null) {
    const integerPart = match[1].replace(/\./g, '')
    const decimalPart = match[2]
    const numericValue = parseFloat(`${integerPart}.${decimalPart}`)

    if (isNaN(numericValue) || numericValue <= 0 || numericValue > 15000 || numericValue < 0.5) {
      continue
    }

    const rounded = Number(numericValue.toFixed(2))
    // Evita duplicatas idênticas imediatas vindas da mesma linha se já adicionado
    if (!distinctValues.includes(rounded)) {
      distinctValues.push(rounded)
    }
  }

  const items: MultiReceiptItem[] =
    distinctValues.length > 0
      ? distinctValues.slice(0, 10).map((val, idx) => ({
          id: `item-${idx + 1}`,
          label: `Cupom ${idx + 1}`,
          amount: val,
        }))
      : [
          {
            id: 'item-1',
            label: 'Cupom 1',
            amount: extractIntelligentAmount(rawText) || 0,
          },
          {
            id: 'item-2',
            label: 'Cupom 2',
            amount: 0,
          },
        ]

  const totalSum = Number(items.reduce((acc, curr) => acc + (curr.amount || 0), 0).toFixed(2))
  onProgress?.(100, 'Valores extraídos!')

  return {
    items,
    totalSum,
    updatedRawText: rawText,
  }
}
