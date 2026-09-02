// A shard function serves one index shard (its own /tmp download) with three ops:
//   ?op=search&…   same params as /api/search, returns SearchResponse with per-item _score
//   ?op=item&id=…  item lookup (used by the router and by download/image proxies)
//   ?op=status     source counts for this shard
import type { SearchParams } from '../../shared/types.js'
import { handler, json, error, params, intParam } from './http.js'
import { ensureDb, indexMeta, withShard } from './db.js'
import { search, listSources } from './search.js'
import { getItemById } from './items.js'

export function parseSearchParams(p: URLSearchParams): SearchParams {
  const sp: SearchParams = {
    q: (p.get('q') || '').slice(0, 200),
    limit: intParam(p, 'limit', 250, 1, 1500),
    offset: intParam(p, 'offset', 0, 0, 1500),
    sources: (p.get('sources') || '').split(',').map((s) => s.trim()).filter(Boolean),
    yearFrom: p.get('from') ? intParam(p, 'from', NaN, -10000, 2100) : undefined,
    yearTo: p.get('to') ? intParam(p, 'to', NaN, -10000, 2100) : undefined,
    content: (['image', '3d', 'all'].includes(p.get('content') || '') ? p.get('content') : 'all') as SearchParams['content'],
    publicDomainOnly: p.get('pd') === '1' || p.get('pd') === 'true',
    objectType: p.get('type') || undefined,
    medium: p.get('medium') || undefined,
    place: p.get('place') || undefined,
    creator: p.get('creator') || undefined,
    sort: (['relevance', 'oldest', 'newest', 'random'].includes(p.get('sort') || '') ? p.get('sort') : undefined) as SearchParams['sort'],
    seed: p.get('seed') ? Number(p.get('seed')) : undefined,
  }
  if (sp.yearFrom != null && Number.isNaN(sp.yearFrom)) sp.yearFrom = undefined
  if (sp.yearTo != null && Number.isNaN(sp.yearTo)) sp.yearTo = undefined
  return sp
}

export function makeShardHandler(shard: string) {
  return handler((req: Request) => withShard(shard, async () => {
    await ensureDb(shard)
    const p = params(req)
    const op = p.get('op') || 'search'
    if (op === 'item') {
      const ids = (p.get('id') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)
      if (!ids.length) return error('id required')
      return json({ items: ids.map(getItemById).filter(Boolean) }, { headers: { 'cache-control': 'public, max-age=0, s-maxage=86400' } })
    }
    if (op === 'status') {
      return json({ shard, builtAt: indexMeta().builtAt, sources: listSources() })
    }
    return json(search(parseSearchParams(p)))
  }))
}
