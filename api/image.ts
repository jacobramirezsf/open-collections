// GET /api/image?id=<item id>&size=thumb|view|orig
// Same-origin image proxy for indexed items (used for canvas-based similarity and as a fallback when a
// museum CDN blocks hotlinking). Only URLs stored in the index can be fetched.
import { handler, error, params } from './_lib/http.js'
import { getItemById } from './_lib/items.js'
import { proxyFetch } from './_lib/proxy.js'

export default handler(async (req: Request) => {
  const p = params(req)
  const item = getItemById(p.get('id') || '')
  if (!item) return error('not found', 404)
  const size = p.get('size') || 'thumb'
  const url = size === 'orig' ? item.originalImageUrl : size === 'view' ? item.imageUrl : item.thumbnailUrl
  if (!url) return error('no image', 404)
  return proxyFetch(url, { timeoutMs: 20000 })
})
