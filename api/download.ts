// GET /api/download?id=<item id>&file=<index into item.files | 'image'>
// Streams the original asset with a proper content-type and a sensible filename.
import { handler, error, params } from './_lib/http.js'
import { getItemById } from './_lib/items.js'
import { proxyFetch, downloadName, extFromUrl } from './_lib/proxy.js'

export const config = { maxDuration: 60 }

export default handler(async (req: Request) => {
  const p = params(req)
  const id = p.get('id') || ''
  const item = getItemById(id)
  if (!item) return error('not found', 404)
  const which = p.get('file') ?? '0'
  let url: string | null = null
  let ext: string | null = null
  if (which === 'image') {
    url = item.originalImageUrl || item.imageUrl || item.thumbnailUrl
  } else {
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
