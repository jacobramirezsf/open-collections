// Every upstream patent search costs something: a SerpAPI credit, or a strike against our IP at Google
// Patents (which blocks after a handful of uncached searches and stretches the block on every hit).
// This guard keeps upstream traffic as low as possible:
//   1. results cached in memory and in Vercel Blob (shared by every function instance), 7 days fresh;
//   2. identical searches already in flight share one upstream request;
//   3. googleGate(): after Google blocks us, a shared circuit breaker stops direct Google calls for a
//      backoff window (60s, doubling per repeated block, max 15 min);
//   4. when the upstream fails, stale cached results are served if there are any.
// Without BLOB_READ_WRITE_TOKEN (local dev) everything stays in memory.
import { createHash } from 'node:crypto'
import type { Item } from '../../shared/types.js'

export type PatentResult = { items: Item[]; total: number; via?: 'serpapi' | 'google' }

export class PatentsPausedError extends Error {
  retryAfter: number
  constructor(retryAfter: number) {
    super(`Google Patents is limiting searches. Patent search resumes in about ${retryAfter}s.`)
    this.name = 'PatentsPausedError'
    this.retryAfter = retryAfter
  }
}

const FRESH_MS = 7 * 24 * 3600_000 // patent results barely change, and each miss costs a credit
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

const CACHE_VERSION = 'v2' // bump when the cached Item shape changes (v2: full-size figure previews)

export function cacheKey(inner: string): string {
  return createHash('sha1').update(`${CACHE_VERSION}|${inner}`).digest('hex')
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

// Runs a direct Google Patents request unless the breaker is open. `fetchGoogle` throws an error with
// `blocked: true` when Google refuses it; that trips the breaker and becomes a PatentsPausedError.
export async function googleGate(fetchGoogle: () => Promise<PatentResult>): Promise<PatentResult> {
  const wait = await pausedFor()
  if (wait > 0) throw new PatentsPausedError(wait)
  try {
    return await fetchGoogle()
  } catch (e) {
    if (!isBlocked(e)) throw e
    throw new PatentsPausedError(await tripBreaker())
  }
}

// `inner` is the normalized Google query string (the cache key, whichever provider answers it).
export async function guardedSearch(inner: string, fetchUpstream: () => Promise<PatentResult>): Promise<PatentResult> {
  const key = cacheKey(inner)
  const now = Date.now()
  const hot = mem.get(key)
  if (hot && now - hot.at < FRESH_MS) return hot.data

  const pending = inflight.get(key)
  if (pending) return pending

  const run = (async (): Promise<PatentResult> => {
    const stored = hot || (await blobRead<Entry>(cachePath(key)))
    if (stored && Date.now() - stored.at < FRESH_MS) {
      memSet(key, stored)
      return stored.data
    }
    try {
      const data = await fetchUpstream()
      const entry = { at: Date.now(), data }
      memSet(key, entry)
      await blobWrite(cachePath(key), entry)
      return data
    } catch (e) {
      if (stored) return stored.data // stale beats nothing
      throw e
    }
  })()
  inflight.set(key, run)
  try {
    return await run
  } finally {
    inflight.delete(key)
  }
}
