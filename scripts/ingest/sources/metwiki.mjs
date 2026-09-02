// The Met via Wikidata/Wikimedia Commons: fills Met objects the API crawl hasn't reached yet.
// Wikidata items carry the Met object ID (P3634) and a Commons image (P18); metadata comes from the
// already-loaded MetObjects.csv table (met_csv in the met staging file). Records share the met:{id}
// namespace, and the direct API crawl (better images) wins over these when both exist.
// Refresh data/raw/met-wikidata.csv with:
//   curl -s https://qlever.dev/api/wikidata --data-urlencode 'query=SELECT ?metId ?image WHERE {
//     ?item <http://www.wikidata.org/prop/direct/P3634> ?metId .
//     ?item <http://www.wikidata.org/prop/direct/P18> ?image }' -H 'Accept: text/csv' -o data/raw/met-wikidata.csv
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseCsvStream } from '../lib/http.mjs'
import { Readable } from 'node:stream'
import { normalize as metNormalize } from './met.mjs'
import { stagingPath } from '../lib/store.mjs'

export const key = 'metwiki'
export const name = 'The Met (via Wikimedia Commons)'

const CSV = path.resolve(import.meta.dirname, '../../../data/raw/met-wikidata.csv')

export function commonsUrls(filename) {
  const enc = encodeURIComponent(filename)
  return {
    thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}?width=600`,
    image: `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}?width=1600`,
    original: `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}`,
  }
}

export async function ingest(store, { log }) {
  if (!fs.existsSync(CSV)) throw new Error('data/raw/met-wikidata.csv missing (see header of metwiki.mjs)')
  const metDb = new DatabaseSync(stagingPath('met'), { readOnly: true })
  const csvRow = metDb.prepare('SELECT * FROM met_csv WHERE id = ?')
  const crawled = new Set(metDb.prepare("SELECT source_id FROM items").all().map((r) => r.source_id))
  let n = 0
  let skippedCrawled = 0
  let noCsv = 0
  for await (const r of parseCsvStream(Readable.from([fs.readFileSync(CSV, 'utf8')]))) {
    const metId = r.metId?.trim()
    const img = r.image?.trim()
    if (!metId || !img || !/^\d+$/.test(metId)) continue
    if (crawled.has(metId)) {
      skippedCrawled++
      continue // the API crawl already produced a better record
    }
    const row = csvRow.get(Number(metId))
    if (!row) {
      noCsv++ // not public domain (or not in the CSV) — skip
      continue
    }
    const m = img.match(/Special:FilePath\/(.+)$/)
    if (!m) continue
    let filename
    try {
      filename = decodeURIComponent(m[1])
    } catch {
      continue
    }
    if (!/\.(jpe?g|png|tiff?)$/i.test(filename)) continue
    const urls = commonsUrls(filename)
    // Reuse the met normalizer's CSV mapping by faking the object-API part with Commons URLs.
    const rec = metNormalize(row, { primaryImage: urls.original, primaryImageSmall: urls.thumb })
    if (!rec) continue
    rec.thumbnailUrl = urls.thumb
    rec.imageUrl = urls.image
    rec.originalImageUrl = urls.original
    rec.files = [{ format: (filename.match(/\.([a-z]+)$/i)?.[1] || 'jpg').toLowerCase(), url: urls.original, label: 'Original (Wikimedia Commons)' }]
    if (store.put(rec)) n++
  }
  store.flush()
  metDb.close()
  log(`metwiki: ${n} records (${skippedCrawled} already crawled, ${noCsv} not in PD csv)`)
}
