// POST /api/removebg { id } → PNG with the background removed, via the remove.bg API.
// The key stays server-side (env REMOVE_BG_KEY). remove.bg credits are PAID, so a small per-IP
// daily cap is enforced, persisted in Vercel Blob when available (falls back to per-instance memory).
// Returns 501 when no key is configured so the UI can hide/explain the feature.
import { handler, error, json } from './_lib/http.js'
import { getItemById } from './_lib/items.js'

export const config = { maxDuration: 60 }

const DAILY_CAP = Number(process.env.REMOVEBG_DAILY_CAP || 20)
const memCounts = new Map<string, number>()

function day(): string {
  return new Date().toISOString().slice(0, 10)
}

async function quota(ip: string): Promise<{ ok: boolean; used: number }> {
  const keyName = `removebg/${day()}/${ip.replace(/[^a-zA-Z0-9.:_-]/g, '')}.json`
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    const used = (memCounts.get(day() + ip) || 0) + 1
    memCounts.set(day() + ip, used)
    return { ok: used <= DAILY_CAP, used }
  }
  const { put } = await import('@vercel/blob')
  const base = process.env.BLOB_BASE_URL
  let used = 0
  try {
    const head = await import('@vercel/blob').then((m) => m.head(keyName, { token }))
    const res = await fetch(head.url + '?t=' + Date.now())
    if (res.ok) used = Number(((await res.json()) as any)?.used) || 0
  } catch {
    /* first request today */
  }
  used++
  if (used > DAILY_CAP) return { ok: false, used }
  await put(keyName, JSON.stringify({ used }), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', token, cacheControlMaxAge: 0 }).catch(() => {})
  void base
  return { ok: true, used }
}

export default handler(async (req: Request) => {
  if (req.method !== 'POST') return error('POST only', 405)
  const key = process.env.REMOVE_BG_KEY
  if (!key) return error('Background removal is not configured (missing REMOVE_BG_KEY).', 501)
  let body: any
  try {
    body = await req.json()
  } catch {
    return error('invalid body')
  }
  const item = getItemById(String(body?.id || ''))
  if (!item) return error('not found', 404)
  const imageUrl = item.imageUrl || item.thumbnailUrl
  if (!imageUrl) return error('no image', 404)

  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim()
  const q = await quota(ip)
  if (!q.ok) return error(`Daily background-removal limit reached (${DAILY_CAP}/day). Try again tomorrow.`, 429)

  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'content-type': 'application/json', accept: 'image/png' },
    body: JSON.stringify({ image_url: imageUrl, size: 'auto', format: 'png' }),
  })
  if (!res.ok) {
    let msg = `remove.bg error (${res.status})`
    try {
      const e = (await res.json()) as any
      msg = e?.errors?.[0]?.title || msg
    } catch {
      /* binary/none */
    }
    if (res.status === 402) msg = 'remove.bg is out of credits.'
    return json({ error: msg }, { status: res.status === 402 || res.status === 403 ? 502 : 502, headers: { 'cache-control': 'no-store' } })
  }
  return new Response(res.body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=3600',
      'x-removebg-used': String(q.used),
    },
  })
})
