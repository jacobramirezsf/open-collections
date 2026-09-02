import { handler, json } from './_lib/http.js'
import { SOURCE_META } from './_lib/sources.js'
import { SHARD_KEYS, callShard } from './_lib/router.js'
import type { SourceInfo } from '../shared/types.js'

interface ShardStatus {
  shard: string
  builtAt: string | null
  sources: { key: string; count: number; images: number; models: number; pd: number }[]
}

export default handler(async (req: Request) => {
  const settled = await Promise.allSettled(SHARD_KEYS.map((k) => callShard<ShardStatus>(req, k, 'op=status')))
  const okResponses = settled.filter((r): r is PromiseFulfilledResult<ShardStatus> => r.status === 'fulfilled').map((r) => r.value)
  const byKey = new Map<string, { key: string; count: number; images: number; models: number; pd: number }>()
  for (const r of okResponses) for (const s of r.sources) if (!byKey.has(s.key) || byKey.get(s.key)!.count < s.count) byKey.set(s.key, s)
  const sources: SourceInfo[] = [...byKey.values()]
    .sort((a, b) => b.count - a.count)
    .map((s) => ({
      ...(SOURCE_META[s.key] ?? { key: s.key, name: s.key, homepage: '', license: '' }),
      count: s.count,
      contentTypes: [...(s.images ? ['image' as const] : []), ...(s.models ? ['3d' as const] : [])],
    }))
  return json({
    ok: okResponses.length === SHARD_KEYS.length,
    shards: { total: SHARD_KEYS.length, up: okResponses.length },
    builtAt: okResponses.map((r) => r.builtAt).find(Boolean) ?? null,
    total: sources.reduce((a, s) => a + s.count, 0),
    sources,
  })
})
