import type { Item, SearchResponse, SourceInfo } from '../../shared/types'

export type Tool = 'museums' | 'patents'

export interface Query {
  q: string
  limit: number
  sources: string[] // empty = all
  from?: number
  to?: number
  content: 'all' | 'image' | '3d'
  pd: boolean
  type?: string
  medium?: string
  place?: string
  creator?: string // museums: artist/maker · patents: inventor
  sort?: 'relevance' | 'oldest' | 'newest' | 'random'
  // patent-only filters
  pAssignee?: string
  pCountry?: string
  pStatus?: 'GRANT' | 'APPLICATION'
  pType?: 'PATENT' | 'DESIGN'
  pDateType?: 'priority' | 'filing' | 'publication'
}

export const DEFAULT_QUERY: Query = { q: '', limit: 250, sources: [], content: 'all', pd: true }
export const DEFAULT_PATENT_QUERY: Query = { ...DEFAULT_QUERY, limit: 100 }

export function queryToParams(q: Query, offset = 0, seed?: number): URLSearchParams {
  const p = new URLSearchParams()
  if (q.q) p.set('q', q.q)
  p.set('limit', String(q.limit))
  if (offset) p.set('offset', String(offset))
  if (q.sources.length) p.set('sources', q.sources.join(','))
  if (q.from != null) p.set('from', String(q.from))
  if (q.to != null) p.set('to', String(q.to))
  if (q.content !== 'all') p.set('content', q.content)
  if (q.pd) p.set('pd', '1')
  if (q.type) p.set('type', q.type)
  if (q.medium) p.set('medium', q.medium)
  if (q.place) p.set('place', q.place)
  if (q.creator) p.set('creator', q.creator)
  if (q.sort) p.set('sort', q.sort)
  if (seed != null) p.set('seed', String(seed))
  if (q.pAssignee) p.set('pas', q.pAssignee)
  if (q.pCountry) p.set('pco', q.pCountry)
  if (q.pStatus) p.set('pst', q.pStatus)
  if (q.pType) p.set('pty', q.pType)
  if (q.pDateType) p.set('pdt', q.pDateType)
  return p
}

export function paramsToQuery(p: URLSearchParams): Query {
  const num = (k: string) => (p.get(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined)
  const limit = num('n') ?? num('limit') ?? 250
  return {
    q: p.get('q') || '',
    limit: [100, 250, 500].includes(limit) ? limit : 250,
    sources: (p.get('sources') || '').split(',').filter(Boolean),
    from: num('from'),
    to: num('to'),
    content: (['image', '3d'].includes(p.get('content') || '') ? p.get('content') : 'all') as Query['content'],
    pd: p.has('pd') ? p.get('pd') === '1' : true,
    type: p.get('type') || undefined,
    medium: p.get('medium') || undefined,
    place: p.get('place') || undefined,
    creator: p.get('creator') || undefined,
    sort: (['oldest', 'newest', 'random', 'relevance'].includes(p.get('sort') || '') ? p.get('sort') : undefined) as Query['sort'],
    pAssignee: p.get('pas') || undefined,
    pCountry: p.get('pco') || undefined,
    pStatus: (['GRANT', 'APPLICATION'].includes(p.get('pst') || '') ? p.get('pst') : undefined) as Query['pStatus'],
    pType: (['PATENT', 'DESIGN'].includes(p.get('pty') || '') ? p.get('pty') : undefined) as Query['pType'],
    pDateType: (['priority', 'filing', 'publication'].includes(p.get('pdt') || '') ? p.get('pdt') : undefined) as Query['pDateType'],
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new ApiError(body?.error || `Request failed (${res.status})`, res.status)
  return body as T
}

export function search(q: Query, offset: number, seed: number, signal?: AbortSignal): Promise<SearchResponse> {
  return getJson<SearchResponse>(`/api/search?${queryToParams(q, offset, seed)}`, signal)
}

// Patent search: live Google Patents via our API; returns the same SearchResponse shape.
export async function searchPatents(q: Query, offset: number, signal?: AbortSignal): Promise<SearchResponse> {
  const num = Math.min(100, q.limit)
  const p = new URLSearchParams({ q: q.q, num: String(num), page: String(Math.floor(offset / num)) })
  if (q.sort === 'newest') p.set('sort', 'new')
  if (q.sort === 'oldest') p.set('sort', 'old')
  if (q.from != null) p.set('after', String(q.from))
  if (q.to != null) p.set('before', String(q.to))
  if (q.pDateType) p.set('dateType', q.pDateType)
  if (q.creator) p.set('inventor', q.creator)
  if (q.pAssignee) p.set('assignee', q.pAssignee)
  if (q.pCountry) p.set('country', q.pCountry)
  if (q.pStatus) p.set('status', q.pStatus)
  if (q.pType) p.set('type', q.pType)
  const r = await getJson<{ items: Item[]; total: number; took: number }>(`/api/patents?${p}`, signal)
  return { items: r.items, total: r.total, perSource: { patents: r.total }, took: r.took, index: { builtAt: null } }
}

export function fetchItem(id: string): Promise<Item> {
  return getJson<Item>(`/api/item?id=${encodeURIComponent(id)}`)
}

export interface Status {
  ok: boolean
  builtAt: string | null
  total: number
  sources: SourceInfo[]
}

export function fetchStatus(): Promise<Status> {
  return getJson<Status>('/api/status')
}

// Items that live in our index are addressed by id; live items (patents) carry absolute URLs and
// go through the allowlisted raw-url proxy instead.
function isLive(item: Item): boolean {
  return item.source === 'patents' || item.source === 'edits'
}

export function downloadUrl(item: Item, fileIndex: number | 'image' = 'image'): string {
  if (item.originalImageUrl?.startsWith('data:')) return item.originalImageUrl
  if (isLive(item)) {
    const f = fileIndex === 'image' ? null : item.files[Number(fileIndex)]
    const url = f?.url || item.originalImageUrl || item.imageUrl || item.thumbnailUrl || ''
    const name = f?.filename || `${item.id.split(':').pop()}-${(item.title || 'patent').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40)}.${(f?.format || 'png').toLowerCase()}`
    return `/api/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`
  }
  return `/api/download?id=${encodeURIComponent(item.id)}&file=${fileIndex}`
}

export function proxyImageUrl(item: Item, size: 'thumb' | 'view' | 'orig' = 'thumb'): string {
  if (item.originalImageUrl?.startsWith('data:')) return item.originalImageUrl
  if (isLive(item)) {
    const url = size === 'thumb' ? item.thumbnailUrl : item.originalImageUrl || item.imageUrl || item.thumbnailUrl
    return `/api/image?url=${encodeURIComponent(url || '')}`
  }
  return `/api/image?id=${encodeURIComponent(item.id)}&size=${size}`
}

// Upload one edit image for the signed-in user. Sends application/octet-stream (the platform
// pre-parses that to a Buffer; image/* bodies hang its body handling) with the real mime in
// x-oc-type, and aborts rather than hanging the UI if the network stalls.
export async function uploadEdit(blob: Blob, mime: string): Promise<string> {
  const ctl = new AbortController()
  const t = window.setTimeout(() => ctl.abort(), 75000)
  try {
    const res = await fetch('/api/upload-edit', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-oc-type': mime },
      body: blob,
      signal: ctl.signal,
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) throw new Error(payload?.error || `Save failed (${res.status})`)
    return payload.url as string
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Save timed out. Check your connection and try again.')
    throw e
  } finally {
    window.clearTimeout(t)
  }
}
