#!/usr/bin/env node
// Ingestion orchestrator. Usage:
//   node scripts/ingest/run.mjs <source> [<source>...] [--limit N] [--fresh]
//   node scripts/ingest/run.mjs all
// Each adapter in ./sources/<key>.mjs exports { key, name, ingest(store, opts) }.
// Records are upserted into data/staging/items.sqlite; run `npm run index:build` afterwards.
import fs from 'node:fs'
import path from 'node:path'
import { openStaging } from './lib/store.mjs'

const args = process.argv.slice(2)
const flags = {}
const names = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const k = args[i].slice(2)
    const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true
    flags[k] = v
  } else names.push(args[i])
}

const dir = path.join(import.meta.dirname, 'sources')
const available = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''))
const wanted = names.length && names[0] !== 'all' ? names : available
const unknown = wanted.filter((w) => !available.includes(w))
if (unknown.length || !wanted.length) {
  console.error(`Unknown source(s): ${unknown.join(', ')}\nAvailable: ${available.join(', ')}`)
  process.exit(1)
}

const opts = { limit: flags.limit ? Number(flags.limit) : Infinity, fresh: !!flags.fresh, log: (m) => console.log(m) }
let failed = 0
for (const key of wanted) {
  const mod = await import(path.join(dir, key + '.mjs'))
  const store = openStaging(key)
  const t0 = Date.now()
  console.log(`\n=== ${mod.name || key} (${key}) ===`)
  if (opts.fresh) {
    store.deleteSource(key)
    store.setProgress(key, null)
  }
  try {
    await mod.ingest(store, opts)
    store.flush()
    console.log(`--- ${key}: ${store.count(key)} records in staging (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  } catch (e) {
    failed++
    store.flush()
    console.error(`!!! ${key} failed: ${e?.stack || e}`)
    console.error(`--- ${key}: ${store.count(key)} records kept in staging`)
  }
  store.close()
}
process.exit(failed ? 1 : 0)
