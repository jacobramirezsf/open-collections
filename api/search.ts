import type { SearchParams } from '../shared/types.ts'
import { handler, json, params, intParam } from './_lib/http.ts'
import { search } from './_lib/search.ts'

export default handler(async (req: Request) => {
  const p = params(req)
  const sp: SearchParams = {
    q: (p.get('q') || '').slice(0, 200),
    limit: intParam(p, 'limit', 250, 1, 500),
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
  return json(search(sp))
})
