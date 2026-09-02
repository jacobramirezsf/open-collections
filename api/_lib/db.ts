// Opens the read-only search index (data/index.sqlite) once per process.
// On Vercel the file is bundled via vercel.json `includeFiles`; locally it comes from `npm run index:build`.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

let db: DatabaseSync | null = null
let dbPath: string | null = null

function locate(): string | null {
  const candidates = [
    process.env.INDEX_PATH,
    '/tmp/oc-index.sqlite',
    path.join(process.cwd(), 'data/index.sqlite'),
    path.resolve(import.meta.dirname ?? '.', '../../data/index.sqlite'),
    '/var/task/data/index.sqlite',
  ].filter(Boolean) as string[]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

export function getDb(): DatabaseSync {
  if (db) return db
  dbPath = locate()
  if (!dbPath) throw new IndexMissingError()
  db = new DatabaseSync(dbPath, { readOnly: true })
  db.exec('PRAGMA query_only = 1')
  return db
}

// The index is no longer bundled with the function (it outgrew Vercel's 250 MB limit). On a cold
// start we stream it from INDEX_URL (a GitHub release asset) into /tmp once per instance; warm
// invocations reuse the open handle. Redeploys recycle instances, so a new upload + redeploy is
// enough to roll the index. Locally, data/index.sqlite is used directly.
const TMP_PATH = '/tmp/oc-index.sqlite'
let downloading: Promise<void> | null = null

export async function ensureDb(): Promise<DatabaseSync> {
  if (db) return db
  if (!locate()) {
    const url = process.env.INDEX_URL
    if (!url) throw new IndexMissingError()
    if (!downloading) {
      downloading = (async () => {
        const t0 = Date.now()
        const res = await fetch(url, { redirect: 'follow' })
        if (!res.ok || !res.body) throw new Error(`index download failed: HTTP ${res.status}`)
        const part = TMP_PATH + '.part'
        await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(part))
        fs.renameSync(part, TMP_PATH)
        console.log(`index: downloaded ${(fs.statSync(TMP_PATH).size / 1e6).toFixed(0)} MB in ${Date.now() - t0} ms`)
      })().catch((e) => {
        downloading = null
        throw e
      })
    }
    await downloading
    process.env.INDEX_PATH = TMP_PATH
  }
  return getDb()
}

export class IndexMissingError extends Error {
  constructor() {
    super('Search index not found (data/index.sqlite). Run `npm run index:build` or set INDEX_URL for the build.')
  }
}

export function indexMeta(): { builtAt: string | null; path: string | null } {
  try {
    const d = getDb()
    const row = d.prepare("SELECT value FROM meta WHERE key = 'built_at'").get() as { value: string } | undefined
    return { builtAt: row?.value ?? null, path: dbPath }
  } catch {
    return { builtAt: null, path: null }
  }
}
