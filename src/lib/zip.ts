// Batch download: fetch each item's original through /api/download (same-origin, correct types)
// and pack them into a ZIP in the browser with fflate. Files are stored (not deflated) — images and
// model files don't compress meaningfully, and storing keeps memory and CPU low.
import { Zip, ZipPassThrough } from 'fflate'
import type { Item } from '../../shared/types'
import { downloadUrl } from './api'
import { fetchItemFile, type BatchSize } from './download'

export interface ZipProgress {
  done: number
  total: number
  failed: string[]
}

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="([^"]+)"/)
  return m ? decodeURIComponent(m[1]) : fallback
}

export async function zipItems(items: Item[], onProgress: (p: ZipProgress) => void, signal?: AbortSignal, size: BatchSize = 'orig'): Promise<Blob> {
  const chunks: Uint8Array[] = []
  const zip = new Zip((err, chunk) => {
    if (err) throw err
    chunks.push(chunk)
  })
  const progress: ZipProgress = { done: 0, total: items.length, failed: [] }
  const used = new Set<string>()
  const manifest: string[] = ['title\tsource\tcreator\tdate\trights\trecord url\tfile']
  let idx = 0
  const worker = async () => {
    while (idx < items.length) {
      const item = items[idx++]
      if (signal?.aborted) return
      try {
        const { blob, name: fetchedName } = await fetchItemFile(item, size, signal)
        const buf = new Uint8Array(await blob.arrayBuffer())
        let name = fetchedName
        let n = 1
        while (used.has(name)) name = name.replace(/(\.[a-z0-9]+)$/i, `-${++n}$1`)
        used.add(name)
        const f = new ZipPassThrough(name)
        zip.add(f)
        f.push(buf, true)
        manifest.push([item.title, item.sourceName, item.creator || '', item.dateDisplay || '', item.rightsLabel, item.sourceUrl, name].map((s) => String(s).replace(/\s+/g, ' ')).join('\t'))
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        progress.failed.push(item.title)
      }
      progress.done++
      onProgress({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  const m = new ZipPassThrough('manifest.tsv')
  zip.add(m)
  m.push(new TextEncoder().encode(manifest.join('\n')), true)
  zip.end()
  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}

function slug(s: string) {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'untitled'
}
function extOf(item: Item) {
  const u = item.originalImageUrl || item.imageUrl || ''
  const m = u.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : 'jpg'
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

// Downloads one file through the proxy, falling back to a direct CORS fetch if the proxy was blocked
// upstream, and saves it with a proper filename. Used for single-image downloads in the viewer.
export async function downloadItem(item: Item, fileIdx: number | 'image' = 'image'): Promise<void> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 60000)
  try {
    return await downloadItemInner(item, fileIdx, ctrl.signal)
  } finally {
    clearTimeout(t)
  }
}

async function downloadItemInner(item: Item, fileIdx: number | 'image', signal: AbortSignal): Promise<void> {
  let res = await fetch(downloadUrl(item, fileIdx), { redirect: 'manual', signal })
  let name = filenameFrom(res, `${item.source}-${slug(item.id.split(':').pop() || '')}-${slug(item.title)}.${extOf(item)}`)
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.status === 502) {
    // proxy blocked upstream → try renditions directly over CORS, largest first
    const candidates = (fileIdx === 'image' ? [item.originalImageUrl, item.imageUrl, item.thumbnailUrl] : [item.files[fileIdx]?.url]).filter(Boolean) as string[]
    let last: Error = new Error('No file available')
    for (const direct of candidates) {
      try {
        res = await fetch(direct, { mode: 'cors', signal })
        if (res.ok) break
        last = new Error(`Download failed (${res.status})`)
      } catch (e) {
        last = e as Error
      }
    }
    if (!res.ok) throw new Error(`This image's host is blocking downloads — open the original record to save it. (${last.message})`)
  }
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  saveBlob(await res.blob(), name)
}

export function triggerDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
