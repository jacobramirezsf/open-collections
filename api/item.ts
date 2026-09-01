import { handler, json, error, params } from './_lib/http.js'
import { getItemById } from './_lib/items.js'

export default handler(async (req: Request) => {
  const ids = (params(req).get('id') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)
  if (!ids.length) return error('id required')
  if (ids.length === 1) {
    const item = getItemById(ids[0])
    return item ? json(item) : error('not found', 404)
  }
  return json({ items: ids.map(getItemById).filter(Boolean) })
})
