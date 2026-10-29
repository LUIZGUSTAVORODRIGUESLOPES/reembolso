import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  FileQuestion,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  AlertCircle,
  ExternalLink,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { resolveReceiptUrl } from '@/services/receiptFileResolver'

// Configure PDF.js worker
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
}

interface DocumentViewerProps {
  fileName: string
  fileUrl: string
  ocrRawText?: string | null
  onDocumentLoaded?: (info: { isPdf: boolean; totalPages: number }) => void
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  fileName,
  fileUrl,
  ocrRawText,
  onDocumentLoaded,
}) => {
  // Navigation & Zoom & Rotation state
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)

  // URL resolution state
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)
  const [isImage, setIsImage] = useState(false)
  const [resolving, setResolving] = useState(true)

  // PDF specific state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  // Image load error
  const [imgError, setImgError] = useState(false)

  // Canvas ref for PDF rendering
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<any>(null)

  // Image loading state & timeout
  const [imgLoading, setImgLoading] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  // Reset zoom & rotation when document changes
  useEffect(() => {
    setZoom(100)
    setRotation(0)
    setCurrentPage(1)
    setTotalPages(1)
    setPdfDoc(null)
    setPdfError(null)
    setImgError(false)
    setImgLoading(false)
  }, [fileName, fileUrl, retryKey])

  // Resolve URL with safety timeout (max 4.5s)
  useEffect(() => {
    let active = true
    setResolving(true)

    // Timeout safety net: resolveReceiptUrl must never hang indefinitely
    const resolveTimer = setTimeout(() => {
      if (!active) return
      console.warn('Timeout resolving receipt URL for:', fileName)
      setResolving(false)
      // If we don't have a resolved url yet, fallback to fileUrl if present
      if (fileUrl && fileUrl.trim().length > 0) {
        const isDataImg = fileUrl.trim().startsWith('data:image/')
        setResolvedUrl(fileUrl.trim())
        setIsImage(isDataImg || !fileUrl.toLowerCase().endsWith('.pdf'))
        setIsPdf(!isDataImg && fileUrl.toLowerCase().endsWith('.pdf'))
      } else {
        setResolvedUrl(null)
      }
    }, 4500)

    resolveReceiptUrl(fileUrl, fileName)
      .then((res) => {
        if (!active) return
        clearTimeout(resolveTimer)
        setResolvedUrl(res.url)
        setIsPdf(res.isPdf)
        setIsImage(res.isImage)
        setResolving(false)
        if (!res.isPdf && res.url) {
          onDocumentLoaded?.({ isPdf: false, totalPages: 1 })
        }
      })
      .catch((err) => {
        if (!active) return
        clearTimeout(resolveTimer)
        console.warn('Error resolving receipt URL:', err)
        setResolvedUrl(null)
        setResolving(false)
      })

    return () => {
      active = false
      clearTimeout(resolveTimer)
    }
  }, [fileUrl, fileName, onDocumentLoaded, retryKey])

  // Image decode & load timeout (max 5s)
  useEffect(() => {
    if (!resolvedUrl || isPdf) {
      setImgLoading(false)
      return
    }

    setImgLoading(true)
    setImgError(false)

    // Watchdog timer in case img onLoad / onError never fires (e.g. malformed data: URL)
    const imgTimer = setTimeout(() => {
      setImgLoading((currentLoading) => {
        if (currentLoading) {
          console.warn('Watchdog timeout: image failed to load within 5s for', fileName)
          setImgError(true)
          return false
        }
        return false
      })
    }, 5000)

    return () => {
      clearTimeout(imgTimer)
    }
  }, [resolvedUrl, isPdf, fileName, retryKey])

  // Load PDF when resolved URL is identified as PDF (with 7s timeout safeguard)
  useEffect(() => {
    if (!resolvedUrl || !isPdf) {
      setPdfDoc(null)
      return
    }

    let active = true
    setPdfLoading(true)
    setPdfError(null)

    const pdfTimeout = setTimeout(() => {
      if (!active) return
      console.warn('PDF loading timed out for:', fileName)
      setPdfError('Tempo esgotado ao carregar o PDF.')
      setPdfLoading(false)
    }, 7000)

    const loadingTask = pdfjsLib.getDocument({
      url: resolvedUrl,
      // Suppress console warnings for fonts/cMaps if missing
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true,
    })

    loadingTask.promise
      .then((doc) => {
        if (!active) return
        clearTimeout(pdfTimeout)
        setPdfDoc(doc)
        setTotalPages(doc.numPages)
        setPdfLoading(false)
        onDocumentLoaded?.({ isPdf: true, totalPages: doc.numPages })
      })
      .catch((err) => {
        if (!active) return
        clearTimeout(pdfTimeout)
        console.warn('Failed to load PDF document:', err)
        setPdfError('Não foi possível processar as páginas deste arquivo PDF.')
        setPdfLoading(false)
      })

    return () => {
      active = false
      clearTimeout(pdfTimeout)
      loadingTask.destroy()
    }
  }, [resolvedUrl, isPdf, onDocumentLoaded, retryKey, fileName])

  // Render current PDF page on canvas
  const renderPdfPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return

    try {
      const page = await pdfDoc.getPage(currentPage)
      const canvas = canvasRef.current
      if (!canvas) return

      // Cancel previous render task if active
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }

      // Base scale: 1.5 for clear desktop text rendering
      const viewport = page.getViewport({ scale: 1.5 })
      const context = canvas.getContext('2d')
      if (!context) return

      canvas.width = viewport.width
      canvas.height = viewport.height

      const renderContext = {
        canvasContext: context,
        viewport,
      }

      const task = page.render(renderContext)
      renderTaskRef.current = task
      await task.promise
      renderTaskRef.current = null
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.warn('Error rendering PDF page:', err)
      }
    }
  }, [pdfDoc, currentPage])

  useEffect(() => {
    if (pdfDoc && isPdf) {
      renderPdfPage()
    }
  }, [pdfDoc, currentPage, isPdf, renderPdfPage])

  // Zoom and Rotate controls
  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 25, 200))
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 25, 50))
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360)

  const handlePrevPage = () => setCurrentPage((p) => Math.max(p - 1, 1))
  const handleNextPage = () => setCurrentPage((p) => Math.min(p + 1, totalPages))

  // Determine state
  const hasNoFile = !resolving && !resolvedUrl
  const hasRenderError = (isPdf && pdfError) || (isImage && imgError)

  return (
    <Card className="border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* Viewer Toolbar */}
      <div className="bg-slate-100/90 border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
        <div className="flex items-center gap-1.5 min-w-0">
          {isPdf ? (
            <FileText className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          ) : (
            <FileQuestion className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          )}
          <span
            className="font-semibold text-slate-800 truncate max-w-[170px] sm:max-w-[220px]"
            title={fileName}
          >
            {fileName || 'Comprovante'}
          </span>

          {/* Page counter & navigation for multi-page PDFs */}
          {isPdf && totalPages > 1 && (
            <>
              <span className="text-slate-300">|</span>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={currentPage <= 1}
                  className="h-6 w-6 p-0 text-slate-600 hover:text-slate-900"
                  title="Página anterior"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-[11px] font-medium text-slate-600 px-1 tabular-nums">
                  Pág. {currentPage} de {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={currentPage >= totalPages}
                  className="h-6 w-6 p-0 text-slate-600 hover:text-slate-900"
                  title="Próxima página"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </>
          )}

          {isPdf && totalPages === 1 && (
            <>
              <span className="text-slate-300">|</span>
              <span className="text-[11px] text-slate-500">Página 1 de 1</span>
            </>
          )}

          {!isPdf && resolvedUrl && (
            <>
              <span className="text-slate-300">|</span>
              <span className="text-[11px] text-slate-500">Imagem</span>
            </>
          )}
        </div>

        {/* Zoom, rotate & action buttons */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {resolvedUrl && !hasRenderError && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomOut}
                disabled={zoom <= 50}
                className="h-7 w-7 p-0"
                title="Diminuir zoom"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[11px] font-bold tabular-nums w-10 text-center">{zoom}%</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomIn}
                disabled={zoom >= 200}
                className="h-7 w-7 p-0"
                title="Aumentar zoom"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRotate}
                className="h-7 w-7 p-0"
                title="Rotacionar 90°"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </Button>
            </>
          )}

          {resolvedUrl && (
            <a
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-slate-200 text-slate-600 transition-colors"
              title="Abrir arquivo original em nova aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Document Canvas / Image / Fallback Paper Area */}
      <div className="bg-slate-200/60 p-4 sm:p-6 min-h-[480px] max-h-[640px] flex items-center justify-center overflow-auto relative">
        {resolving || (isPdf && pdfLoading) || (!isPdf && imgLoading && !imgError) ? (
          <div className="flex flex-col items-center justify-center text-slate-500 py-16 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[#1e40af]" />
            <p className="text-xs font-medium">Carregando comprovante...</p>
          </div>
        ) : hasNoFile ? (
          /* Friendly Fallback: File not available */
          <div className="text-center p-6 sm:p-8 bg-white/90 rounded-xl border border-slate-300 shadow-sm max-w-sm">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-3">
              <FileQuestion className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-800">Comprovante não disponível</h4>
            <p className="text-xs text-slate-500 mt-1 mb-3">
              O arquivo original <strong>"{fileName}"</strong> não foi encontrado no armazenamento
              ou foi registrado apenas com os dados fiscais do OCR.
            </p>
            <div className="flex items-center justify-center gap-2 mb-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetryKey((k) => k + 1)}
                className="text-xs gap-1.5 h-7"
              >
                <RotateCw className="w-3 h-3" />
                Tentar novamente
              </Button>
            </div>
            {ocrRawText && (
              <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-1 rounded inline-block font-mono">
                Texto fiscal extraído preservado abaixo
              </span>
            )}
          </div>
        ) : hasRenderError ? (
          /* Friendly Fallback: Error rendering file */
          <div className="text-center p-6 sm:p-8 bg-white/95 rounded-xl border border-rose-200 shadow-sm max-w-sm">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-800">Não foi possível exibir o preview</h4>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              A imagem ou PDF não pôde ser renderizado diretamente pelo navegador. Você pode
              conferir os dados pelo OCR ou tentar novamente.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setImgError(false)
                  setPdfError(null)
                  setRetryKey((k) => k + 1)
                }}
                className="text-xs gap-1.5 h-8 border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Tentar novamente
              </Button>
              {resolvedUrl && !resolvedUrl.startsWith('data:') && (
                <a
                  href={resolvedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={fileName}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e40af] text-white text-xs font-semibold rounded-md shadow-xs hover:bg-[#1d3d9e] h-8"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir original
                </a>
              )}
            </div>
          </div>
        ) : isPdf ? (
          /* PDF Canvas Display with Zoom & Rotation applied */
          <div
            className="transition-transform duration-150 ease-out origin-center"
            style={{
              transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
            }}
          >
            <div className="bg-white rounded shadow-lg border border-slate-300 overflow-hidden">
              <canvas ref={canvasRef} className="max-w-[440px] w-full h-auto select-none block" />
            </div>
          </div>
        ) : (
          /* Image (JPG, PNG, WEBP, etc.) Display */
          <div
            className="bg-white rounded shadow-lg border border-slate-300 transition-transform duration-150 ease-out origin-center overflow-hidden"
            style={{
              transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
            }}
          >
            <img
              src={resolvedUrl || fileUrl}
              alt={`Comprovante ${fileName}`}
              onLoad={() => {
                setImgLoading(false)
                setImgError(false)
              }}
              onError={() => {
                setImgLoading(false)
                setImgError(true)
              }}
              className="max-w-[420px] w-full h-auto object-contain select-none block"
              draggable={false}
            />
          </div>
        )}
      </div>

      {/* OCR raw text snippet */}
      {ocrRawText && (
        <div className="bg-slate-50 border-t border-slate-200 p-3 text-[11px] text-slate-500 font-mono">
          <span className="font-bold text-slate-700 block mb-0.5">
            TEXTO EXTRAÍDO DO COMPROVANTE (OCR REAL):
          </span>
          <p className="line-clamp-3 text-slate-600 whitespace-pre-line">{ocrRawText}</p>
        </div>
      )}
    </Card>
  )
}
