import { handler, json, error, params } from './_lib/http.js'
import { getItemsAcrossShards } from './_lib/router.js'

export default handler(async (req: Request) => {
  const ids = (params(req).get('id') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)
  if (!ids.length) return error('id required')
  const items = await getItemsAcrossShards(req, ids)
  if (ids.length === 1) return items[0] ? json(items[0]) : error('not found', 404)
  return json({ items })
})
