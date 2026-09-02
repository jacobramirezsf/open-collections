// Search router: fans the query out to the shard functions (each holds part of the index in its own
// /tmp), then re-merges the scored candidates with the same diversity-aware algorithm.
import type { Item, SearchResponse } from '../shared/types.js'
import { handler, json, params, intParam } from './_lib/http.js'
import { mergeScored } from './_lib/search.js'
import { SHARDS, SHARD_KEYS, callShard } from './_lib/router.js'

export default handler(async (req: Request) => {
  const p = params(req)
  const limit = Math.min(500, Math.max(1, intParam(p, 'limit', 250, 1, 500)))
  const offset = intParam(p, 'offset', 0, 0, 1500)
  const wanted = (p.get('sources') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const shards = SHARD_KEYS.filter((k) => !wanted.length || SHARDS[k].some((s) => wanted.includes(s)))
  const sp = new URLSearchParams(p)
  sp.set('limit', String(Math.min(1500, offset + limit)))
  sp.set('offset', '0')
  const t0 = Date.now()
  const settled = await Promise.allSettled(shards.map((k) => callShard<SearchResponse>(req, k, sp.toString())))
  const responses = settled.filter((r): r is PromiseFulfilledResult<SearchResponse> => r.status === 'fulfilled').map((r) => r.value)
  if (!responses.length) {
    const err = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    return json({ error: String(err?.reason?.message || 'Search unavailable') }, { status: 502, headers: { 'cache-control': 'no-store' } })
  }
  const sort = p.get('sort') || ((p.get('q') || '').trim() ? 'relevance' : 'random')
  const seen = new Set<string>()
  const cands: { item: Item; score: number; source: string; year: number | null }[] = []
  for (const r of responses) {
    for (const it of r.items) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      cands.push({ item: it, score: Number((it as any)._score) || 0, source: it.source, year: it.yearStart })
    }
  }
  const nSources = new Set(cands.map((c) => c.source)).size || 1
  const merged = sort === 'relevance' || sort === 'random' ? mergeScored(cands, sort, nSources) : mergeScored(cands, sort, nSources)
  const items = merged.slice(offset, offset + limit).map((c) => {
    const { _score, _rowid, ...clean } = c.item as any
    return clean as Item
  })
  // a source lives in exactly one shard; MAX (not sum) also stays correct when a dev setup serves
  // the same full index from every shard
  const perSource: Record<string, number> = {}
  for (const r of responses) for (const [src, n] of Object.entries(r.perSource)) perSource[src] = Math.max(perSource[src] ?? 0, n)
  const total = Object.values(perSource).reduce((a, b) => a + b, 0)
  const builtAt = responses.map((r) => r.index?.builtAt).find(Boolean) ?? null
  return json({ items, total, perSource, took: Date.now() - t0, index: { builtAt } })
})
