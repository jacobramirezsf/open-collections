// NYPL Digital Collections — public-domain captures via the Digital Collections API
// (NYPL_API_TOKEN, 10k requests/day). Search q=* with publicDomainOnly pages the whole corpus
// (~2.1M captures); we take a capped sample of still images. Search results are thin (title,
// imageID, link) — dates/creators aren't included and would cost one request per item, so records
// are title-searchable primarily. Docs: https://api.repo.nypl.org/
import { getJson, sleep } from '../lib/http.mjs'
import { clean, parseYears, RIGHTS } from '../lib/normalize.mjs'

export const key = 'nypl'
export const name = 'NYPL Digital Collections'
export const homepage = 'https://digitalcollections.nypl.org/'

const CAP = Number(process.env.NYPL_CAP || 250000)

export function normalize(r) {
  if (r.typeOfResource && r.typeOfResource !== 'still image') return null
  const img = r.imageID
  if (!img) return null
  const title = clean(r.title, 220)
  if (!title) return null
  const yrs = parseYears(title)
  return {
    id: `nypl:${r.uuid}`,
    source: key,
    sourceId: String(r.uuid),
    sourceUrl: r.itemLink || `https://digitalcollections.nypl.org/items/${r.uuid}`,
    title,
    creator: null,
    dateDisplay: null,
    yearStart: yrs?.[0] ?? null,
    yearEnd: yrs?.[1] ?? null,
    objectType: null,
    medium: null,
    culture: null,
    place: null,
    ...RIGHTS.PD,
    rightsLabel: 'Public domain (NYPL)',
    thumbnailUrl: `https://images.nypl.org/index.php?id=${img}&t=r`,
    imageUrl: `https://images.nypl.org/index.php?id=${img}&t=q`,
    originalImageUrl: `https://images.nypl.org/index.php?id=${img}&t=g`,
    width: null,
    height: null,
    contentType: 'image',
    files: [],
    text: 'New York Public Library',
    boost: 0,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  const token = process.env.NYPL_API_TOKEN
  if (!token) throw new Error('NYPL_API_TOKEN not set')
  const cap = Math.min(CAP, limit)
  const state = store.getProgress('nypl') || { page: 1, n: 0 }
  while (state.n < cap) {
    let res
    try {
      res = await getJson(`https://api.repo.nypl.org/api/v2/items/search?q=still+image&field=typeOfResource&value=still+image&publicDomainOnly=true&per_page=500&page=${state.page}`, {
        timeoutMs: 90000,
        retries: 4,
        headers: { authorization: `Token token=${token}` },
      })
    } catch (e) {
      log(`nypl: page ${state.page} failed (${e.message}); pausing 30s`)
      await sleep(30000)
      continue
    }
    const rows = res?.nyplAPI?.response?.result || []
    if (!rows.length) break
    for (const r of rows) {
      if (state.n >= cap) break
      const rec = normalize(r)
      if (rec && store.put(rec)) state.n++
    }
    state.page++
    store.setProgress('nypl', state)
    if (state.page % 25 === 0) log(`nypl: page ${state.page}, ${state.n} kept`)
    await sleep(400)
  }
  store.flush()
  log(`nypl: ingested ${state.n}`)
}
