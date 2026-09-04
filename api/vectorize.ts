// POST /api/vectorize { id } or { image: dataURL } → { svg, sandbox } via QuiverAI's
// image-to-SVG API (https://docs.quiver.ai). The key stays server-side (QUIVERAI_API_KEY);
// generations spend paid credits, so a small per-IP daily cap applies (same pattern as removebg).
import { handler, error, json, params } from './_lib/http.js'
import { getItemsAcrossShards } from './_lib/router.js'

export const config = { maxDuration: 120 }

const DAILY_CAP = Number(process.env.QUIVER_DAILY_CAP || 20)
const MODEL = process.env.QUIVER_MODEL || 'arrow-1.1'
const memCounts = new Map<string, number>()

function day(): string {
  return new Date().toISOString().slice(0, 10)
}

async function quota(ip: string): Promise<{ ok: boolean; used: number }> {
  const keyName = `vectorize/${day()}/${ip.replace(/[^a-zA-Z0-9.:_-]/g, '')}.json`
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    const used = (memCounts.get(day() + ip) || 0) + 1
    memCounts.set(day() + ip, used)
    return { ok: used <= DAILY_CAP, used }
  }
  let used = 0
  try {
    const { head } = await import('@vercel/blob')
    const h = await head(keyName, { token })
    const res = await fetch(h.url + '?t=' + Date.now())
    if (res.ok) used = Number(((await res.json()) as any)?.used) || 0
  } catch {
    /* first request today */
  }
  used++
  if (used > DAILY_CAP) return { ok: false, used }
  const { put } = await import('@vercel/blob')
  await put(keyName, JSON.stringify({ used }), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 0, token }).catch(() => {})
  return { ok: true, used }
}

export default handler(async (req: Request) => {
  void params
  if (req.method !== 'POST') return error('POST only', 405)
  const key = process.env.QUIVERAI_API_KEY
  if (!key) return error('Vectorization is not configured.', 501)
  const text = await req.text()
  if (text.length > 9_000_000) return error('Image too large to vectorize.', 413)
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    return error('invalid body')
  }

  let image: { url: string } | { base64: string }
  if (typeof body?.image === 'string' && body.image.startsWith('data:image/')) {
    image = { base64: body.image.replace(/^data:image\/[a-z+]+;base64,/, '') }
  } else if (body?.id) {
    const [item] = await getItemsAcrossShards(req, [String(body.id)])
    if (!item) return error('not found', 404)
    const url = item.imageUrl || item.thumbnailUrl
    if (!url) return error('no image', 404)
    image = { url }
  } else {
    return error('id or image required')
  }

  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim()
  const q = await quota(ip)
  if (!q.ok) return error(`Daily vectorization limit reached (${DAILY_CAP}/day). Try again tomorrow.`, 429)

  const res = await fetch('https://api.quiver.ai/v1/svgs/vectorizations', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, image, target_size: 1024, stream: false }),
  })
  let payload: any = null
  try {
    payload = await res.json()
  } catch {
    /* non-JSON error */
  }
  if (!res.ok) {
    const msg = payload?.error?.message || payload?.message || `Vectorization error (${res.status})`
    return error(res.status === 402 ? 'Vectorization is temporarily unavailable.' : msg, 502)
  }
  const svg = payload?.data?.[0]?.svg
  if (!svg || typeof svg !== 'string') return error('Vectorization failed.', 502)
  return json(
    { svg, sandbox: svg.includes('data-quiver-sandbox') || res.headers.get('x-quiver-environment') === 'test', credits: payload?.credits ?? null },
    { headers: { 'cache-control': 'no-store' } },
  )
})
