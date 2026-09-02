import { handler, json, error, params, intParam } from './_lib/http.js'
import { searchPatents } from './_lib/patents.js'

export default handler(async (req: Request) => {
  const p = params(req)
  const q = (p.get('q') || '').slice(0, 300)
  if (!q.trim()) return json({ items: [], total: 0, took: 0 })
  const t0 = Date.now()
  try {
    const { items, total } = await searchPatents({
      q,
      num: intParam(p, 'num', 100, 10, 100),
      page: intParam(p, 'page', 0, 0, 50),
      sort: (['new', 'old'].includes(p.get('sort') || '') ? p.get('sort') : undefined) as 'new' | 'old' | undefined,
      after: p.get('after') || undefined,
      before: p.get('before') || undefined,
      dateType: (['priority', 'filing', 'publication'].includes(p.get('dateType') || '') ? p.get('dateType') : undefined) as any,
      inventor: p.get('inventor') || undefined,
      assignee: p.get('assignee') || undefined,
      country: p.get('country') || undefined,
      status: (['GRANT', 'APPLICATION'].includes(p.get('status') || '') ? p.get('status') : undefined) as any,
      type: (['PATENT', 'DESIGN'].includes(p.get('type') || '') ? p.get('type') : undefined) as any,
    })
    return json({ items, total, took: Date.now() - t0 })
  } catch (e: any) {
    return error(e?.message || 'Patent search failed', e?.status || 502)
  }
})
