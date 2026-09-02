export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function error(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, { status, headers: { 'cache-control': 'no-store' } })
}

export function params(req: Request): URLSearchParams {
  return new URL(req.url, 'http://localhost').searchParams
}

export function intParam(p: URLSearchParams, key: string, def: number, min: number, max: number): number {
  const v = p.get(key)
  if (v == null || v === '') return def
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

// Wraps a Web-style handler (Request → Response) so unexpected failures become a clean JSON 500,
// and so it also works when invoked with Node's (req, res) signature (what Vercel's Node runtime uses).
export function handler(fn: (req: Request) => Promise<Response> | Response) {
  const run = async (req: Request): Promise<Response> => {
    try {
      return await fn(req)
    } catch (e: any) {
      console.error(e)
      const msg = e?.name === 'IndexMissingError' || /shard .* not found/i.test(String(e?.message)) ? 'Search index unavailable' : 'Internal error'
      return error(msg, 500)
    }
  }
  return async (req: Request | IncomingMessage, res?: ServerResponse): Promise<Response | void> => {
    if (!res) return run(req as Request)
    const node = req as IncomingMessage
    const proto = (node.headers['x-forwarded-proto'] as string) || 'https'
    const host = (node.headers['x-forwarded-host'] as string) || node.headers.host || 'localhost'
    const url = `${proto}://${host}${node.url || '/'}`
    const headers = new Headers()
    for (const [k, v] of Object.entries(node.headers)) if (typeof v === 'string') headers.set(k, v)
    const method = node.method || 'GET'
    // Vercel's Node runtime pre-reads and parses the request body onto req.body; the raw stream is
    // already consumed, so waiting on it would hang until the function times out.
    let body: any
    let duplex = false
    if (method !== 'GET' && method !== 'HEAD') {
      const raw = (node as any).body
      if (raw !== undefined && raw !== null) {
        body = typeof raw === 'string' || Buffer.isBuffer(raw) ? raw : JSON.stringify(raw)
      } else if (!node.readableEnded) {
        body = Readable.toWeb(node) as any
        duplex = true
      }
    }
    const response = await run(new Request(url, { method, headers, body, ...(duplex ? { duplex: 'half' } : {}) } as RequestInit))
    res.statusCode = response.status
    response.headers.forEach((v, k) => res.setHeader(k, v))
    if (!response.body) {
      res.end()
      return
    }
    const stream = Readable.fromWeb(response.body as any)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    await new Promise<void>((resolve) => res.on('close', resolve))
  }
}
