// Patent search. SerpAPI's google_patents engine (SERPAPI_KEY) answers first: Google blocks Vercel's
// IPs after a handful of searches, and SerpAPI does not get blocked. If SerpAPI fails (no key, out of
// searches, outage) we fall back to the /xhr/query JSON endpoint patents.google.com itself uses,
// behind the shared breaker. Both return the same record fields. Results are normalized into the shared Item shape so the whole UI (grid, viewer, boards,
// downloads, halftone editor) works unchanged. Images live on the public patentimages CDN.
import type { Item, ItemFile } from '../../shared/types.js'
import { guardedSearch, googleGate, type PatentResult } from './patentGuard.js'

const IMG = 'https://patentimages.storage.googleapis.com/'

export interface PatentQuery {
  q: string
  num: number
  page: number
  sort?: 'new' | 'old'
  after?: string // YYYY or YYYY-MM-DD
  before?: string
  dateType?: 'priority' | 'filing' | 'publication'
  inventor?: string
  assignee?: string
  country?: string
  status?: 'GRANT' | 'APPLICATION'
  type?: 'PATENT' | 'DESIGN'
}

function dateOp(kind: 'before' | 'after', v: string, type: string): string | null {
  const t = v.trim()
  if (!t) return null
  const m = t.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?$/)
  if (!m) return null
  const ymd = m[2] ? `${m[1]}${m[2]}${m[3]}` : kind === 'after' ? `${m[1]}0101` : `${m[1]}1231`
  return `${kind}:${type}:${ymd}`
}

export function buildInnerQuery(p: PatentQuery): string {
  const parts = [p.q.trim().replace(/\s+/g, ' ')]
  const dt = p.dateType || 'publication'
  const a = p.after && dateOp('after', p.after, dt)
  const b = p.before && dateOp('before', p.before, dt)
  if (a) parts.push(a)
  if (b) parts.push(b)
  if (p.inventor?.trim()) parts.push(`inventor:"${p.inventor.trim().replace(/"/g, '')}"`)
  if (p.assignee?.trim()) parts.push(`assignee:"${p.assignee.trim().replace(/"/g, '')}"`)
  if (p.country?.trim()) parts.push(`country:${p.country.trim().toUpperCase().replace(/[^A-Z,]/g, '')}`)
  if (p.status) parts.push(`status:${p.status}`)
  if (p.type) parts.push(`type:${p.type}`)
  const sp = new URLSearchParams({ q: parts.filter(Boolean).join(' '), num: String(p.num), page: String(p.page) })
  if (p.sort) sp.set('sort', p.sort)
  return sp.toString()
}

function parseGoogle(text: string): any {
  const i = text.indexOf('{')
  if (i < 0) throw new Error('Unexpected Google response')
  let d = JSON.parse(text.slice(i))
  if (typeof d.content === 'string') {
    const j = d.content.indexOf('{')
    if (j < 0) throw new Error('Unexpected Google response')
    d = JSON.parse(d.content.slice(j))
  } else if (d.content && typeof d.content === 'object') {
    d = d.content
  }
  return d
}

const clean = (s: unknown, max = 300) => {
  const t = String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

const abs = (path: string | undefined | null) => (path ? (path.startsWith('http') ? path : IMG + path) : null)

// `p` is one patent record: Google's result.patent, or a SerpAPI organic_results entry (same fields)
export function normalizePatent(p: any): Item | null {
  if (!p?.publication_number) return null
  const num = p.publication_number as string
  const figures: { thumbnail?: string; full?: string }[] = Array.isArray(p.figures) ? p.figures : []
  // Google's `thumbnail` fields are tiny (about 60-115px); the grid uses the first figure's
  // full sheet (~1500px) so previews stay sharp, falling back to a thumbnail only when that is missing
  const firstFull = abs(figures[0]?.full) || abs(p.thumbnail) || abs(figures[0]?.thumbnail)
  const thumb = firstFull
  if (!thumb) return null
  const files: ItemFile[] = figures
    .filter((f) => f.full || f.thumbnail)
    .map((f, i) => ({ format: 'png', url: abs(f.full || f.thumbnail)!, label: `Figure sheet ${i + 1}`, filename: `${num}-fig${i + 1}.png` }))
  if (p.pdf) files.push({ format: 'pdf', url: abs(p.pdf)!, label: 'Full patent PDF', filename: `${num}.pdf` })
  const pubDate: string = p.publication_date || p.grant_date || p.filing_date || ''
  const year = Number(pubDate.slice(0, 4)) || null
  const isDesign = /^USD/.test(num)
  const isUS = num.startsWith('US')
  const creator = [clean(p.inventor, 120), clean(p.assignee, 120)].filter(Boolean).join(' · ')
  return {
    id: `patents:${num}`,
    source: 'patents',
    sourceName: 'Google Patents',
    sourceUrl: `https://patents.google.com/patent/${encodeURIComponent(num)}/en`,
    title: clean(p.title, 200) || num,
    creator: creator || null,
    dateDisplay: [p.priority_date && `priority ${p.priority_date}`, pubDate && `published ${pubDate}`].filter(Boolean).join(' · ') || null,
    yearStart: year,
    yearEnd: year,
    objectType: isDesign ? 'Design patent' : 'Patent',
    medium: null,
    culture: null,
    place: num.slice(0, 2),
    publicDomain: isUS ? true : null,
    rightsLabel: isUS ? 'Public record (US patent document)' : 'Patent document, check jurisdiction',
    licenseUrl: null,
    thumbnailUrl: thumb,
    imageUrl: firstFull,
    originalImageUrl: firstFull,
    width: null,
    height: null,
    contentType: 'image',
    files,
  }
}

const serpKey = () => process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY || ''

export function searchPatents(p: PatentQuery): Promise<PatentResult> {
  const inner = buildInnerQuery(p)
  return guardedSearch(inner, async () => {
    if (serpKey()) {
      try {
        return await fetchSerp(p)
      } catch (e) {
        console.warn('SerpAPI patent search failed, trying Google directly:', (e as Error).message)
      }
    }
    return googleGate(() => fetchGoogle(inner))
  })
}

// SerpAPI takes the filters as their own parameters rather than inside q; page is 1-based.
function serpParams(p: PatentQuery): URLSearchParams {
  const sp = new URLSearchParams({ engine: 'google_patents', q: p.q.trim().replace(/\s+/g, ' '), num: String(p.num), page: String(p.page + 1), api_key: serpKey() })
  const dt = p.dateType || 'publication'
  const a = p.after && dateOp('after', p.after, dt)
  const b = p.before && dateOp('before', p.before, dt)
  if (a) sp.set('after', a.slice('after:'.length))
  if (b) sp.set('before', b.slice('before:'.length))
  const name = (s: string) => s.trim().replace(/"/g, '')
  const wrap = (s: string) => (s.includes(',') ? `(${s})` : s)
  if (p.inventor?.trim()) sp.set('inventor', wrap(name(p.inventor)))
  if (p.assignee?.trim()) sp.set('assignee', wrap(name(p.assignee)))
  if (p.country?.trim()) sp.set('country', p.country.trim().toUpperCase().replace(/[^A-Z,]/g, ''))
  if (p.status) sp.set('status', p.status)
  if (p.type) sp.set('type', p.type)
  if (p.sort) sp.set('sort', p.sort)
  return sp
}

async function fetchSerp(p: PatentQuery): Promise<PatentResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25000)
  let res: Response
  try {
    res = await fetch(`https://serpapi.com/search.json?${serpParams(p)}`, { signal: ctrl.signal, headers: { accept: 'application/json' } })
  } finally {
    clearTimeout(t)
  }
  let d: any = null
  try {
    d = await res.json()
  } catch {
    /* non-JSON */
  }
  // an empty search comes back as an error message rather than an empty list
  if (typeof d?.error === 'string' && /hasn't returned any results/i.test(d.error)) return { items: [], total: 0, via: 'serpapi' }
  if (!res.ok || d?.error || !d) throw new Error(`SerpAPI ${res.status}: ${d?.error || 'unexpected response'}`)
  const raw: any[] = Array.isArray(d.organic_results) ? d.organic_results : []
  const items = raw.map(normalizePatent).filter(Boolean) as Item[]
  return { items, total: Number(d.search_information?.total_results) || items.length, via: 'serpapi' }
}

async function fetchGoogle(inner: string): Promise<PatentResult> {
  const url = `https://patents.google.com/xhr/query?url=${encodeURIComponent(inner)}&exp=`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25000)
  let res: Response
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        referer: 'https://patents.google.com/',
      },
    })
  } finally {
    clearTimeout(t)
  }
  const text = await res.text()
  // 429/503 and Google's "Sorry… automated queries" page all mean this IP is being throttled
  if (res.status === 429 || res.status === 503 || /<title>Sorry/i.test(text) || /automated queries/i.test(text)) {
    const err = new Error('Google Patents is rate-limiting searches')
    ;(err as any).blocked = true
    throw err
  }
  if (!res.ok) {
    const err = new Error(`Google Patents error (${res.status})`)
    ;(err as any).status = 502
    throw err
  }
  const d = parseGoogle(text)
  const results = d?.results ?? {}
  const clusters = Array.isArray(results.cluster) ? results.cluster : []
  const raw: any[] = clusters.flatMap((c: any) => (Array.isArray(c?.result) ? c.result : []))
  const items = raw.map((r) => normalizePatent(r?.patent)).filter(Boolean) as Item[]
  return { items, total: Number(results.total_num_results) || items.length, via: 'google' }
}
