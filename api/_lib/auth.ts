// Self-contained accounts: username + password (scrypt), HMAC-signed session cookie, user records
// as JSON blobs in the project's Vercel Blob store. No third-party auth service, no email required.
import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(_scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>

const SECRET = () => {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET not configured')
  return s
}
const TOKEN = () => process.env.BLOB_READ_WRITE_TOKEN
const SESSION_DAYS = 180

export interface UserRecord {
  username: string
  hash: string
  salt: string
  createdAt: number
  email?: string // optional, user's choice: enables password reset + beta features
  reset?: { codeHash: string; exp: number; tries: number }
}

export function validUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{2,23}$/.test(u)
}

const userKey = (u: string) => `users/${u}.json`

export async function readUser(username: string): Promise<UserRecord | null> {
  const token = TOKEN()
  if (!token) throw new Error('Blob storage not configured')
  try {
    const { head } = await import('@vercel/blob')
    const h = await head(userKey(username), { token })
    const res = await fetch(`${h.url}${h.url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as UserRecord
  } catch {
    return null
  }
}

export async function writeUser(rec: UserRecord): Promise<void> {
  const token = TOKEN()
  if (!token) throw new Error('Blob storage not configured')
  const { put } = await import('@vercel/blob')
  await put(userKey(rec.username), JSON.stringify(rec), {
    access: 'public', // bucket URLs are unguessable; auth material is a salted scrypt hash
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
    token,
  })
}

export async function hashPassword(pw: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const s = salt ?? randomBytes(16).toString('hex')
  const h = await scrypt(pw, s, 64)
  return { hash: h.toString('hex'), salt: s }
}

export async function verifyPassword(pw: string, rec: UserRecord): Promise<boolean> {
  const { hash } = await hashPassword(pw, rec.salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(rec.hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254
}

export function codeHash(code: string): string {
  return createHmac('sha256', SECRET()).update('reset:' + code).digest('hex')
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET()).update(payload).digest('base64url')
}

export function makeSessionCookie(username: string): string {
  const exp = Date.now() + SESSION_DAYS * 86400 * 1000
  const payload = `${username}.${exp}`
  const value = `${payload}.${sign(payload)}`
  return `oc_session=${value}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`
}

export const CLEAR_COOKIE = 'oc_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'

export function sessionUser(req: Request): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|;\s*)oc_session=([^;]+)/)
  if (!m) return null
  const parts = m[1].split('.')
  if (parts.length !== 3) return null
  const [username, exp, sig] = parts
  if (!validUsername(username)) return null
  if (Number(exp) < Date.now()) return null
  const expect = sign(`${username}.${exp}`)
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return username
}

// Small in-memory attempt limiter (per instance) — enough to blunt brute force on a friends tool.
const attempts = new Map<string, { n: number; reset: number }>()
export function throttle(key: string, max = 12, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now()
  const a = attempts.get(key)
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs })
    return true
  }
  a.n++
  return a.n <= max
}
