import { handler, json } from './_lib/http.ts'
import { indexMeta } from './_lib/db.ts'
import { listSources } from './_lib/search.ts'
import { SOURCE_META } from './_lib/sources.ts'
import type { SourceInfo } from '../shared/types.ts'

export default handler(async () => {
  const meta = indexMeta()
  let sources: SourceInfo[] = []
  let ok = true
  try {
    sources = listSources().map((s) => ({
      ...(SOURCE_META[s.key] ?? { key: s.key, name: s.key, homepage: '', license: '' }),
      count: s.count,
      contentTypes: [...(s.images ? ['image' as const] : []), ...(s.models ? ['3d' as const] : [])],
    }))
  } catch {
    ok = false
  }
  return json({ ok, builtAt: meta.builtAt, total: sources.reduce((a, s) => a + s.count, 0), sources })
})
