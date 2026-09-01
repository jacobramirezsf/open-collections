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

// Wraps a handler so unexpected failures become a clean JSON 500 instead of a Vercel error page.
export function handler(fn: (req: Request) => Promise<Response> | Response) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req)
    } catch (e: any) {
      console.error(e)
      const msg = e?.name === 'IndexMissingError' || /index not found/i.test(String(e?.message)) ? 'Search index unavailable' : 'Internal error'
      return error(msg, 500)
    }
  }
}
