// Cleveland Museum of Art — Open Access API (no key). Pages the whole CC0+image set, 1000 records per page.
// Docs: https://openaccess-api.clevelandart.org/
import { getJson } from '../lib/http.mjs'
import { clean, joinUnique, years, RIGHTS } from '../lib/normalize.mjs'

export const key = 'cma'
export const name = 'Cleveland Museum of Art'
export const homepage = 'https://www.clevelandart.org/open-access'

const API = 'https://openaccess-api.clevelandart.org/api/artworks/'

export function normalize(a) {
  const img = a.images || {}
  const web = img.web?.url
  if (!web || a.share_license_status !== 'CC0') return null
  const [ys, ye] = years(a.creation_date_earliest, a.creation_date_latest, a.creation_date)
  const creators = (a.creators || []).map((c) => c.description || c.name).filter(Boolean)
  const cultures = Array.isArray(a.culture) ? a.culture : a.culture ? [a.culture] : []
  const files = []
  if (img.print?.url) files.push({ format: 'jpg', url: img.print.url, label: 'Print (~3400px)' })
  if (img.full?.url) files.push({ format: 'tif', url: img.full.url, label: 'Full resolution TIFF' })
  if (!files.length) files.push({ format: 'jpg', url: web, label: 'Web' })
  return {
    id: `cma:${a.id}`,
    source: key,
    sourceId: String(a.id),
    sourceUrl: a.url || `https://clevelandart.org/art/${a.accession_number}`,
    title: clean(a.title) || 'Untitled',
    creator: joinUnique(creators),
    dateDisplay: clean(a.creation_date),
    yearStart: ys,
    yearEnd: ye,
    objectType: clean(a.type),
    medium: clean(a.technique),
    culture: joinUnique(cultures),
    place: null,
    ...RIGHTS.CC0,
    thumbnailUrl: web,
    imageUrl: img.print?.url || web,
    originalImageUrl: img.full?.url || img.print?.url || web,
    width: Number(img.web?.width) || null,
    height: Number(img.web?.height) || null,
    contentType: 'image',
    files,
    text: [a.department, a.collection, a.tombstone, clean(a.description, 600), (a.artists_tags || []).join(' ')].filter(Boolean).join(' | '),
    boost: 0,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  let skip = store.getProgress('cma')?.skip || 0
  let n = 0
  for (;;) {
    const url = `${API}?has_image=1&cc0=1&limit=1000&skip=${skip}`
    log(`cma: page skip=${skip}`)
    const res = await getJson(url, { timeoutMs: 120000 })
    const rows = res.data || []
    for (const a of rows) {
      const rec = normalize(a)
      if (rec && store.put(rec)) n++
    }
    skip += rows.length
    store.setProgress('cma', { skip })
    if (rows.length < 1000 || n >= limit) break
  }
  store.setProgress('cma', null)
  log(`cma: ingested ${n}`)
}
