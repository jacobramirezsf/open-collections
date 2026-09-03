// Flickr Commons + Internet Archive Book Images — via the Flickr API (FLICKR_API_KEY).
// Commons institutions publish "no known copyright restrictions" photographs; the IA account holds
// 5M+ CC0 illustrations extracted from scanned books. Flickr search returns at most ~4,000 results
// per query, so large accounts are harvested through adaptive upload-date windows.
import { getJson, sleep } from '../lib/http.mjs'
import { clean, parseYears } from '../lib/normalize.mjs'

export const key = 'flickr'
export const name = 'Flickr Commons'
export const homepage = 'https://www.flickr.com/commons'

const IA_NSID = '126377022@N07'
const IA_CAP = Number(process.env.FLICKR_IA_CAP || 150000)
const DEFAULT_INST_CAP = 10000
const INST_CAP_OVERRIDES = {
  '12403504@N02': 40000, // British Library
  '8623220@N02': 40000, // Library of Congress (The Commons)
  '44494372@N05': 20000, // NASA Commons
}
const SKIP_INSTITUTIONS = new Set(['25053835@N03']) // Smithsonian — already indexed directly
// Non-Commons accounts worth harvesting (license-filtered like everything else)
const EXTRA_ACCOUNTS = [
  { nsid: '61021753@N02', name: 'Biodiversity Heritage Library', cap: 60000, isIA: false, objectType: 'Book illustration' },
]

const OK_LICENSES = new Set(['7', '9', '10']) // no known restrictions, CC0, PD mark
const EXTRAS = 'url_m,url_l,url_o,owner_name,license,date_upload,date_taken,description'

const api = (method, params, apikey) =>
  getJson(`https://api.flickr.com/services/rest/?method=${method}&api_key=${apikey}&format=json&nojsoncallback=1&${new URLSearchParams(params)}`, { timeoutMs: 45000, retries: 4 })

export function normalize(p, ownerName, isIA, objectTypeOverride) {
  if (!OK_LICENSES.has(String(p.license))) return null
  const m = p.url_m
  if (!m) return null
  const keyMatch = String(m).match(/^https:\/\/live\.staticflickr\.com\/(.+)\.(jpg|png|gif)$/)
  let title = clean(p.title, 220)
  if (!title) return null
  let text = ''
  if (isIA) {
    // "Image from page 371 of "Encyclopédie ..." (1884)" → surface the book title
    const bm = title.match(/^Image from page (\d+) of ["“](.+?)["”]?\s*\(?(\d{4})?\)?$/)
    if (bm) {
      title = `${clean(bm[2], 160)}${bm[3] ? ` (${bm[3]})` : ''} — p. ${bm[1]}`
    }
  }
  const desc = clean(typeof p.description === 'object' ? p.description?._content : p.description, 240)
  const yearsGuess = parseYears(p.title) || (p.datetaken && !p.datetaken.startsWith('0') ? parseYears(p.datetaken.slice(0, 4)) : null)
  const license = String(p.license)
  const rights =
    license === '9'
      ? { publicDomain: true, rightsLabel: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }
      : license === '10'
        ? { publicDomain: true, rightsLabel: 'Public domain', licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/' }
        : { publicDomain: true, rightsLabel: 'No known copyright restrictions', licenseUrl: 'https://www.flickr.com/commons/usage/' }
  return {
    id: `flickr:${p.id}`,
    source: key,
    sourceId: String(p.id),
    sourceUrl: `https://www.flickr.com/photos/${p.owner || ''}/${p.id}`,
    title,
    creator: clean(ownerName || p.ownername, 100),
    dateDisplay: yearsGuess ? String(yearsGuess[0]) : null,
    yearStart: yearsGuess?.[0] ?? null,
    yearEnd: yearsGuess?.[1] ?? null,
    objectType: objectTypeOverride || (isIA ? 'Book illustration' : 'Photograph'),
    medium: null,
    culture: null,
    place: null,
    ...rights,
    thumbnailUrl: m,
    imageUrl: p.url_l || m,
    originalImageUrl: p.url_o || p.url_l || m,
    width: Number(p.width_m) || null,
    height: Number(p.height_m) || null,
    contentType: 'image',
    files: [],
    text: [isIA ? 'book illustration engraving plate' : 'photograph archive', desc].filter(Boolean).join(' | '),
    boost: 0,
    _key: keyMatch ? keyMatch[1] : null,
  }
}

// flickr.people.getPublicPhotos pages deep without the ~4k cap that photos.search has, so plain
// resumable pagination works even for the 5M-photo Internet Archive account.
async function harvestAccount(store, apikey, nsid, ownerName, cap, isIA, log, objectTypeOverride) {
  const progKey = 'fl:' + nsid
  const state = store.getProgress(progKey) || { n: 0, page: 1, done: false }
  if (state.done || state.n >= cap) return state.n
  for (;;) {
    let res
    try {
      res = await api('flickr.people.getPublicPhotos', { user_id: nsid, per_page: 500, page: state.page, extras: EXTRAS }, apikey)
    } catch (e) {
      log(`flickr/${ownerName}: ${e.message}; pausing 15s`)
      await sleep(15000)
      continue
    }
    if (res.stat !== 'ok') {
      log(`flickr/${ownerName}: api error ${res.message || res.stat}`)
      break
    }
    const photos = res.photos?.photo || []
    for (const p of photos) {
      if (state.n >= cap) break
      const rec = normalize(p, ownerName, isIA, objectTypeOverride)
      if (rec && store.put(rec)) state.n++
    }
    if (state.page % 40 === 0) log(`flickr/${ownerName}: page ${state.page}/${res.photos?.pages}, ${state.n} kept`)
    state.page++
    store.setProgress(progKey, state)
    if (state.n >= cap || !photos.length || state.page > (res.photos?.pages || 0)) break
    await sleep(280)
  }
  state.done = true
  store.setProgress(progKey, state)
  log(`flickr/${ownerName}: ${state.n} kept`)
  return state.n
}

export async function ingest(store, { log }) {
  const apikey = process.env.FLICKR_API_KEY
  if (!apikey) throw new Error('FLICKR_API_KEY not set')
  // 1) Internet Archive Book Images (CC0 book plates)
  await harvestAccount(store, apikey, IA_NSID, 'Internet Archive Book Images', IA_CAP, true, log)
  // 2) Commons institutions
  const inst = await api('flickr.commons.getInstitutions', {}, apikey)
  const institutions = (inst.institutions?.institution || []).map((i) => ({ nsid: i.nsid, name: i.name?._content || i.nsid }))
  log(`flickr: ${institutions.length} Commons institutions`)
  for (const i of institutions) {
    if (SKIP_INSTITUTIONS.has(i.nsid) || i.nsid === IA_NSID) continue
    const cap = INST_CAP_OVERRIDES[i.nsid] ?? DEFAULT_INST_CAP
    try {
      await harvestAccount(store, apikey, i.nsid, i.name, cap, false, log)
    } catch (e) {
      log(`flickr/${i.name}: failed (${e.message}); continuing`)
    }
  }
  // 3) extra non-Commons accounts
  for (const a of EXTRA_ACCOUNTS) {
    try {
      await harvestAccount(store, apikey, a.nsid, a.name, a.cap, a.isIA, log, a.objectType)
    } catch (e) {
      log(`flickr/${a.name}: failed (${e.message}); continuing`)
    }
  }
  log(`flickr: total staged ${store.count(key)}`)
}
