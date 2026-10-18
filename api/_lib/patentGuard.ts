// Google Patents blocks an IP after a handful of uncached searches, and every new hit while blocked
// stretches the block out. This guard keeps traffic to Google as low as possible:
//   1. results cached in memory and in Vercel Blob (shared by every function instance), 24h fresh;
//   2. identical searches already in flight share one upstream request;
//   3. after a block, a shared circuit breaker stops all upstream calls for a backoff window
//      (60s, doubling per repeated block, max 15 min), serving stale cached results when it can.
// Without BLOB_READ_WRITE_TOKEN (local dev) everything stays in memory.
import { createHash } from 'node:crypto'
import type { Item } from '../../shared/types.js'

export type PatentResult = { items: Item[]; total: number }

export class PatentsPausedError extends Error {
  retryAfter: number
  constructor(retryAfter: number) {
    super(`Google Patents is limiting searches. Patent search resumes in about ${retryAfter}s.`)
    this.name = 'PatentsPausedError'
    this.retryAfter = retryAfter
  }
}

const FRESH_MS = 24 * 3600_000
const MEM_MAX = 300
const BASE_PAUSE_S = 60
const MAX_PAUSE_S = 15 * 60
const STRIKE_RESET_MS = 3600_000 // a block this long after the last pause starts the backoff over

type Entry = { at: number; data: PatentResult }
type Breaker = { until: number; strikes: number; lastBlock: number }

const mem = new Map<string, Entry>()
const inflight = new Map<string, Promise<PatentResult>>()
let breaker: Breaker = { until: 0, strikes: 0, lastBlock: 0 }

const BREAKER_PATH = 'patents/breaker.json'
const cachePath = (key: string) => `patents/cache/${key}.json`

export function cacheKey(inner: string): string {
  return createHash('sha1').update(inner).digest('hex')
}

function memSet(key: string, e: Entry) {
  mem.delete(key)
  mem.set(key, e)
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!)
}

async function blobRead<T>(pathname: string): Promise<T | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return null
  try {
    const { head } = await import('@vercel/blob')
    const h = await head(pathname, { token })
    const res = await fetch(h.url + '?t=' + Date.now())
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null // not found, or Blob unavailable: treat as a miss
  }
}

async function blobWrite(pathname: string, data: unknown): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return
  try {
    const { put } = await import('@vercel/blob')
    await put(pathname, JSON.stringify(data), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', token, cacheControlMaxAge: 0 })
  } catch {
    /* the cache is best-effort */
  }
}

// Seconds left on the pause, checking the shared copy so a block seen by one instance stops all.
async function pausedFor(): Promise<number> {
  const now = Date.now()
  if (breaker.until > now) return Math.ceil((breaker.until - now) / 1000)
  const shared = await blobRead<Breaker>(BREAKER_PATH)
  if (shared && shared.until > breaker.until) breaker = shared
  return breaker.until > now ? Math.ceil((breaker.until - now) / 1000) : 0
}

async function tripBreaker(): Promise<number> {
  const now = Date.now()
  const strikes = now - breaker.lastBlock > STRIKE_RESET_MS ? 1 : breaker.strikes + 1
  const secs = Math.min(MAX_PAUSE_S, BASE_PAUSE_S * 2 ** (strikes - 1))
  breaker = { until: now + secs * 1000, strikes, lastBlock: now }
  await blobWrite(BREAKER_PATH, breaker)
  return secs
}

export function isBlocked(e: unknown): boolean {
  return (e as any)?.blocked === true
}

// `inner` is the normalized Google query string (the cache key); `fetchUpstream` performs the
// actual Google request and throws an error with `blocked: true` when Google refuses it.
export async function guardedSearch(inner: string, fetchUpstream: () => Promise<PatentResult>): Promise<PatentResult> {
  const key = cacheKey(inner)
  const now = Date.now()
  const hot = mem.get(key)
  if (hot && now - hot.at < FRESH_MS) return hot.data

  const pending = inflight.get(key)
  if (pending) return pending

  const run = (async (): Promise<PatentResult> => {
    // read the shared cache and the shared breaker together; both are needed on a miss
    const [stored, wait] = await Promise.all([hot ? Promise.resolve(hot) : blobRead<Entry>(cachePath(key)), pausedFor()])
    if (stored && Date.now() - stored.at < FRESH_MS) {
      memSet(key, stored)
      return stored.data
    }
    if (wait > 0) {
      if (stored) return stored.data // stale beats nothing while paused
      throw new PatentsPausedError(wait)
    }
    try {
      const data = await fetchUpstream()
      const entry = { at: Date.now(), data }
      memSet(key, entry)
      await blobWrite(cachePath(key), entry)
      return data
    } catch (e) {
      if (!isBlocked(e)) throw e
      const secs = await tripBreaker()
      if (stored) return stored.data
      throw new PatentsPausedError(secs)
    }
  })()
  inflight.set(key, run)
  try {
    return await run
  } finally {
    inflight.delete(key)
  }
}
