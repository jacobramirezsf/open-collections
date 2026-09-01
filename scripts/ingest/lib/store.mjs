// Staging store: data/staging/items.sqlite. Adapters upsert normalized records here;
// build-index.mjs turns it into the compact, FTS-indexed data/index.sqlite that ships with the API.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '../../..')
export const STAGING_DIR = path.join(ROOT, 'data/staging')
export const stagingPath = (source) => path.join(STAGING_DIR, `${source}.sqlite`)

const COLS = [
  'id', 'source', 'source_id', 'title', 'creator', 'date_display', 'year_start', 'year_end',
  'object_type', 'medium', 'culture', 'place', 'public_domain', 'rights_label', 'license_url',
  'thumb_url', 'image_url', 'original_url', 'width', 'height', 'content_type', 'files', 'source_url', 'text', 'boost', 'updated_at',
]

// One staging file per source so adapters can run in parallel without lock contention.
export function openStaging(source) {
  fs.mkdirSync(STAGING_DIR, { recursive: true })
  const db = new DatabaseSync(stagingPath(source))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT,
      creator TEXT,
      date_display TEXT,
      year_start INTEGER,
      year_end INTEGER,
      object_type TEXT,
      medium TEXT,
      culture TEXT,
      place TEXT,
      public_domain INTEGER,
      rights_label TEXT,
      license_url TEXT,
      thumb_url TEXT,
      image_url TEXT,
      original_url TEXT,
      width INTEGER,
      height INTEGER,
      content_type TEXT NOT NULL DEFAULT 'image',
      files TEXT,
      source_url TEXT,
      text TEXT,
      boost INTEGER DEFAULT 0,
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS items_source ON items(source);
    CREATE TABLE IF NOT EXISTS progress (key TEXT PRIMARY KEY, value TEXT);
  `)
  const upsertStmt = db.prepare(
    `INSERT INTO items (${COLS.join(',')}) VALUES (${COLS.map((c) => '@' + c).join(',')})
     ON CONFLICT(id) DO UPDATE SET ${COLS.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}`,
  )
  const getProgress = db.prepare('SELECT value FROM progress WHERE key = ?')
  const setProgress = db.prepare('INSERT INTO progress(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')

  let batch = []
  const flush = () => {
    if (!batch.length) return
    db.exec('BEGIN')
    try {
      for (const r of batch) upsertStmt.run(r)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    batch = []
  }

  return {
    db,
    // rec: normalized Item-like object (camelCase, see shared/types.ts) plus optional `text`, `boost`.
    put(rec) {
      const row = toRow(rec)
      if (!row) return false
      batch.push(row)
      if (batch.length >= 500) flush()
      return true
    },
    flush,
    count(source) {
      return source
        ? db.prepare('SELECT COUNT(*) c FROM items WHERE source = ?').get(source).c
        : db.prepare('SELECT COUNT(*) c FROM items').get().c
    },
    deleteSource(source) {
      flush()
      db.prepare('DELETE FROM items WHERE source = ?').run(source)
    },
    getProgress(key) {
      const r = getProgress.get(key)
      return r ? JSON.parse(r.value) : null
    },
    setProgress(key, value) {
      flush()
      setProgress.run(key, JSON.stringify(value))
    },
    close() {
      flush()
      db.close()
    },
  }
}

function toRow(r) {
  if (!r || !r.id || !r.source || !r.title) return null
  const isImage = (r.contentType || 'image') === 'image'
  if (isImage && !r.thumbnailUrl) return null
  return {
    id: r.id,
    source: r.source,
    source_id: String(r.sourceId ?? r.id.split(':').slice(1).join(':')),
    title: r.title,
    creator: r.creator ?? null,
    date_display: r.dateDisplay ?? null,
    year_start: r.yearStart ?? null,
    year_end: r.yearEnd ?? null,
    object_type: r.objectType ?? null,
    medium: r.medium ?? null,
    culture: r.culture ?? null,
    place: r.place ?? null,
    public_domain: r.publicDomain == null ? null : r.publicDomain ? 1 : 0,
    rights_label: r.rightsLabel ?? 'Rights unclear — check source',
    license_url: r.licenseUrl ?? null,
    thumb_url: r.thumbnailUrl ?? null,
    image_url: r.imageUrl ?? null,
    original_url: r.originalImageUrl ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    content_type: r.contentType || 'image',
    files: JSON.stringify(r.files || []),
    source_url: r.sourceUrl,
    text: r.text ?? null,
    boost: r.boost ?? 0,
    updated_at: Date.now(),
  }
}
