// The Metropolitan Museum of Art — bulk CSV (metadata, CC0) + per-object API calls for image URLs.
// The CSV has no image URLs, so we crawl /objects/{id} for public-domain rows (resumable, rate-limited).
// Docs: https://metmuseum.github.io/  Bulk: https://github.com/metmuseum/openaccess
import { streamCsv, getJson, mapLimit, rateLimiter, sleep } from '../lib/http.mjs'
import { clean, joinUnique, years, RIGHTS } from '../lib/normalize.mjs'

export const key = 'met'
export const name = 'The Met'
export const homepage = 'https://www.metmuseum.org/about-the-met/policies-and-documents/open-access'

const CSV = 'https://media.githubusercontent.com/media/metmuseum/openaccess/master/MetObjects.csv'
const API = 'https://collectionapi.metmuseum.org/public/collection/v1/objects/'

// Fields we keep from the CSV, so the object API is only needed for image URLs.
function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS met_csv (
      id INTEGER PRIMARY KEY, highlight INTEGER, department TEXT, object_name TEXT, title TEXT, culture TEXT, period TEXT,
      artist TEXT, artist_bio TEXT, object_date TEXT, begin_date INTEGER, end_date INTEGER, medium TEXT, country TEXT, city TEXT,
      classification TEXT, tags TEXT, accession TEXT
    );
    CREATE TABLE IF NOT EXISTS met_done (id INTEGER PRIMARY KEY, has_image INTEGER, status INTEGER);
  `)
}

async function loadCsv(store, log) {
  const db = store.db
  const have = db.prepare('SELECT COUNT(*) c FROM met_csv').get().c
  if (have > 100000) {
    log(`met: csv already loaded (${have} public-domain rows)`)
    return
  }
  log('met: downloading MetObjects.csv (~300 MB) …')
  const ins = db.prepare(
    `INSERT OR REPLACE INTO met_csv VALUES (@id,@highlight,@department,@object_name,@title,@culture,@period,@artist,@artist_bio,@object_date,@begin_date,@end_date,@medium,@country,@city,@classification,@tags,@accession)`,
  )
  let n = 0
  let batch = []
  const flush = () => {
    db.exec('BEGIN')
    for (const r of batch) ins.run(r)
    db.exec('COMMIT')
    batch = []
  }
  for await (const r of streamCsv(CSV)) {
    if (r['Is Public Domain'] !== 'True') continue
    batch.push({
      id: Number(r['Object ID']),
      highlight: r['Is Highlight'] === 'True' ? 1 : 0,
      department: r.Department,
      object_name: r['Object Name'],
      title: r.Title,
      culture: r.Culture,
      period: r.Period,
      artist: r['Artist Display Name'],
      artist_bio: r['Artist Display Bio'],
      object_date: r['Object Date'],
      begin_date: Number(r['Object Begin Date']) || null,
      end_date: Number(r['Object End Date']) || null,
      medium: r.Medium,
      country: r.Country,
      city: r.City,
      classification: r.Classification,
      tags: r.Tags,
      accession: r['Object Number'],
    })
    n++
    if (batch.length >= 2000) flush()
    if (n % 50000 === 0) log(`met: csv rows ${n}`)
  }
  flush()
  log(`met: csv loaded, ${n} public-domain rows`)
}

export function normalize(row, obj) {
  // row: met_csv row; obj: /objects/{id} response (for images). Prefer API metadata when present.
  const primary = obj?.primaryImage
  const small = obj?.primaryImageSmall
  if (!primary && !small) return null
  const [ys, ye] = years(obj?.objectBeginDate ?? row.begin_date, obj?.objectEndDate ?? row.end_date, obj?.objectDate ?? row.object_date)
  const artist = clean(obj?.artistDisplayName ?? row.artist)
  const files = [{ format: 'jpg', url: primary || small, label: 'Original' }]
  for (const u of (obj?.additionalImages || []).slice(0, 8)) files.push({ format: 'jpg', url: u, label: 'Additional view' })
  const tags = obj?.tags ? obj.tags.map((t) => t.term).join(' ') : (row.tags || '').replace(/\|/g, ' ')
  return {
    id: `met:${row.id}`,
    source: key,
    sourceId: String(row.id),
    sourceUrl: obj?.objectURL || `https://www.metmuseum.org/art/collection/search/${row.id}`,
    title: clean(obj?.title ?? row.title) || clean(row.object_name) || 'Untitled',
    creator: artist ? (obj?.artistDisplayBio || row.artist_bio ? `${artist} (${clean(obj?.artistDisplayBio ?? row.artist_bio, 120)})` : artist) : null,
    dateDisplay: clean(obj?.objectDate ?? row.object_date),
    yearStart: ys,
    yearEnd: ye,
    objectType: clean(obj?.objectName ?? row.object_name),
    medium: clean(obj?.medium ?? row.medium),
    culture: joinUnique([obj?.culture ?? row.culture, obj?.period ?? row.period]),
    place: joinUnique([obj?.city ?? row.city, obj?.country ?? row.country]),
    ...RIGHTS.CC0,
    thumbnailUrl: small || primary,
    imageUrl: small || primary,
    originalImageUrl: primary || small,
    width: null,
    height: null,
    contentType: 'image',
    files,
    text: [obj?.department ?? row.department, obj?.classification ?? row.classification, tags].filter(Boolean).join(' | '),
    boost: row.highlight ? 2 : 0,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  ensureTables(store.db)
  await loadCsv(store, log)
  const db = store.db
  // Crawl order: highlights first, then round-robin across departments so partial crawls stay diverse.
  const pending = db
    .prepare(
      `SELECT c.* FROM met_csv c LEFT JOIN met_done d ON d.id = c.id WHERE d.id IS NULL
       ORDER BY c.highlight DESC, (c.id % 97), c.department, c.id`,
    )
    .all()
  log(`met: ${pending.length} objects to fetch (${db.prepare('SELECT COUNT(*) c FROM met_done').get().c} done)`)
  const perDept = new Map()
  for (const r of pending) {
    if (!perDept.has(r.department)) perDept.set(r.department, [])
    perDept.get(r.department).push(r)
  }
  const queue = []
  const depts = [...perDept.values()]
  for (let i = 0; queue.length < pending.length; i++) for (const d of depts) if (d[i]) queue.push(d[i])
  const highlights = queue.filter((r) => r.highlight)
  const rest = queue.filter((r) => !r.highlight)
  const order = highlights.concat(rest).slice(0, Number.isFinite(limit) ? limit : undefined)

  const markDone = db.prepare('INSERT OR REPLACE INTO met_done (id, has_image, status) VALUES (?, ?, ?)')
  const throttle = rateLimiter(Number(process.env.MET_RPS || 12))
  let n = 0
  let done = 0
  let consecutiveErrors = 0
  const t0 = Date.now()
  await mapLimit(
    order,
    Number(process.env.MET_CONCURRENCY || 6),
    async (row) => {
      await throttle()
      let obj
      try {
        obj = await getJson(API + row.id, { retries: 2, timeoutMs: 20000 })
        consecutiveErrors = 0
      } catch (e) {
        if (e.status === 404) {
          markDone.run(row.id, 0, 404)
          return
        }
        consecutiveErrors++
        if (consecutiveErrors <= 3 || consecutiveErrors % 10 === 0) log(`met: error on ${row.id}: ${e.message} (${consecutiveErrors} in a row)`)
        if (consecutiveErrors > 60) throw new Error('met: too many consecutive errors, stopping (resume later)')
        await sleep(Math.min(60000, 2000 * consecutiveErrors))
        return // leave undone for a future run
      }
      const rec = normalize(row, obj)
      if (rec) {
        store.put(rec)
        n++
      }
      markDone.run(row.id, rec ? 1 : 0, 200)
      done++
      if (done % 500 === 0) {
        store.flush()
        const rate = done / ((Date.now() - t0) / 1000)
        log(`met: ${done}/${order.length} fetched, ${n} with images, ${rate.toFixed(1)}/s, eta ${((order.length - done) / rate / 60).toFixed(0)} min`)
      }
    },
    { onError: (e) => { throw e } },
  )
  store.flush()
  log(`met: crawl pass complete, ${n} new records with images`)
}
