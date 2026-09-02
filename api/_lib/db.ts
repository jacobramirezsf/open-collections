// Opens one search shard per function instance. Shards are GitHub release assets streamed into
// /tmp on cold start (INDEX_URL_A, INDEX_URL_B, …). Locally, data/index-<shard>.sqlite from
// `npm run index:build` is used directly (fallback: legacy data/index.sqlite).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AsyncLocalStorage } from 'node:async_hooks'

// In production each shard function is its own instance (one entry in the map). The local dev
// server hosts every shard in one process, so the "current shard" is tracked per request via
// AsyncLocalStorage instead of a singleton.
const dbs = new Map<string, DatabaseSync>()
const downloads = new Map<string, Promise<void>>()
const als = new AsyncLocalStorage<string>()

export function withShard<T>(shard: string, fn: () => Promise<T>): Promise<T> {
  return als.run(shard, fn)
}

export class IndexMissingError extends Error {
  constructor(shard: string) {
    super(`Search shard '${shard}' not found. Run \`npm run index:build\` or set INDEX_URL_${shard.toUpperCase()}.`)
    this.name = 'IndexMissingError'
  }
}

function locate(shard: string): string | null {
  const candidates = [
    process.env[`INDEX_PATH_${shard.toUpperCase()}`],
    `/tmp/oc-shard-${shard}.sqlite`,
    path.join(process.cwd(), `data/index-${shard}.sqlite`),
    path.join(process.cwd(), 'data/index.sqlite'),
  ].filter(Boolean) as string[]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

export async function ensureDb(shard: string): Promise<DatabaseSync> {
  const existing = dbs.get(shard)
  if (existing) return existing
  let found = locate(shard)
  if (!found) {
    const url = process.env[`INDEX_URL_${shard.toUpperCase()}`]
    if (!url) throw new IndexMissingError(shard)
    if (!downloads.has(shard)) {
      downloads.set(
        shard,
        (async () => {
          const t0 = Date.now()
          const res = await fetch(url, { redirect: 'follow' })
          if (!res.ok || !res.body) throw new Error(`shard ${shard} download failed: HTTP ${res.status}`)
          const dest = `/tmp/oc-shard-${shard}.sqlite`
          await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest + '.part'))
          fs.renameSync(dest + '.part', dest)
          console.log(`shard ${shard}: downloaded ${(fs.statSync(dest).size / 1e6).toFixed(0)} MB in ${Date.now() - t0} ms`)
        })().catch((e) => {
          downloads.delete(shard)
          throw e
        }),
      )
    }
    await downloads.get(shard)!
    found = locate(shard)
    if (!found) throw new IndexMissingError(shard)
  }
  const db = new DatabaseSync(found, { readOnly: true })
  db.exec('PRAGMA query_only = 1')
  dbs.set(shard, db)
  return db
}

export function getDb(): DatabaseSync {
  const shard = als.getStore() ?? [...dbs.keys()][0]
  const db = shard ? dbs.get(shard) : undefined
  if (!db) throw new Error('shard database not opened yet (call ensureDb first)')
  return db
}

export function indexMeta(): { builtAt: string | null } {
  try {
    const row = getDb().prepare("SELECT value FROM meta WHERE key = 'built_at'").get() as { value: string } | undefined
    return { builtAt: row?.value ?? null }
  } catch {
    return { builtAt: null }
  }
}
