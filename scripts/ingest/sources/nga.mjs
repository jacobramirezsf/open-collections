// National Gallery of Art (Washington) — CC0 open data on GitHub (bulk CSVs), IIIF images.
// https://github.com/NationalGalleryOfArt/opendata
import { streamCsv } from '../lib/http.mjs'
import { clean, joinUnique, years, RIGHTS } from '../lib/normalize.mjs'

export const key = 'nga'
export const name = 'National Gallery of Art'
export const homepage = 'https://www.nga.gov/open-access-images'

const BASE = 'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/'

export async function ingest(store, { limit = Infinity, log }) {
  // 1) open-access primary images by object id
  log('nga: reading published_images.csv')
  const images = new Map()
  for await (const r of streamCsv(BASE + 'published_images.csv')) {
    if (r.openaccess !== '1') continue
    const oid = r.depictstmsobjectid
    const cur = images.get(oid)
    if (cur && cur.viewtype === 'primary' && r.viewtype !== 'primary') continue
    if (cur && cur.viewtype === r.viewtype && Number(r.sequence) >= Number(cur.sequence)) continue
    images.set(oid, { iiif: r.iiifurl, w: Number(r.width) || null, h: Number(r.height) || null, viewtype: r.viewtype, sequence: r.sequence, maxpixels: r.maxpixels })
  }
  log(`nga: ${images.size} objects with open-access images`)

  // 2) keywords / styles / places from objects_terms.csv
  log('nga: reading objects_terms.csv')
  const terms = new Map()
  const places = new Map()
  for await (const r of streamCsv(BASE + 'objects_terms.csv')) {
    if (!images.has(r.objectid)) continue
    if (r.termtype === 'Place Executed') {
      places.set(r.objectid, (places.get(r.objectid) || []).concat(r.term))
    } else if (r.termtype === 'Keyword' || r.termtype === 'Style' || r.termtype === 'School' || r.termtype === 'Theme') {
      if (r.term && r.term !== 'Keywords' && r.term !== 'Themes') terms.set(r.objectid, (terms.get(r.objectid) || []).concat(r.term))
    }
  }

  // 3) objects.csv
  log('nga: reading objects.csv')
  let n = 0
  for await (const o of streamCsv(BASE + 'objects.csv')) {
    const img = images.get(o.objectid)
    if (!img || o.isvirtual === '1') continue
    const [ys, ye] = years(o.beginyear, o.endyear, o.displaydate)
    const thumb = `${img.iiif}/full/!600,600/0/default.jpg`
    const mid = `${img.iiif}/full/!1600,1600/0/default.jpg`
    const full = `${img.iiif}/full/max/0/default.jpg`
    const rec = {
      id: `nga:${o.objectid}`,
      source: key,
      sourceId: o.objectid,
      sourceUrl: `https://www.nga.gov/collection/art-object-page.${o.objectid}.html`,
      title: clean(o.title) || 'Untitled',
      creator: clean(o.attribution),
      dateDisplay: clean(o.displaydate),
      yearStart: ys,
      yearEnd: ye,
      objectType: clean(o.classification),
      medium: clean(o.medium),
      culture: null,
      place: joinUnique(places.get(o.objectid)),
      ...RIGHTS.CC0,
      thumbnailUrl: thumb,
      imageUrl: mid,
      originalImageUrl: full,
      width: img.w,
      height: img.h,
      contentType: 'image',
      files: [{ format: 'jpg', url: full, label: 'Full resolution JPEG' }],
      text: [o.subclassification, o.departmentabbr, o.portfolio, o.series, joinUnique(terms.get(o.objectid), ' ')].filter(Boolean).join(' | '),
      boost: 0,
    }
    if (store.put(rec)) n++
    if (n >= limit) break
  }
  log(`nga: ingested ${n}`)
}
