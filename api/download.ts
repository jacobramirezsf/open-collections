// GET /api/download?id=<item id>&file=<index into item.files | 'image'>
// Streams the original asset with a proper content-type and a sensible filename.
import { handler, error, params } from './_lib/http.js'
import { getItemsAcrossShards } from './_lib/router.js'
import { proxyFetch, downloadName, extFromUrl, allowedRawUrl } from './_lib/proxy.js'

export const config = { maxDuration: 60 }

export default handler(async (req: Request) => {
  const p = params(req)
  const raw = allowedRawUrl(p.get('url'))
  if (raw) {
    const name = (p.get('name') || raw.split('/').pop() || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120)
    return proxyFetch(raw, { download: name, range: req.headers.get('range'), redirectOnBlock: true })
  }
  const id = p.get('id') || ''
  const [item] = await getItemsAcrossShards(req, [id])
  if (!item) return error('not found', 404)
  const which = p.get('file') ?? '0'
  const size = p.get('size') // 'view' = ~1600px JPEG instead of the original (faster batch downloads)
  let url: string | null = null
  let ext: string | null = null
  if (which === 'image') {
    // Aggregators (Europeana) point at provider-hosted originals that are often unreachable; cascade
    // down the renditions server-side so the user gets the best fetchable version.
    const order = size === 'view' ? [item.imageUrl, item.originalImageUrl, item.thumbnailUrl] : [item.originalImageUrl, item.imageUrl, item.thumbnailUrl]
    const candidates = [...new Set(order.filter(Boolean))] as string[]
    for (let i = 0; i < candidates.length; i++) {
      const isLast = i === candidates.length - 1
      const res = await proxyFetch(candidates[i], { download: downloadName(item, candidates[i], extFromUrl(candidates[i])), range: req.headers.get('range'), redirectOnBlock: isLast, timeoutMs: 25000 })
      if (res.ok || res.status === 206 || res.status === 302) {
        if (res.ok || res.status === 206 || isLast) return res
      }
    }
    return error('The source image could not be fetched. Try the original record.', 502)
  }
  {
    const f = item.files[Number(which)]
    if (f) {
      url = f.url
      ext = extFromUrl(f.filename || f.url) || (f.format === 'jpg' ? 'jpg' : f.format)
    } else url = item.originalImageUrl || item.imageUrl
  }
  if (!url) return error('no file', 404)
  const name = downloadName(item, url, ext)
  return proxyFetch(url, { download: name, range: req.headers.get('range'), redirectOnBlock: true })
})
