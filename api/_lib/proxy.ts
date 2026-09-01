// Fetches a remote asset that belongs to an indexed item and streams it back with a correct
// content-type and (optionally) a download filename. Only URLs stored in the index are allowed.
import type { Item } from '../../shared/types.js'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
  stl: 'model/stl', obj: 'model/obj', glb: 'model/gltf-binary', gltf: 'model/gltf+json', usdz: 'model/vnd.usdz+zip',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', fbx: 'application/octet-stream', blend: 'application/octet-stream',
  '3ds': 'application/octet-stream', pdf: 'application/pdf', ply: 'application/octet-stream', dae: 'model/vnd.collada+xml',
}

export function extFromUrl(url: string): string | null {
  const m = url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : null
}

export function slug(s: string, max = 60): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'untitled'
  )
}

export function downloadName(item: Item, url: string, ext?: string | null): string {
  const e = ext || extFromUrl(url) || (item.contentType === '3d' ? 'bin' : 'jpg')
  const idPart = slug(item.id.replace(/^[^:]+:/, ''), 40)
  return `${item.source}-${idPart}-${slug(item.title, 50)}.${e}`
}

export function itemUrls(item: Item): string[] {
  return [item.thumbnailUrl, item.imageUrl, item.originalImageUrl, ...item.files.map((f) => f.url)].filter(Boolean) as string[]
}

export async function proxyFetch(url: string, opts: { download?: string | null; cache?: string; timeoutMs?: number; range?: string | null } = {}): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 50000)
  let upstream: Response
  try {
    upstream = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; open-collections/1.0; +https://open-collections.vercel.app)',
        accept: '*/*',
        ...(opts.range ? { range: opts.range } : {}),
      },
    })
  } catch (e: any) {
    clearTimeout(t)
    return new Response(JSON.stringify({ error: e?.name === 'AbortError' ? 'Upstream timeout' : 'Upstream fetch failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }
  if (!upstream.ok && upstream.status !== 206) {
    clearTimeout(t)
    return new Response(JSON.stringify({ error: `Upstream returned ${upstream.status}` }), {
      status: upstream.status === 404 ? 404 : 502,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }
  const ext = extFromUrl(opts.download || url) || extFromUrl(url)
  let type = upstream.headers.get('content-type') || ''
  if (!type || /octet-stream|text\/plain|text\/html/.test(type) || (ext && MIME[ext] && !type.startsWith(MIME[ext].split('/')[0]))) {
    type = (ext && MIME[ext]) || type || 'application/octet-stream'
  }
  const headers = new Headers({ 'content-type': type, 'cache-control': opts.cache ?? 'public, max-age=86400, s-maxage=604800, immutable' })
  const len = upstream.headers.get('content-length')
  if (len) headers.set('content-length', len)
  const cr = upstream.headers.get('content-range')
  if (cr) headers.set('content-range', cr)
  headers.set('accept-ranges', 'bytes')
  if (opts.download) headers.set('content-disposition', `attachment; filename="${opts.download.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(opts.download)}`)
  headers.set('access-control-allow-origin', '*')
  // Body streams through; the timeout only guards the initial connection.
  clearTimeout(t)
  return new Response(upstream.body, { status: upstream.status, headers })
}
