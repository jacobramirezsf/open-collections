// "Similar among loaded results": a small perceptual signature per image computed in the browser
// (16×16 luminance DCT-ish hash + 4×4 colour grid), compared with a weighted distance.
// Images are drawn on a canvas via CORS where the host allows it, otherwise via our same-origin proxy.
import type { Item } from '../../shared/types'
import { proxyImageUrl } from './api'

export interface Signature {
  gray: Float32Array // 64 low-frequency-ish values (8x8 downsample of 16x16 luminance, mean-centred)
  color: Float32Array // 4x4x3 mean colour grid
}

const cache = new Map<string, Signature | null>()
const CORS_HOSTS = ['images.metmuseum.org', 'www.artic.edu', 'api.nga.gov', 'ids.si.edu', 'iiif.micr.io', 'assets.science.nasa.gov']

function loadImage(url: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (cors) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load failed'))
    img.src = url
  })
}

async function loadForCanvas(item: Item): Promise<HTMLImageElement> {
  const url = item.thumbnailUrl
  if (!url) throw new Error('no image')
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    /* ignore */
  }
  if (CORS_HOSTS.includes(host)) {
    try {
      return await loadImage(url, true)
    } catch {
      /* fall through to proxy */
    }
  }
  return loadImage(proxyImageUrl(item, 'thumb'), false)
}

export async function signature(item: Item): Promise<Signature | null> {
  if (cache.has(item.id)) return cache.get(item.id)!
  try {
    const img = await loadForCanvas(item)
    const N = 16
    const c = document.createElement('canvas')
    c.width = N
    c.height = N
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, N, N)
    const d = ctx.getImageData(0, 0, N, N).data
    const gray = new Float32Array(64)
    const color = new Float32Array(48)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4
        const r = d[i], g = d[i + 1], b = d[i + 2]
        const l = 0.299 * r + 0.587 * g + 0.114 * b
        const gi = (y >> 1) * 8 + (x >> 1)
        gray[gi] += l / 4
        const ci = ((y >> 2) * 4 + (x >> 2)) * 3
        color[ci] += r / 16
        color[ci + 1] += g / 16
        color[ci + 2] += b / 16
      }
    let mean = 0
    for (const v of gray) mean += v / 64
    let std = 0
    for (let i = 0; i < 64; i++) {
      gray[i] -= mean
      std += gray[i] * gray[i]
    }
    std = Math.sqrt(std / 64) || 1
    for (let i = 0; i < 64; i++) gray[i] /= std
    const sig = { gray, color }
    cache.set(item.id, sig)
    return sig
  } catch {
    cache.set(item.id, null)
    return null
  }
}

export function distance(a: Signature, b: Signature): number {
  let dg = 0
  for (let i = 0; i < 64; i++) {
    const t = a.gray[i] - b.gray[i]
    dg += t * t
  }
  let dc = 0
  for (let i = 0; i < 48; i++) {
    const t = (a.color[i] - b.color[i]) / 255
    dc += t * t
  }
  return Math.sqrt(dg / 64) + 1.5 * Math.sqrt(dc / 48)
}

// Ranks `pool` by visual similarity to `base`. Calls onProgress as signatures get computed.
export async function rankSimilar(base: Item, pool: Item[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Item[]> {
  const baseSig = await signature(base)
  if (!baseSig) return []
  const scored: { item: Item; d: number }[] = []
  let idx = 0
  let done = 0
  const worker = async () => {
    while (idx < pool.length && !signal?.aborted) {
      const it = pool[idx++]
      if (it.id === base.id) continue
      const s = await signature(it)
      if (s) scored.push({ item: it, d: distance(baseSig, s) })
      done++
      onProgress?.(done, pool.length)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  scored.sort((a, b) => a.d - b.d)
  return scored.map((s) => s.item)
}
