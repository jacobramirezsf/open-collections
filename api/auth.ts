// POST /api/auth { action: 'signup' | 'login' | 'logout', username?, password? }
// GET  /api/auth → { user: username | null }
import { handler, json, error, params } from './_lib/http.js'
import { CLEAR_COOKIE, hashPassword, makeSessionCookie, readUser, sessionUser, throttle, validUsername, verifyPassword, writeUser } from './_lib/auth.js'

export default handler(async (req: Request) => {
  void params
  if (req.method === 'GET') {
    return json({ user: sessionUser(req) }, { headers: { 'cache-control': 'no-store' } })
  }
  if (req.method !== 'POST') return error('POST or GET only', 405)
  let body: any
  try {
    body = await req.json()
  } catch {
    return error('invalid body')
  }
  const action = String(body?.action || '')
  if (action === 'logout') {
    return json({ ok: true }, { headers: { 'set-cookie': CLEAR_COOKIE, 'cache-control': 'no-store' } })
  }
  const username = String(body?.username || '').toLowerCase().trim()
  const password = String(body?.password || '')
  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim()
  if (!throttle('auth:' + ip)) return error('Too many attempts — try again in a few minutes.', 429)
  if (!validUsername(username)) return error('Username: 3–24 characters, letters/numbers/dashes/underscores, starting with a letter or number.')
  if (action === 'signup') {
    if (password.length < 8) return error('Password must be at least 8 characters.')
    if (await readUser(username)) return error('That username is taken.', 409)
    const { hash, salt } = await hashPassword(password)
    await writeUser({ username, hash, salt, createdAt: Date.now() })
    return json({ ok: true, user: username }, { headers: { 'set-cookie': makeSessionCookie(username), 'cache-control': 'no-store' } })
  }
  if (action === 'login') {
    const rec = await readUser(username)
    if (!rec || !(await verifyPassword(password, rec))) return error('Wrong username or password.', 401)
    return json({ ok: true, user: username }, { headers: { 'set-cookie': makeSessionCookie(username), 'cache-control': 'no-store' } })
  }
  return error('unknown action')
})
