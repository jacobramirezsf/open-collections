// Batch download plumbing shared by the "individual files" and ZIP paths.
// Files stream through /api/download (correct type + filename); when a museum CDN blocks our proxy
// (302/502 responses, e.g. AIC), the browser fetches the original directly over CORS instead.
import type { Item } from '../../shared/types'
import { downloadUrl } from './api'
import { saveBlob } from './zip'

export type BatchSize = 'orig' | 'view'

export interface BatchProgress {
  done: number
  total: number
  failed: string[]
}

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="([^"]+)"/)
  return m ? decodeURIComponent(m[1]) : fallback
}

function slugify(s: string, max = 50) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'untitled'
}

function fallbackName(item: Item): string {
  const u = item.originalImageUrl || item.imageUrl || ''
  const m = u.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i)
  const ext = item.contentType === '3d' ? 'bin' : m ? m[1].toLowerCase() : 'jpg'
  return `${item.source}-${slugify(item.id.split(':').pop() || '', 40)}-${slugify(item.title)}.${ext}`
}

export async function fetchItemFile(item: Item, size: BatchSize, signal?: AbortSignal): Promise<{ blob: Blob; name: string }> {
  const fileIdx = item.contentType === '3d' ? 0 : 'image'
  const url = downloadUrl(item, fileIdx) + (size === 'view' && item.contentType !== '3d' ? '&size=view' : '')
  let res = await fetch(url, { signal, redirect: 'manual' })
  let name = filenameFrom(res, fallbackName(item))
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.status === 502) {
    const direct = item.contentType === '3d' ? item.files[0]?.url : size === 'view' ? item.imageUrl || item.originalImageUrl : item.originalImageUrl || item.imageUrl
    if (!direct) throw new Error('no url')
    res = await fetch(direct, { signal, mode: 'cors' })
  }
  if (!res.ok) throw new Error(String(res.status))
  const blob = await res.blob()
  if (!blob.size) throw new Error('empty file')
  return { blob, name }
}

// Saves each selected item as its own file (the browser will ask once to allow multiple downloads).
// Files appear progressively, which feels much faster than waiting for one big ZIP.
export async function downloadFiles(items: Item[], size: BatchSize, onProgress: (p: BatchProgress) => void, signal?: AbortSignal): Promise<BatchProgress> {
  const progress: BatchProgress = { done: 0, total: items.length, failed: [] }
  const used = new Set<string>()
  let idx = 0
  const worker = async () => {
    while (idx < items.length && !signal?.aborted) {
      const item = items[idx++]
      try {
        const { blob, name } = await fetchItemFile(item, size, signal)
        let final = name
        let n = 1
        while (used.has(final)) final = name.replace(/(\.[a-z0-9]+)$/i, `-${++n}$1`)
        used.add(final)
        if (items.length === 1) await (await import('./save')).saveImage(blob, final)
        else saveBlob(blob, final)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        progress.failed.push(item.title)
      }
      progress.done++
      onProgress({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  return progress
}
