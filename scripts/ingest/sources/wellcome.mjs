// Wellcome Collection — official catalogue snapshot (works.json.gz, ~485 MB gzipped NDJSON).
// Kept: works with a IIIF image and an open license (PDM / CC0 / CC BY). Great for posters,
// ephemera, anatomical illustration, advertising, lettering.
// https://developers.wellcomecollection.org/docs/datasets
import { streamLines } from '../lib/http.mjs'
import { clean, joinUnique, parseYears, RIGHTS } from '../lib/normalize.mjs'

export const key = 'wellcome'
export const name = 'Wellcome Collection'
export const homepage = 'https://wellcomecollection.org/collections'

const SNAPSHOT = 'https://data.wellcomecollection.org/catalogue/v2/works.json.gz'

const LICENSES = {
  pdm: RIGHTS.PD,
  cc0: RIGHTS.CC0,
  'cc-by': RIGHTS.CC_BY,
}

export function normalize(w) {
  if (w.type !== 'Work') return null
  let iiif = null
  let licenseId = null
  for (const item of w.items || []) {
    for (const loc of item.locations || []) {
      if (loc.locationType?.id === 'iiif-image' && loc.url) {
        iiif = loc.url
        licenseId = loc.license?.id || null
        break
      }
    }
    if (iiif) break
  }
  if (!iiif) return null
  const rights = LICENSES[licenseId]
  if (!rights) return null // inc / restricted / unknown — skip entirely
  const base = iiif.replace(/\/info\.json$/, '')
  if (base === iiif) return null
  const title = clean(w.title)
  if (!title) return null
  const dates = (w.production || []).flatMap((p) => (p.dates || []).map((d) => d.label)).filter(Boolean)
  const [ys, ye] = parseYears(dates[0]) || [null, null]
  const contributors = (w.contributors || []).map((c) => c.agent?.label).filter(Boolean)
  const types = [w.workType?.label].filter(Boolean)
  const techniques = (w.production || []).flatMap((p) => (p.function ? [p.function.label] : [])).filter(Boolean)
  const places = (w.production || []).flatMap((p) => (p.places || []).map((x) => x.label)).filter(Boolean)
  const subjects = (w.subjects || []).map((s) => s.label).filter(Boolean)
  const genres = (w.genres || []).map((g) => g.label).filter(Boolean)
  return {
    id: `wellcome:${w.id}`,
    source: key,
    sourceId: w.id,
    sourceUrl: `https://wellcomecollection.org/works/${w.id}`,
    title,
    creator: joinUnique(contributors.slice(0, 3)),
    dateDisplay: clean(dates[0], 80),
    yearStart: ys,
    yearEnd: ye,
    objectType: joinUnique([...genres.slice(0, 2), ...types]),
    medium: null,
    culture: null,
    place: joinUnique(places.slice(0, 3)),
    ...rights,
    thumbnailUrl: base.replace('/image/', '/thumbs/') + '/full/!600,600/0/default.jpg',
    imageUrl: base.replace('/image/', '/thumbs/') + '/full/!1024,1024/0/default.jpg',
    originalImageUrl: base.replace('/image/', '/thumbs/') + '/full/!1024,1024/0/default.jpg',
    width: null,
    height: null,
    contentType: 'image',
    files: [],
    text: [subjects.slice(0, 8).join(' '), clean(w.description || w.physicalDescription, 220)].filter(Boolean).join(' | '),
    boost: 0,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  let n = 0
  let seen = 0
  for await (const line of streamLines(SNAPSHOT, { gzip: true })) {
    if (!line.trim()) continue
    seen++
    let w
    try {
      w = JSON.parse(line)
    } catch {
      continue
    }
    const rec = normalize(w)
    if (rec && store.put(rec)) n++
    if (seen % 100000 === 0) log(`wellcome: ${seen} scanned, ${n} kept`)
    if (n >= limit) break
  }
  store.flush()
  log(`wellcome: ingested ${n} of ${seen}`)
}
