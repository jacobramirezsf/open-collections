// Search over the FTS5 index with per-source candidate retrieval and a diversity-aware merge,
// so one large collection can't crowd out the others.
import type { Item, SearchParams, SearchResponse } from '../../shared/types.ts'
import { getDb, indexMeta } from './db.ts'
import { getItemsByRowids } from './items.ts'
import { TEMPLATES } from '../../shared/urls.ts'

// Sources whose records are public domain by default store NULL in public_domain (see build-index).
const PD_DEFAULT_SOURCES = Object.entries(TEMPLATES).filter(([, t]) => t.rights?.publicDomain === true).map(([k]) => k)
const PD_SQL = `(i.public_domain = 1 OR (i.public_domain IS NULL AND i.source IN (${PD_DEFAULT_SOURCES.map((k) => `'${k}'`).join(',')})))`

const MAX_CANDIDATES = 1500 // per source, per query (offset + limit are capped below this)
const COUNT_CAP = 5000

// bm25 weights: title, creator, object_type, medium, culture, place, text
const BM25 = 'bm25(fts, 12.0, 4.0, 10.0, 3.0, 4.0, 4.0, 1.0)'

export function tokenize(q: string): string[] {
  return (q || '')
    .toLowerCase()
    .replace(/[“”"'‘’`]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length < 40)
    .slice(0, 12)
}

function ftsExpr(tokens: string[], mode: 'and' | 'or'): string {
  const quoted = tokens.map((t) => `"${t.replace(/"/g, '')}"`)
  return quoted.join(mode === 'and' ? ' ' : ' OR ')
}

interface Cand {
  rowid: number
  score: number // higher is better
  source: string
  year: number | null
}

export function listSources(): { key: string; count: number; images: number; models: number; pd: number }[] {
  const db = getDb()
  return db.prepare('SELECT key, count, images, models, pd FROM sources ORDER BY count DESC').all() as any
}

export function search(p: SearchParams): SearchResponse {
  const t0 = Date.now()
  const db = getDb()
  const limit = Math.min(500, Math.max(1, p.limit || 250))
  const offset = Math.max(0, Math.min(p.offset || 0, MAX_CANDIDATES - limit))
  const need = offset + limit
  const tokens = tokenize(p.q)
  const allSources = listSources().map((s) => s.key)
  const sources = (p.sources?.length ? p.sources.filter((s) => allSources.includes(s)) : allSources)
  const sort = p.sort || (tokens.length ? 'relevance' : 'random')
  const seed = Number.isFinite(p.seed) ? Math.abs(Math.trunc(p.seed as number)) % 1000003 : 7

  // Filters on items (aliased i)
  const where: string[] = []
  const args: (string | number)[] = []
  if (p.content === 'image' || p.content === '3d') {
    where.push('i.content_type = ?')
    args.push(p.content)
  }
  if (p.publicDomainOnly) where.push(PD_SQL)
  if (p.yearFrom != null && Number.isFinite(p.yearFrom)) {
    where.push('i.year_start IS NOT NULL AND i.year_start >= ?')
    args.push(p.yearFrom)
  }
  if (p.yearTo != null && Number.isFinite(p.yearTo)) {
    where.push('i.year_end IS NOT NULL AND i.year_end <= ?')
    args.push(p.yearTo)
  }
  const like = (col: string, v?: string) => {
    const t = (v || '').trim()
    if (!t) return
    where.push(`i.${col} LIKE ? ESCAPE '\\'`)
    args.push('%' + t.replace(/[%_\\]/g, (m) => '\\' + m) + '%')
  }
  like('object_type', p.objectType)
  like('medium', p.medium)
  like('creator', p.creator)
  if (p.place?.trim()) {
    const t = '%' + p.place.trim().replace(/[%_\\]/g, (m) => '\\' + m) + '%'
    where.push(`(i.place LIKE ? ESCAPE '\\' OR i.culture LIKE ? ESCAPE '\\')`)
    args.push(t, t)
  }
  if (sort === 'oldest' || sort === 'newest') where.push('i.year_start IS NOT NULL')
  const filterSql = where.length ? ' AND ' + where.join(' AND ') : ''

  const perSource: Record<string, number> = {}
  const candidates: Cand[] = []

  const orderFor = (scoreExpr: string) =>
    sort === 'oldest' ? 'i.year_start ASC, i.rowid' : sort === 'newest' ? 'i.year_start DESC, i.rowid' : sort === 'random' ? `((i.rowid * 2654435761 + ${seed}) % 1000003)` : `${scoreExpr}`

  const collect = (mode: 'and' | 'or') => {
    const expr = ftsExpr(tokens, mode)
    for (const src of sources) {
      // score: bm25 is negative (lower = better). Convert to positive and add a small boost.
      const sql = `SELECT i.rowid AS rowid, i.year_start AS year, (-${BM25} + i.boost * 0.4) AS score
        FROM fts CROSS JOIN items i ON i.rowid = fts.rowid
        WHERE fts MATCH ? AND i.source = ?${filterSql}
        ORDER BY ${orderFor('score DESC')} LIMIT ?`
      const rows = db.prepare(sql).all(expr, src, ...args, Math.min(MAX_CANDIDATES, need + 50)) as any[]
      const seen = new Set(candidates.map((c) => c.rowid))
      let added = 0
      for (const r of rows) {
        if (seen.has(r.rowid)) continue
        candidates.push({ rowid: r.rowid, score: r.score, source: src, year: r.year })
        added++
      }
      if (mode === 'and') {
        if (rows.length < need + 50) perSource[src] = rows.length
        else {
          const c = db
            .prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM fts CROSS JOIN items i ON i.rowid = fts.rowid WHERE fts MATCH ? AND i.source = ?${filterSql} LIMIT ${COUNT_CAP})`)
            .get(expr, src, ...args) as any
          perSource[src] = c.c
        }
      } else perSource[src] = (perSource[src] || 0) + added
    }
  }

  if (tokens.length) {
    collect('and')
    const have = candidates.length
    if (tokens.length > 1 && have < need) collect('or')
  } else {
    // Browse mode: no query. Boosted (highlight) items first, then a seeded pseudo-random order.
    for (const src of sources) {
      const order = sort === 'oldest' ? 'i.year_start ASC' : sort === 'newest' ? 'i.year_start DESC' : `i.boost DESC, ((i.rowid * 2654435761 + ${seed}) % 1000003)`
      const sql = `SELECT i.rowid AS rowid, i.year_start AS year, i.boost AS score FROM items i WHERE i.source = ?${filterSql} ORDER BY ${order} LIMIT ?`
      const rows = db.prepare(sql).all(src, ...args, Math.min(MAX_CANDIDATES, need + 50)) as any[]
      for (const r of rows) candidates.push({ rowid: r.rowid, score: r.score, source: src, year: r.year })
      const c = db.prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM items i WHERE i.source = ?${filterSql} LIMIT ${COUNT_CAP})`).get(src, ...args) as any
      perSource[src] = c.c
    }
  }

  const merged = merge(candidates, sort, sources.length)
  const page = merged.slice(offset, offset + limit)
  const items: Item[] = getItemsByRowids(page.map((c) => c.rowid))
  const total = Object.values(perSource).reduce((a, b) => a + b, 0)
  return { items, total, perSource, took: Date.now() - t0, index: { builtAt: indexMeta().builtAt } }
}

// Diversity-aware merge: at each step take the candidate with the best score, discounted by how many
// items its source has already contributed. Keeps relevance while preventing one source from dominating.
function merge(cands: Cand[], sort: string, nSources: number): Cand[] {
  if (sort === 'oldest') return cands.sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
  if (sort === 'newest') return cands.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  const bySource = new Map<string, Cand[]>()
  for (const c of cands) {
    if (!bySource.has(c.source)) bySource.set(c.source, [])
    bySource.get(c.source)!.push(c)
  }
  if (sort === 'random') {
    // plain round robin over the per-source (already pseudo-random) lists
    const lists = [...bySource.values()]
    const out: Cand[] = []
    for (let i = 0; out.length < cands.length; i++) for (const l of lists) if (l[i]) out.push(l[i])
    return out
  }
  for (const l of bySource.values()) l.sort((a, b) => b.score - a.score)
  const lists = [...bySource.entries()].map(([source, list]) => ({ source, list, idx: 0, taken: 0 }))
  const out: Cand[] = []
  const penalty = nSources > 1 ? 0.06 : 0
  while (out.length < cands.length) {
    let best: (typeof lists)[number] | null = null
    let bestVal = -Infinity
    for (const l of lists) {
      const c = l.list[l.idx]
      if (!c) continue
      // scores are positive; discount grows with items already taken from that source
      const val = c.score / (1 + penalty * l.taken)
      if (val > bestVal) {
        bestVal = val
        best = l
      }
    }
    if (!best) break
    out.push(best.list[best.idx++])
    best.taken++
  }
  return out
}
