// POST /api/auth { action: 'signup' | 'login' | 'logout', username?, password? }
// GET  /api/auth → { user: username | null }
import { handler, json, error, params } from './_lib/http.js'
import { CLEAR_COOKIE, codeHash, hashPassword, makeSessionCookie, readUser, sessionUser, throttle, validEmail, validUsername, verifyPassword, writeUser } from './_lib/auth.js'

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
  if (action === 'me') {
    const u = sessionUser(req)
    if (!u) return json({ user: null }, { headers: { 'cache-control': 'no-store' } })
    const rec = await readUser(u)
    return json({ user: u, email: rec?.email || null }, { headers: { 'cache-control': 'no-store' } })
  }
  if (action === 'set-email') {
    const u = sessionUser(req)
    if (!u) return error('Sign in first.', 401)
    const email = String(body?.email || '').toLowerCase().trim()
    if (email && !validEmail(email)) return error('That email address doesn\u2019t look right.')
    const rec = await readUser(u)
    if (!rec) return error('Account not found.', 404)
    if (email) rec.email = email
    else delete rec.email
    delete rec.reset
    await writeUser(rec)
    return json({ ok: true, email: email || null }, { headers: { 'cache-control': 'no-store' } })
  }
  const username = String(body?.username || '').toLowerCase().trim()
  const password = String(body?.password || '')
  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim()
  if (!throttle('auth:' + ip)) return error('Too many attempts. Try again in a few minutes.', 429)
  if (!validUsername(username)) return error('Username: 3–24 characters, letters/numbers/dashes/underscores, starting with a letter or number.')
  if (action === 'signup') {
    if (password.length < 8) return error('Password must be at least 8 characters.')
    const email = String(body?.email || '').toLowerCase().trim()
    if (email && !validEmail(email)) return error('That email address doesn\u2019t look right.')
    if (await readUser(username)) return error('That username is taken.', 409)
    const { hash, salt } = await hashPassword(password)
    await writeUser({ username, hash, salt, createdAt: Date.now(), ...(email ? { email } : {}) })
    return json({ ok: true, user: username }, { headers: { 'set-cookie': makeSessionCookie(username), 'cache-control': 'no-store' } })
  }
  if (action === 'forgot') {
    // always answer the same way — don't leak which accounts exist or have email on file
    const generic = json({ ok: true, message: 'If that account has an email on file, a reset code is on its way.' }, { headers: { 'cache-control': 'no-store' } })
    if (!throttle('forgot:' + ip, 5)) return error('Too many attempts. Try again in a few minutes.', 429)
    const key = process.env.RESEND_API_KEY
    if (!key) return error('Password reset by email isn\u2019t set up yet.', 501)
    const rec = await readUser(username)
    if (!rec?.email) return generic
    const code = String(Math.floor(100000 + Math.random() * 900000))
    rec.reset = { codeHash: codeHash(code), exp: Date.now() + 15 * 60 * 1000, tries: 0 }
    await writeUser(rec)
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM || 'Open Collections <onboarding@resend.dev>',
        to: [rec.email],
        subject: `${code} is your Open Collections reset code`,
        text: `Hi ${rec.username},\n\nYour password reset code is: ${code}\n\nIt works for 15 minutes. If you didn\u2019t ask for this, you can ignore it \u2014 your password is unchanged.\n\n\u2014 Open Collections`,
      }),
    }).catch(() => {})
    return generic
  }
  if (action === 'reset') {
    const code = String(body?.code || '').trim()
    if (password.length < 8) return error('New password must be at least 8 characters.')
    const rec = await readUser(username)
    if (!rec?.reset || rec.reset.exp < Date.now()) return error('That code has expired \u2014 request a new one.', 400)
    rec.reset.tries++
    if (rec.reset.tries > 5) {
      delete rec.reset
      await writeUser(rec)
      return error('Too many wrong codes \u2014 request a new one.', 429)
    }
    if (codeHash(code) !== rec.reset.codeHash) {
      await writeUser(rec)
      return error('Wrong code.', 401)
    }
    const { hash, salt } = await hashPassword(password)
    rec.hash = hash
    rec.salt = salt
    delete rec.reset
    await writeUser(rec)
    return json({ ok: true, user: username }, { headers: { 'set-cookie': makeSessionCookie(username), 'cache-control': 'no-store' } })
  }
  if (action === 'login') {
    const rec = await readUser(username)
    if (!rec || !(await verifyPassword(password, rec))) return error('Wrong username or password.', 401)
    return json({ ok: true, user: username }, { headers: { 'set-cookie': makeSessionCookie(username), 'cache-control': 'no-store' } })
  }
  return error('unknown action')
})
