// Batch download: fetch each item's original through /api/download (same-origin, correct types)
// and pack them into a ZIP in the browser with fflate. Files are stored (not deflated) — images and
// model files don't compress meaningfully, and storing keeps memory and CPU low.
import { Zip, ZipPassThrough } from 'fflate'
import type { Item } from '../../shared/types'
import { downloadUrl } from './api'

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

export async function zipItems(items: Item[], onProgress: (p: ZipProgress) => void, signal?: AbortSignal): Promise<Blob> {
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
      const fileIdx = item.contentType === '3d' ? 0 : 'image'
      try {
        const res = await fetch(downloadUrl(item, fileIdx), { signal })
        if (!res.ok) throw new Error(String(res.status))
        const buf = new Uint8Array(await res.arrayBuffer())
        let name = filenameFrom(res, `${item.source}-${item.id.split(':').pop()}.bin`)
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
  await Promise.all(Array.from({ length: 3 }, worker))
  const m = new ZipPassThrough('manifest.tsv')
  zip.add(m)
  m.push(new TextEncoder().encode(manifest.join('\n')), true)
  zip.end()
  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
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

export function triggerDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
