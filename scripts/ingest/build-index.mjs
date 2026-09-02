#!/usr/bin/env node
// Builds the compact, FTS5-indexed data/index.sqlite from data/staging/items.sqlite.
// The API bundles this file; rebuilding is safe at any time (writes to a temp file, then swaps).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, STAGING_DIR } from './lib/store.mjs'
import { compactImages, defaultRecordUrl, defaultRights } from '../../shared/urls.ts'

const OUT = path.join(ROOT, 'data/index.sqlite')
// Per-source caps keep the bundled index under Vercel's 250 MB function limit. Override with
// CAPS="rijks=60000,si=100000". Capped sources keep highlights first, then a stable pseudo-random subset.
const DEFAULT_CAPS = { rijks: 240000, si: 210000, met: 260000, aic: 60000, nga: 65000, cma: 45000, wellcome: 80000, nih3d: 25000, metwiki: 260000 }
const CAPS = { ...DEFAULT_CAPS }
for (const kv of (process.env.CAPS || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=')
  CAPS[k] = Number(v)
}
const TMP = OUT + '.building'
const stagingFiles = fs.existsSync(STAGING_DIR) ? fs.readdirSync(STAGING_DIR).filter((f) => f.endsWith('.sqlite')) : []
if (!stagingFiles.length) {
  console.error('No staging databases. Run `npm run ingest -- <source>` first.')
  process.exit(1)
}
fs.rmSync(TMP, { force: true })
const db = new DatabaseSync(TMP)
db.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;
  PRAGMA page_size = 4096;
  CREATE TABLE items (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    img TEXT,
    title TEXT NOT NULL,
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
    content_type TEXT NOT NULL,
    files TEXT,
    source_url TEXT,
    boost INTEGER DEFAULT 0
  );
  CREATE VIRTUAL TABLE fts USING fts5(
    title, creator, object_type, medium, culture, place, text,
    content='', tokenize='porter unicode61 remove_diacritics 2', detail='full'
  );
`)
for (const f of stagingFiles) {
  const p = path.join(STAGING_DIR, f)
  db.exec(`ATTACH DATABASE '${p.replace(/'/g, "''")}' AS st`)
  const before = db.prepare('SELECT COUNT(*) c FROM items').get().c
  const srcKey = f.replace(/\.sqlite$/, '')
  const cap = CAPS[srcKey] ?? 1e9
  const rows = db.prepare(`SELECT * FROM st.items WHERE title IS NOT NULL AND title != '' ORDER BY boost DESC, ((rowid * 2654435761) % 1000003), source_id LIMIT ?`).all(cap)
  const ins = db.prepare(`INSERT OR IGNORE INTO items (id, source, source_id, img, title, creator, date_display, year_start, year_end, object_type, medium, culture, place,
      public_domain, rights_label, license_url, thumb_url, image_url, original_url, width, height, content_type, files, source_url, boost)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insFts = db.prepare('INSERT INTO fts (rowid, title, creator, object_type, medium, culture, place, text) VALUES (?,?,?,?,?,?,?,?)')
  db.exec('BEGIN')
  let compacted = 0
  for (const r of rows) {
    const key = compactImages(r.source, { thumb: r.thumb_url, image: r.image_url, original: r.original_url })
    if (key) compacted++
    let files = r.files && r.files !== '[]' ? JSON.parse(r.files) : []
    // Drop files that are just the original image (the API re-derives them).
    files = files.filter((f) => f.url !== r.original_url)
    const rights = defaultRights(r.source)
    const sameRights = rights && rights.publicDomain === (r.public_domain == null ? null : r.public_domain === 1) && rights.label === r.rights_label && rights.licenseUrl === r.license_url
    const recUrl = defaultRecordUrl(r.source, r.source_id, key)
    const res = ins.run(
      r.id, r.source, r.source_id, key, r.title, trim(r.creator, 140), r.date_display, r.year_start, r.year_end, trim(r.object_type, 100), trim(r.medium, 160), trim(r.culture, 100), trim(r.place, 100),
      sameRights ? null : r.public_domain, sameRights ? null : r.rights_label, sameRights ? null : r.license_url,
      key ? null : r.thumb_url, key ? null : r.image_url, key ? null : r.original_url, r.width, r.height, r.content_type,
      files.length ? JSON.stringify(files) : null, recUrl === r.source_url ? null : r.source_url, r.boost,
    )
    if (res.changes) insFts.run(res.lastInsertRowid, r.title, r.creator, r.object_type, r.medium, r.culture, r.place, trim(r.text, 260))
  }
  db.exec('COMMIT')
  db.exec('DETACH DATABASE st')
  console.log(`    compacted image urls: ${compacted}/${rows.length}`)
  console.log(`  + ${f}: ${db.prepare('SELECT COUNT(*) c FROM items').get().c - before} items`)
}
db.exec(`
  CREATE INDEX items_source ON items(source);
  CREATE INDEX items_source_year ON items(source, year_start);
  CREATE INDEX items_content ON items(content_type, source);
  INSERT INTO fts(fts) VALUES('optimize');
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO meta VALUES ('built_at', '${new Date().toISOString()}');
  CREATE TABLE sources AS SELECT source AS key, COUNT(*) AS count,
    SUM(content_type = 'image') AS images, SUM(content_type = '3d') AS models, 0 AS pd FROM items GROUP BY source;
`)
for (const s of db.prepare('SELECT key FROM sources').all()) {
  const d = defaultRights(s.key)
  const pd = db.prepare(`SELECT SUM(CASE WHEN public_domain IS NOT NULL THEN public_domain ELSE ? END) pd FROM items WHERE source = ?`).get(d?.publicDomain ? 1 : 0, s.key).pd
  db.prepare('UPDATE sources SET pd = ? WHERE key = ?').run(pd || 0, s.key)
}
db.exec('VACUUM')
function trim(v, n) {
  if (v == null) return null
  const t = String(v)
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const total = db.prepare('SELECT COUNT(*) c FROM items').get().c
const sources = db.prepare('SELECT * FROM sources ORDER BY count DESC').all()
db.close()
fs.renameSync(TMP, OUT)
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1)
console.log(`Built ${OUT}: ${total} items, ${mb} MB`)
for (const s of sources) console.log(`  ${s.key.padEnd(8)} ${String(s.count).padStart(8)}  images ${s.images}  3d ${s.models}  pd ${s.pd}`)
