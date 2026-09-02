// Harvard Art Museums — official API (free key, 2,500 requests/day). Objects with displayable
// images (imagepermissionlevel:0). NOTE: Harvard does NOT release its images as CC0/PD, so records
// are labeled for verification and appear only when the public-domain filter is off.
// Docs: https://github.com/harvardartmuseums/api-docs   Env: HARVARD_API_KEY
import { getJson, sleep } from '../lib/http.mjs'
import { clean, joinUnique, years, extOf } from '../lib/normalize.mjs'

export const key = 'harvard'
export const name = 'Harvard Art Museums'
export const homepage = 'https://harvardartmuseums.org/collections'

const FIELDS = 'objectid,objectnumber,title,people,dated,datebegin,dateend,classification,culture,medium,technique,century,division,department,url,images,imagepermissionlevel,copyright,worktypes,places'

export function normalize(o) {
  if (o.imagepermissionlevel !== 0) return null
  const img = (o.images || []).filter((i) => i?.baseimageurl).sort((a, b) => (a.displayorder || 9) - (b.displayorder || 9))[0]
  if (!img) return null
  const base = img.baseimageurl
  const title = clean(o.title)
  if (!title) return null
  const [ys, ye] = years(o.datebegin, o.dateend, o.dated || o.century)
  const people = (o.people || []).filter((p) => /artist|painter|maker|designer|sculptor|printmaker|photographer/i.test(p?.role || '')).map((p) => p?.name || p?.displayname).filter(Boolean)
  const places = (o.places || []).map((p) => p?.displayname).filter(Boolean)
  const worktypes = (o.worktypes || []).map((w) => w?.worktype).filter(Boolean)
  return {
    id: `harvard:${o.objectid}`,
    source: key,
    sourceId: String(o.objectid),
    sourceUrl: o.url || `https://www.harvardartmuseums.org/collections/object/${o.objectid}`,
    title,
    creator: joinUnique(people.slice(0, 3)),
    dateDisplay: clean(o.dated || o.century, 80),
    yearStart: ys,
    yearEnd: ye,
    objectType: joinUnique([o.classification, ...worktypes.slice(0, 2)]),
    medium: clean(o.medium || o.technique, 160),
    culture: clean(o.culture),
    place: joinUnique(places.slice(0, 3)),
    publicDomain: null,
    rightsLabel: 'Harvard Art Museums — verify rights before reuse',
    licenseUrl: 'https://harvardartmuseums.org/collections/api',
    thumbnailUrl: `${base}?width=600`,
    imageUrl: `${base}?width=1600`,
    originalImageUrl: base,
    width: img.width || null,
    height: img.height || null,
    contentType: 'image',
    files: [{ format: extOf(base) || 'jpg', url: base, label: 'Full size' }],
    text: [o.division, o.department, o.century].filter(Boolean).join(' | '),
    boost: 0,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  const apikey = process.env.HARVARD_API_KEY
  if (!apikey) throw new Error('HARVARD_API_KEY not set (see .env.local)')
  let page = store.getProgress('harvard')?.page || 1
  let n = 0
  for (;;) {
    const url = `https://api.harvardartmuseums.org/object?apikey=${apikey}&size=100&page=${page}&hasimage=1&q=imagepermissionlevel:0&sort=objectid&sortorder=asc&fields=${FIELDS}`
    const res = await getJson(url, { timeoutMs: 60000, retries: 4 })
    for (const o of res.records || []) {
      const rec = normalize(o)
      if (rec && store.put(rec)) n++
    }
    store.setProgress('harvard', { page: page + 1 })
    if (page % 50 === 0) log(`harvard: page ${page}/${res.info?.pages}, kept ${n}`)
    if (!res.info?.next || n >= limit) break
    page++
    await sleep(320)
  }
  store.setProgress('harvard', null)
  log(`harvard: ingested ${n} (staged ${store.count(key)})`)
}
