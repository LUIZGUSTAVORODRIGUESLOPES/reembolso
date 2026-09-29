import { supabase } from '@/lib/supabase/client'

// Cache resolved storage object paths by sanitized base name or exact name
let cachedBucketFiles: string[] | null = null
let cacheExpiry = 0

/**
 * Normalizes a receipt file name to assist matching storage object names.
 * e.g. "20260828-1234 estacionamento.pdf" -> "20260828-1234_estacionamento.pdf"
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.-]/g, '_')
}

/**
 * Lists the filenames in the 'comprovantes' bucket with a short cache
 */
async function getBucketFileNames(): Promise<string[]> {
  const now = Date.now()
  if (cachedBucketFiles && now < cacheExpiry) {
    return cachedBucketFiles
  }

  try {
    const { data, error } = await supabase.storage.from('comprovantes').list('', {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    })

    if (error || !data) {
      console.warn('Error listing bucket comprovantes:', error)
      return cachedBucketFiles || []
    }

    cachedBucketFiles = data.map((item) => item.name)
    cacheExpiry = now + 60_000 // Cache 1 minute
    return cachedBucketFiles
  } catch (err) {
    console.warn('Failed to fetch storage bucket files:', err)
    return cachedBucketFiles || []
  }
}

/**
 * Resolves the viewable URL for an expense file.
 * Handles:
 * 1. Base64 data URLs ("data:...") or blob URLs ("blob:...")
 * 2. Full HTTP/HTTPS URLs (from Supabase or external)
 * 3. Supabase storage relative object path (e.g. "17906..._estacionamento.pdf")
 * 4. Empty or missing file_url: looks up in the 'comprovantes' bucket matching `fileName`
 */
export async function resolveReceiptUrl(
  fileUrl: string | null | undefined,
  fileName: string | null | undefined,
): Promise<{ url: string | null; isPdf: boolean; isImage: boolean }> {
  const trimmedUrl = fileUrl?.trim() || ''
  const trimmedName = fileName?.trim() || ''

  // Determine file type from extension
  const testTarget =
    (trimmedUrl.startsWith('http') || !trimmedUrl.includes('base64')) && trimmedUrl
      ? trimmedUrl
      : trimmedName

  const isPdf = /\.pdf(\?.*)?$/i.test(testTarget) || /\.pdf$/i.test(trimmedName)
  const isImage =
    /\.(jpe?g|png|webp|gif|bmp|svg)(\?.*)?$/i.test(testTarget) ||
    /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(trimmedName) ||
    trimmedUrl.startsWith('data:image/')

  // 1. If we already have a valid data: or blob: URL
  if (trimmedUrl.startsWith('data:') || trimmedUrl.startsWith('blob:')) {
    return { url: trimmedUrl, isPdf, isImage }
  }

  // 2. If we have a full http(s) URL
  if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
    return { url: trimmedUrl, isPdf, isImage }
  }

  // 3. If fileUrl contains a storage object path
  if (trimmedUrl.length > 0 && !trimmedUrl.includes('/')) {
    const { data } = supabase.storage.from('comprovantes').getPublicUrl(trimmedUrl)
    if (data?.publicUrl) {
      return { url: data.publicUrl, isPdf, isImage }
    }
  }

  // 4. Fallback: fileUrl is empty or wasn't saved, try finding a match in the bucket using fileName
  if (trimmedName) {
    const files = await getBucketFileNames()
    const cleanTarget = normalizeName(trimmedName)

    // Look for file ending with cleanTarget or containing distinctive date-time part
    const match = files.find((f) => {
      const low = f.toLowerCase()
      if (low.endsWith(cleanTarget)) return true
      if (low.includes(cleanTarget.replace('.pdf', '').replace(/\.[a-z]+$/, ''))) return true
      return false
    })

    if (match) {
      const { data } = supabase.storage.from('comprovantes').getPublicUrl(match)
      if (data?.publicUrl) {
        return { url: data.publicUrl, isPdf, isImage }
      }
    }
  }

  return { url: null, isPdf, isImage }
}
