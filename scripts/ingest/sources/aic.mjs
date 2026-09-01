// Art Institute of Chicago — public API listing (no key). Pages /artworks at ~1 req/s as the docs ask.
// Only public-domain works with images are kept (non-PD images are capped at 843px and not reusable).
// Docs: https://api.artic.edu/docs/
import { getJson, sleep } from '../lib/http.mjs'
import { clean, years, RIGHTS } from '../lib/normalize.mjs'

export const key = 'aic'
export const name = 'Art Institute of Chicago'
export const homepage = 'https://www.artic.edu/open-access/open-access-images'

const FIELDS = [
  'id', 'title', 'artist_display', 'date_display', 'date_start', 'date_end', 'artwork_type_title', 'classification_title',
  'medium_display', 'place_of_origin', 'is_public_domain', 'image_id', 'thumbnail', 'department_title', 'term_titles',
  'category_titles', 'is_boosted', 'has_not_been_viewed_much',
].join(',')
const IIIF = 'https://www.artic.edu/iiif/2'

export function normalize(a) {
  if (!a.image_id || !a.is_public_domain) return null
  const [ys, ye] = years(a.date_start, a.date_end, a.date_display)
  const base = `${IIIF}/${a.image_id}/full`
  const w = a.thumbnail?.width || null
  const h = a.thumbnail?.height || null
  return {
    id: `aic:${a.id}`,
    source: key,
    sourceId: String(a.id),
    sourceUrl: `https://www.artic.edu/artworks/${a.id}`,
    title: clean(a.title) || 'Untitled',
    creator: clean(a.artist_display?.split('\n')[0]),
    dateDisplay: clean(a.date_display),
    yearStart: ys,
    yearEnd: ye,
    objectType: clean([a.artwork_type_title, a.classification_title].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' / ')),
    medium: clean(a.medium_display),
    culture: null,
    place: clean(a.place_of_origin),
    ...RIGHTS.CC0,
    thumbnailUrl: `${base}/600,/0/default.jpg`,
    imageUrl: `${base}/1686,/0/default.jpg`,
    originalImageUrl: `${base}/3000,/0/default.jpg`,
    width: w,
    height: h,
    contentType: 'image',
    files: [{ format: 'jpg', url: `${base}/3000,/0/default.jpg`, label: 'Largest (3000px)' }],
    text: [a.department_title, (a.term_titles || []).join(' '), (a.category_titles || []).join(' ')].filter(Boolean).join(' | '),
    boost: a.is_boosted ? 2 : a.has_not_been_viewed_much === false ? 1 : 0,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  let page = store.getProgress('aic')?.page || 1
  let n = 0
  for (;;) {
    const url = `https://api.artic.edu/api/v1/artworks?fields=${FIELDS}&limit=100&page=${page}`
    const res = await getJson(url, { timeoutMs: 30000, headers: { 'AIC-User-Agent': 'open-collections (baysidedesignlab@gmail.com)' } })
    for (const a of res.data || []) {
      const rec = normalize(a)
      if (rec && store.put(rec)) n++
    }
    if (page % 20 === 0) log(`aic: page ${page}/${res.pagination?.total_pages}, ${n} public-domain records`)
    store.setProgress('aic', { page: page + 1 })
    if (!res.pagination?.next_url || n >= limit) break
    page++
    await sleep(1000)
  }
  store.setProgress('aic', null)
  log(`aic: ingested ${n}`)
}
