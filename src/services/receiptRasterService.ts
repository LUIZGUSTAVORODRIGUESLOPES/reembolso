import * as pdfjsLib from 'pdfjs-dist'
import { resolveReceiptUrl } from './receiptFileResolver'

// Configure worker for pdfjs-dist if in browser
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
}

export interface PreparedReceiptPage {
  dataUrl: string // base64 JPEG data URL
  width: number
  height: number
  pageNumber: number
  totalPages: number
}

export interface PreparedReceiptAttachment {
  expenseId: string
  fileName: string
  merchantName: string
  issueDate: string
  amount: number
  category: string
  status: 'success' | 'warning' | 'error'
  errorMessage?: string
  pages: PreparedReceiptPage[]
}

/**
 * Loads an image from a URL or data URL and converts it into a base64 JPEG data URL
 * Uses crossOrigin = 'anonymous' to handle CORS correctly.
 */
async function rasterizeImageToDataUrl(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number }> {
  // If it's already a base64 data URL
  if (url.startsWith('data:image/')) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        resolve({
          dataUrl: url,
          width: img.naturalWidth || 800,
          height: img.naturalHeight || 1000,
        })
      }
      img.onerror = () => reject(new Error('Falha ao processar imagem embutida.'))
      img.src = url
    })
  }

  // Try direct fetch first to avoid canvas taint if CORS allows, else fall back to Image element
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (res.ok) {
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      // Get dimensions
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
        img.src = dataUrl
      })

      return {
        dataUrl,
        width: img.naturalWidth || 800,
        height: img.naturalHeight || 1000,
      }
    }
  } catch {
    // Fetch failed or blocked by CORS, try canvas Image approach
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const maxDimension = 1800
        let w = img.naturalWidth || 800
        let h = img.naturalHeight || 1000

        if (w > maxDimension || h > maxDimension) {
          if (w > h) {
            h = Math.round((h * maxDimension) / w)
            w = maxDimension
          } else {
            w = Math.round((w * maxDimension) / h)
            h = maxDimension
          }
        }

        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 2D context não suportado'))
          return
        }

        // Fill white background (useful for transparent PNGs)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)

        const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
        resolve({ dataUrl, width: w, height: h })
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem do comprovante.'))
    img.src = url
  })
}

/**
 * Loads a PDF from URL/ArrayBuffer and rasterizes all pages (up to maxPages) into base64 JPEG images
 */
async function rasterizePdfToDataUrls(url: string, maxPages = 5): Promise<PreparedReceiptPage[]> {
  let pdfData: Uint8Array | string = url

  // Try fetching as arrayBuffer first to prevent CORS issues inside PDF.js worker
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (response.ok) {
      const buffer = await response.arrayBuffer()
      pdfData = new Uint8Array(buffer)
    }
  } catch (err) {
    console.warn('PDF fetch direct failed, falling back to pdfjs URL loader:', err)
  }

  const loadingTask = pdfjsLib.getDocument(
    typeof pdfData === 'string'
      ? {
          url: pdfData,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
        }
      : {
          data: pdfData,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
        },
  )

  const pdf = await loadingTask.promise
  const totalPages = pdf.numPages
  const pagesToRender = Math.min(totalPages, maxPages)
  const renderedPages: PreparedReceiptPage[] = []

  for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
    const page = await pdf.getPage(pageNum)
    // Scale 1.5 - 2.0 provides sharp print quality without excessive memory usage
    const viewport = page.getViewport({ scale: 1.5 })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Falha ao inicializar contexto de renderização do PDF.')
    }

    // Render white background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
    renderedPages.push({
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      pageNumber: pageNum,
      totalPages,
    })
  }

  return renderedPages
}

/**
 * Prepares a single receipt for printing/consolidation.
 * Resolves the URL, detects whether it's PDF or Image, and renders it to base64 images.
 * If anything fails, returns status: 'error' with clear message so the report can continue.
 */
export async function prepareReceiptAttachment(expense: {
  id: string
  file_url?: string | null
  file_name?: string | null
  merchant_name?: string | null
  issue_date?: string | null
  amount?: number | null
  category?: string | null
}): Promise<PreparedReceiptAttachment> {
  const fileName = expense.file_name || 'comprovante'
  const merchantName = expense.merchant_name || 'Despesa'
  const issueDate = expense.issue_date || ''
  const amount = expense.amount || 0
  const category = expense.category || 'outros'

  try {
    const resolved = await resolveReceiptUrl(expense.file_url, expense.file_name)

    if (!resolved.url) {
      return {
        expenseId: expense.id,
        fileName,
        merchantName,
        issueDate,
        amount,
        category,
        status: 'error',
        errorMessage: `Arquivo "${fileName}" não foi localizado no armazenamento Supabase.`,
        pages: [],
      }
    }

    // If PDF
    if (resolved.isPdf) {
      try {
        const pages = await rasterizePdfToDataUrls(resolved.url)
        if (pages.length === 0) {
          return {
            expenseId: expense.id,
            fileName,
            merchantName,
            issueDate,
            amount,
            category,
            status: 'warning',
            errorMessage: 'O arquivo PDF está vazio ou não possui páginas legíveis.',
            pages: [],
          }
        }

        return {
          expenseId: expense.id,
          fileName,
          merchantName,
          issueDate,
          amount,
          category,
          status: 'success',
          pages,
        }
      } catch (pdfErr: any) {
        console.warn(`Failed to rasterize PDF for ${fileName}:`, pdfErr)
        return {
          expenseId: expense.id,
          fileName,
          merchantName,
          issueDate,
          amount,
          category,
          status: 'error',
          errorMessage: `Erro ao renderizar PDF (${pdfErr?.message || 'Arquivo corrompido ou inacessível'}).`,
          pages: [],
        }
      }
    }

    // If Image (JPG, PNG, WEBP, etc.)
    try {
      const imgData = await rasterizeImageToDataUrl(resolved.url)
      return {
        expenseId: expense.id,
        fileName,
        merchantName,
        issueDate,
        amount,
        category,
        status: 'success',
        pages: [
          {
            dataUrl: imgData.dataUrl,
            width: imgData.width,
            height: imgData.height,
            pageNumber: 1,
            totalPages: 1,
          },
        ],
      }
    } catch (imgErr: any) {
      console.warn(`Failed to rasterize image for ${fileName}:`, imgErr)
      return {
        expenseId: expense.id,
        fileName,
        merchantName,
        issueDate,
        amount,
        category,
        status: 'error',
        errorMessage: `Erro ao carregar a imagem do comprovante (${imgErr?.message || 'CORS ou arquivo ausente'}).`,
        pages: [],
      }
    }
  } catch (err: any) {
    return {
      expenseId: expense.id,
      fileName,
      merchantName,
      issueDate,
      amount,
      category,
      status: 'error',
      errorMessage: err?.message || 'Falha inesperada ao preparar anexo.',
      pages: [],
    }
  }
}
