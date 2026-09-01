// Opens the read-only search index (data/index.sqlite) once per process.
// On Vercel the file is bundled via vercel.json `includeFiles`; locally it comes from `npm run index:build`.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

let db: DatabaseSync | null = null
let dbPath: string | null = null

function locate(): string | null {
  const candidates = [
    process.env.INDEX_PATH,
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
