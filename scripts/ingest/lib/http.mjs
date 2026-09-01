// Small fetch helpers for ingestion: retries, timeouts, concurrency, gzip/ndjson streaming.
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import readline from 'node:readline'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DEFAULT_UA = 'open-collections-ingest/1.0 (+https://github.com/jacobramirezsf/open-collections)'

export async function fetchWithRetry(url, { retries = 4, timeoutMs = 30000, headers = {}, method = 'GET', body, backoffMs = 800 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { method, body, headers: { 'user-agent': DEFAULT_UA, ...headers }, signal: ctrl.signal, redirect: 'follow' })
      clearTimeout(t)
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`)
        const ra = Number(res.headers.get('retry-after'))
        await sleep(ra ? ra * 1000 : backoffMs * 2 ** attempt)
        continue
      }
      return res
    } catch (e) {
      clearTimeout(t)
      lastErr = e
      await sleep(backoffMs * 2 ** attempt)
    }
  }
  throw lastErr
}

export async function getJson(url, opts = {}) {
  const res = await fetchWithRetry(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`)
    err.status = res.status
    throw err
  }
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 120)}`)
  }
}

export async function getText(url, opts = {}) {
  const res = await fetchWithRetry(url, opts)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

// Run fn over items with a concurrency limit. Errors are passed to onError (default: log) and skipped.
export async function mapLimit(items, limit, fn, { onError } = {}) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      try {
        out[idx] = await fn(items[idx], idx)
      } catch (e) {
        out[idx] = undefined
        if (onError) onError(e, items[idx])
        else console.error('  ! ' + (e?.message || e))
      }
    }
  })
  await Promise.all(workers)
  return out
}

// Simple token-bucket rate limiter: await limiter() before each request.
export function rateLimiter(perSecond) {
  let last = 0
  const interval = 1000 / perSecond
  let queue = Promise.resolve()
  return () => {
    queue = queue.then(async () => {
      const now = Date.now()
      const wait = Math.max(0, last + interval - now)
      if (wait) await sleep(wait)
      last = Date.now()
    })
    return queue
  }
}

// Stream a (possibly gzipped) newline-delimited text URL line by line.
export async function* streamLines(url, { gzip = 'auto', headers = {} } = {}) {
  const res = await fetchWithRetry(url, { timeoutMs: 120000, headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  let stream = Readable.fromWeb(res.body)
  const isGz = gzip === true || (gzip === 'auto' && (/\.gz($|\?)/.test(url) || res.headers.get('content-type')?.includes('gzip')))
  if (isGz) stream = stream.pipe(createGunzip())
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) yield line
}

// Minimal CSV parser (RFC 4180-ish, handles quotes, embedded newlines) streaming rows from a URL or Readable.
export async function* streamCsv(url, { headers = {} } = {}) {
  const res = await fetchWithRetry(url, { timeoutMs: 600000, headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  yield* parseCsvStream(Readable.fromWeb(res.body))
}

export async function* parseCsvStream(stream) {
  stream.setEncoding('utf8')
  let field = ''
  let row = []
  let inQuotes = false
  let header = null
  let pendingCR = false
  const emit = () => {
    row.push(field)
    field = ''
    const r = row
    row = []
    return r
  }
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i]
      if (inQuotes) {
        if (c === '"') {
          if (chunk[i + 1] === '"') {
            field += '"'
            i++
          } else inQuotes = false
        } else field += c
        continue
      }
      if (c === '"') inQuotes = true
      else if (c === ',') {
        row.push(field)
        field = ''
      } else if (c === '\n' || c === '\r') {
        if (c === '\r') pendingCR = true
        else if (pendingCR) {
          pendingCR = false
          continue
        }
        if (c === '\r' && chunk[i + 1] === '\n') {
          i++
          pendingCR = false
        }
        const r = emit()
        if (!header) header = r.map((h) => h.replace(/^﻿/, '').trim())
        else if (r.length > 1 || r[0] !== '') {
          const obj = {}
          for (let k = 0; k < header.length; k++) obj[header[k]] = r[k] ?? ''
          yield obj
        }
      } else {
        pendingCR = false
        field += c
      }
    }
  }
  if (field !== '' || row.length) {
    const r = emit()
    if (header && (r.length > 1 || r[0] !== '')) {
      const obj = {}
      for (let k = 0; k < header.length; k++) obj[header[k]] = r[k] ?? ''
      yield obj
    }
  }
}
