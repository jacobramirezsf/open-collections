// GET  /api/userdata → { data, updatedAt }  (boards + favorites payload for the signed-in user)
// PUT  /api/userdata { data } → { ok, updatedAt }
//
// Storage detail that matters: Vercel Blob OVERWRITES can take up to ~60 s to propagate, which
// makes a read-modify-write cycle on one file unsafe (a stale read pushed back = data loss).
// So every save is a NEW immutable file `userdata/{user}/{timestamp}.json` (creation is
// consistent), reads pick the newest by name, and older files are pruned best-effort.
import { handler, json, error } from './_lib/http.js'
import { sessionUser } from './_lib/auth.js'

const MAX_BYTES = 4 * 1024 * 1024

function token(): string {
  const t = process.env.BLOB_READ_WRITE_TOKEN
  if (!t) throw new Error('Blob storage not configured')
  return t
}

async function latest(username: string): Promise<{ url: string; ts: number; all: { url: string; pathname: string }[] } | null> {
  const { list } = await import('@vercel/blob')
  const res = await list({ prefix: `userdata/${username}/`, token: token(), limit: 100 })
  const files = res.blobs
    .map((b) => ({ url: b.url, pathname: b.pathname, ts: Number(b.pathname.match(/\/(\d+)\.json$/)?.[1] || 0) }))
    .filter((f) => f.ts > 0)
    .sort((a, b) => b.ts - a.ts)
  if (!files.length) return null
  return { url: files[0].url, ts: files[0].ts, all: files }
}

export default handler(async (req: Request) => {
  const username = sessionUser(req)
  if (!username) return error('Not signed in', 401)
  if (req.method === 'GET') {
    const cur = await latest(username)
    if (!cur) return json({ data: null, updatedAt: null }, { headers: { 'cache-control': 'no-store' } })
    const res = await fetch(cur.url, { cache: 'no-store' })
    if (!res.ok) return json({ data: null, updatedAt: null }, { headers: { 'cache-control': 'no-store' } })
    return json({ data: ((await res.json()) as any)?.data ?? null, updatedAt: cur.ts }, { headers: { 'cache-control': 'no-store' } })
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    const text = await req.text()
    if (text.length > MAX_BYTES) return error('Boards are too large to sync (4 MB limit) — remove some items.', 413)
    let body: any
    try {
      body = JSON.parse(text)
    } catch {
      return error('invalid body')
    }
    const { put, del } = await import('@vercel/blob')
    const ts = Date.now()
    await put(`userdata/${username}/${ts}.json`, JSON.stringify({ data: body?.data ?? null }), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
      token: token(),
    })
    // prune older snapshots, keep the 4 newest (best-effort)
    try {
      const cur = await latest(username)
      const stale = (cur?.all ?? []).slice(4)
      if (stale.length) await del(stale.map((f) => f.url), { token: token() })
    } catch {
      /* pruning is optional */
    }
    return json({ ok: true, updatedAt: ts }, { headers: { 'cache-control': 'no-store' } })
  }
  return error('GET or PUT only', 405)
})
