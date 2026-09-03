#!/usr/bin/env node
// Builds the FTS5-indexed search shards (data/index-a.sqlite, -b, …) from data/staging/*.sqlite.
// Sources are bin-packed into as many shards as needed to stay under ~360 MB each (a Vercel
// function's /tmp holds one shard). The source→shard map is written to shared/shards.json, which
// the API imports — COMMIT it whenever it changes.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, STAGING_DIR } from './lib/store.mjs'
import { compactImages, defaultRecordUrl, defaultRights } from '../../shared/urls.ts'

const SHARD_TARGET_MB = Number(process.env.SHARD_TARGET_MB || 360) // keep well under the 500 MB /tmp per function
const SHARD_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f']
const AVG_BYTES_PER_ROW = 590 // measured incl. FTS; used only for bin-packing
// Per-source caps keep the bundled index under Vercel's 250 MB function limit. Override with
// CAPS="rijks=60000,si=100000". Capped sources keep highlights first, then a stable pseudo-random subset.
// per-source searchable-text budget (chars) — text-heavy sources (OCR snippets) blow up the FTS index
const TEXT_BUDGET = { flickr: 120, europeana: 150, nypl: 60 }
const DEFAULT_CAPS = { europeana: 400000, rijks: 240000, si: 210000, met: 260000, aic: 60000, nga: 65000, cma: 45000, wellcome: 80000, nih3d: 25000, metwiki: 260000 }
const CAPS = { ...DEFAULT_CAPS }
for (const kv of (process.env.CAPS || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=')
  CAPS[k] = Number(v)
}
const stagingFiles = fs.existsSync(STAGING_DIR) ? fs.readdirSync(STAGING_DIR).filter((f) => f.endsWith('.sqlite')) : []
if (!stagingFiles.length) {
  console.error('No staging databases. Run `npm run ingest -- <source>` first.')
  process.exit(1)
}

// ---- shard assignment: greedy bin-pack sources by estimated size ----
function trim(v, n) {
  if (v == null) return null
  const t = String(v)
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const { DatabaseSync: DB } = await import('node:sqlite')
const sourcesInfo = []
for (const f of stagingFiles) {
  const srcKey = f.replace(/\.sqlite$/, '')
  const db = new DB(path.join(STAGING_DIR, f), { readOnly: true })
  const c = db.prepare("SELECT COUNT(*) c FROM items WHERE title IS NOT NULL AND title != ''").get().c
  db.close()
  const cap = CAPS[srcKey] ?? 1e9
  const rows = Math.min(c, cap)
  // estimate final bytes from the staging file's actual density (compaction + FTS ≈ 0.8×)
  const stBytes = fs.statSync(path.join(STAGING_DIR, f)).size
  const perRow = c ? Math.min(1400, Math.max(420, (stBytes / c) * 0.8)) : 590
  sourcesInfo.push({ file: f, srcKey, rows, bytes: Math.round(rows * perRow) })
}
// met + metwiki share the met:{id} namespace — they must live in the SAME shard so INSERT OR IGNORE
// dedupes them (metwiki fills gaps until the API crawl overwrites). Merge them into one pack unit.
const metIdx = sourcesInfo.findIndex((s) => s.srcKey === 'met')
const wikiIdx = sourcesInfo.findIndex((s) => s.srcKey === 'metwiki')
if (metIdx >= 0 && wikiIdx >= 0) {
  sourcesInfo[metIdx] = { group: [sourcesInfo[metIdx], sourcesInfo[wikiIdx]], srcKey: 'met+metwiki', rows: sourcesInfo[metIdx].rows + sourcesInfo[wikiIdx].rows, bytes: sourcesInfo[metIdx].bytes + sourcesInfo[wikiIdx].bytes }
  sourcesInfo.splice(wikiIdx, 1)
}
sourcesInfo.sort((x, y) => y.bytes - x.bytes)
const nShards = Math.max(1, Math.min(SHARD_LETTERS.length, Math.ceil(sourcesInfo.reduce((a, s) => a + s.bytes, 0) / (SHARD_TARGET_MB * 1e6))))
const shards = SHARD_LETTERS.slice(0, nShards).map((letter) => ({ letter, rows: 0, files: [] }))
for (const src of sourcesInfo) {
  const lightest = shards.reduce((a, b) => (b.rows < a.rows ? b : a))
  for (const unit of src.group ?? [src]) lightest.files.push(unit)
  lightest.rows += src.bytes // pack by estimated bytes
}
console.log(`building ${nShards} shard(s): ` + shards.map((sh) => `${sh.letter}=[${sh.files.map((f) => f.srcKey).join(',')}] ~${Math.round(sh.rows / 1e6)}MB`).join('  '))

const builtAt = new Date().toISOString()
const manifest = { builtAt, shards: {} }

for (const sh of shards) {
  const OUT = path.join(ROOT, `data/index-${sh.letter}.sqlite`)
  const TMP = OUT + '.building'
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
  for (const src of sh.files) {
    const pth = path.join(STAGING_DIR, src.file)
    db.exec(`ATTACH DATABASE '${pth.replace(/'/g, "''")}' AS st`)
    const cap = CAPS[src.srcKey] ?? 1e9
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
      if (res.changes) insFts.run(res.lastInsertRowid, r.title, r.creator, r.object_type, r.medium, r.culture, r.place, trim(r.text, TEXT_BUDGET[r.source] ?? 260))
    }
    db.exec('COMMIT')
    db.exec('DETACH DATABASE st')
    console.log(`  [${sh.letter}] + ${src.srcKey}: ${rows.length} rows (${compacted} compacted)`)
  }
  db.exec(`
    CREATE INDEX items_source ON items(source);
    CREATE INDEX items_source_year ON items(source, year_start);
    CREATE INDEX items_content ON items(content_type, source);
    INSERT INTO fts(fts) VALUES('optimize');
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO meta VALUES ('built_at', '${builtAt}');
    CREATE TABLE sources AS SELECT source AS key, COUNT(*) AS count,
      SUM(content_type = 'image') AS images, SUM(content_type = '3d') AS models, 0 AS pd FROM items GROUP BY source;
  `)
  for (const srow of db.prepare('SELECT key FROM sources').all()) {
    const d = defaultRights(srow.key)
    const pd = db.prepare(`SELECT SUM(CASE WHEN public_domain IS NOT NULL THEN public_domain ELSE ? END) pd FROM items WHERE source = ?`).get(d?.publicDomain ? 1 : 0, srow.key).pd
    db.prepare('UPDATE sources SET pd = ? WHERE key = ?').run(pd || 0, srow.key)
  }
  db.exec('VACUUM')
  const total = db.prepare('SELECT COUNT(*) c FROM items').get().c
  const perSource = db.prepare('SELECT key, count FROM sources ORDER BY count DESC').all()
  db.close()
  fs.renameSync(TMP, OUT)
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1)
  console.log(`shard ${sh.letter}: ${total} items, ${mb} MB → ${OUT}`)
  for (const r of perSource) console.log(`    ${r.key.padEnd(9)} ${String(r.count).padStart(8)}`)
  manifest.shards[sh.letter] = sh.files.map((f) => f.srcKey)
}
// remove shard files beyond what this build produced, plus the legacy single index
for (const letter of SHARD_LETTERS.slice(nShards)) fs.rmSync(path.join(ROOT, `data/index-${letter}.sqlite`), { force: true })
fs.rmSync(path.join(ROOT, 'data/index.sqlite'), { force: true })
fs.writeFileSync(path.join(ROOT, 'shared/shards.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('manifest → shared/shards.json (commit this file: the API routes by it)')
