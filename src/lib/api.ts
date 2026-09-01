import type { Item, SearchResponse, SourceInfo } from '../../shared/types'

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
  creator?: string
  sort?: 'relevance' | 'oldest' | 'newest' | 'random'
}

export const DEFAULT_QUERY: Query = { q: '', limit: 250, sources: [], content: 'all', pd: true }

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

export function downloadUrl(item: Item, fileIndex: number | 'image' = 'image'): string {
  return `/api/download?id=${encodeURIComponent(item.id)}&file=${fileIndex}`
}

export function proxyImageUrl(item: Item, size: 'thumb' | 'view' | 'orig' = 'thumb'): string {
  return `/api/image?id=${encodeURIComponent(item.id)}&size=${size}`
}
