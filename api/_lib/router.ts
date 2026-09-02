// Fan-out helpers for the shard architecture: which shards exist (shared/shards.json, committed by
// `npm run index:build`), which shard holds a source, and self-calls to shard functions.
import manifest from '../../shared/shards.json' with { type: 'json' }
import type { Item } from '../../shared/types.js'

export const SHARDS: Record<string, string[]> = (manifest as any).shards
export const SHARD_KEYS = Object.keys(SHARDS)

const sourceToShard = new Map<string, string>()
for (const [shard, sources] of Object.entries(SHARDS)) for (const s of sources) sourceToShard.set(s, shard)

export function shardForSource(source: string): string | null {
  return sourceToShard.get(source) ?? null
}

export function selfBase(req: Request): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3999'
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function callShard<T>(req: Request, shard: string, qs: string, timeoutMs = 55000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${selfBase(req)}/api/shard-${shard}?${qs}`, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    const body: any = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error || `shard ${shard} returned ${res.status}`)
    return body as T
  } finally {
    clearTimeout(t)
  }
}

export async function getItemsAcrossShards(req: Request, ids: string[]): Promise<Item[]> {
  const byShard = new Map<string, string[]>()
  for (const id of ids) {
    const shard = shardForSource(id.split(':')[0])
    if (!shard) continue
    if (!byShard.has(shard)) byShard.set(shard, [])
    byShard.get(shard)!.push(id)
  }
  const results = await Promise.all(
    [...byShard.entries()].map(([shard, sids]) => callShard<{ items: Item[] }>(req, shard, `op=item&id=${encodeURIComponent(sids.join(','))}`).catch(() => ({ items: [] as Item[] }))),
  )
  const byId = new Map(results.flatMap((r) => r.items).map((i) => [i.id, i]))
  return ids.map((id) => byId.get(id)).filter(Boolean) as Item[]
}
