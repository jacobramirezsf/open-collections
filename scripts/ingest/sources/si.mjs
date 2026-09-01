// Smithsonian Open Access — bulk EDAN metadata from the public S3 bucket (no key), CC0 only.
// Images via IDS (ids.si.edu). 3D models (Voyager packages) are picked up from the same records.
// https://github.com/Smithsonian/OpenAccess
import { streamLines, getText } from '../lib/http.mjs'
import { clean, joinUnique, years, parseYears, RIGHTS, extOf } from '../lib/normalize.mjs'

export const key = 'si'
export const name = 'Smithsonian'
export const homepage = 'https://www.si.edu/openaccess'

const BUCKET = 'https://smithsonian-open-access.s3-us-west-2.amazonaws.com/metadata/edan/'

// unit → [display name, max records with images to keep]
export const UNITS = {
  chndm: ['Cooper Hewitt', 80000],
  saam: ['Smithsonian American Art Museum', 40000],
  npm: ['National Postal Museum', 30000],
  fsg: ['Freer and Sackler', 30000],
  nasm: ['National Air and Space Museum', 20000],
  hmsg: ['Hirshhorn', 10000],
  nmafa: ['National Museum of African Art', 10000],
  npg: ['National Portrait Gallery', 20000],
  nmaahc: ['National Museum of African American History and Culture', 8000],
  nmah: ['National Museum of American History', 30000],
  nmai: ['National Museum of the American Indian', 8000],
  nmnhanthro: ['NMNH Anthropology', 10000],
  ocio_dpo3d: ['Smithsonian 3D', 5000],
}

const ft = (rec, k) => (rec.content?.freetext?.[k] || []).map((x) => x?.content).filter(Boolean)
const ftLabeled = (rec, k, labels) => (rec.content?.freetext?.[k] || []).filter((x) => labels.some((l) => (x.label || '').toLowerCase().includes(l))).map((x) => x.content).filter(Boolean)

function threeDFiles(media) {
  const files = []
  for (const r of media.resources || []) {
    const url = r.url
    if (!url) continue
    const attrs = Object.assign({}, ...(r.attributes || []).filter(Boolean))
    const fname = r.filename || url.split('/').pop()
    let fmt = (attrs.MODEL_FILE_TYPE || '').toLowerCase().replace('draco compressed ', '')
    if (!fmt) {
      const f = fname.toLowerCase()
      if (f.includes('-obj') || f.endsWith('.obj')) fmt = 'obj'
      else if (f.includes('-gltf') || f.endsWith('.gltf')) fmt = 'gltf'
      else if (f.endsWith('.glb')) fmt = 'glb'
      else if (f.endsWith('.usdz')) fmt = 'usdz'
      else if (f.includes('print_ready') || f.includes('-stl') || f.endsWith('.stl')) fmt = 'stl'
      else fmt = extOf(fname) || 'zip'
    }
    const size = Number(attrs.FILE_SIZE) || undefined
    files.push({ format: fmt, url, filename: fname, size, label: [r.category, r.title].filter(Boolean).join(' · ') })
  }
  return files
}

export function normalize(rec, unit, unitName) {
  if (rec.type !== 'edanmdm') return null
  const d = rec.content?.descriptiveNonRepeating
  if (!d || d.metadata_usage?.access !== 'CC0') return null
  const media = d.online_media?.media || []
  const img = media.find((m) => m.type === 'Images' && m.idsId && (!m.usage || m.usage.access === 'CC0'))
  const model = media.find((m) => m.type === '3d_voyager')
  if (!img && !model) return null
  const title = clean(d.title?.content || rec.title)
  if (!title) return null
  const ix = rec.content?.indexedStructured || {}
  const dateStrs = ft(rec, 'date')
  let [ys, ye] = years(null, null, dateStrs[0])
  if (ys == null && Array.isArray(ix.date) && ix.date.length) {
    const decs = ix.date.map((s) => parseYears(s)).filter(Boolean)
    if (decs.length) {
      ys = Math.min(...decs.map((x) => x[0]))
      ye = Math.max(...decs.map((x) => x[1]))
    }
  }
  const names = ft(rec, 'name')
  const medium = ftLabeled(rec, 'physicalDescription', ['medium', 'material', 'technique'])
  const objectType = ft(rec, 'objectType')
  const geo = (ix.geoLocation || []).flatMap((g) => Object.values(g).map((x) => x?.content)).filter(Boolean)
  const places = ft(rec, 'place')
  const notes = ft(rec, 'notes').slice(0, 2).map((s) => clean(s, 300))
  const recordUrl = d.record_link || (d.guid ? d.guid.replace(/^http:/, 'https:') : `https://collections.si.edu/search/detail/${d.record_ID}`)
  const base = {
    source: key,
    sourceId: d.record_ID,
    sourceUrl: recordUrl,
    title,
    creator: joinUnique(names.slice(0, 3)),
    dateDisplay: clean(dateStrs[0]),
    yearStart: ys,
    yearEnd: ye,
    objectType: joinUnique(objectType.length ? objectType : ix.object_type),
    medium: joinUnique(medium),
    culture: joinUnique((ix.culture || []).slice(0, 3)),
    place: joinUnique(places.length ? places : geo),
    ...RIGHTS.CC0,
    text: [unitName, d.data_source, (ix.topic || []).join(' '), (ix.name || []).join(' '), ...notes].filter(Boolean).join(' | '),
    boost: 0,
  }
  if (model) {
    const files = threeDFiles(model)
    if (!files.length) return null
    const thumb = model.thumbnail || img?.thumbnail || null
    return {
      ...base,
      id: `si:${d.record_ID}`,
      contentType: '3d',
      thumbnailUrl: thumb,
      imageUrl: thumb ? thumb.replace('scene-image-thumb', 'scene-image-medium') : null,
      originalImageUrl: null,
      width: null,
      height: null,
      files,
      text: base.text + ' | 3D model',
      boost: 1,
    }
  }
  const idsId = img.idsId
  const hi = (img.resources || []).find((r) => /high-resolution jpeg/i.test(r.label)) || (img.resources || []).find((r) => /high-resolution/i.test(r.label))
  const screen = (img.resources || []).find((r) => /screen/i.test(r.label))
  const original = `https://ids.si.edu/ids/deliveryService?id=${encodeURIComponent(idsId)}`
  const files = [{ format: 'jpg', url: original, label: 'Full size JPEG' }]
  if (hi?.url) files.push({ format: extOf(hi.url) || 'jpg', url: hi.url, label: hi.label })
  return {
    ...base,
    id: `si:${d.record_ID}`,
    contentType: 'image',
    thumbnailUrl: `${original}&max=600`,
    imageUrl: `${original}&max=1600`,
    originalImageUrl: original,
    width: screen?.width || hi?.width || null,
    height: screen?.height || hi?.height || null,
    files,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  const units = process.env.SI_UNITS ? process.env.SI_UNITS.split(',') : Object.keys(UNITS)
  for (const unit of units) {
    const [unitName, cap] = UNITS[unit] || [unit.toUpperCase(), 20000]
    const progress = store.getProgress('si:' + unit) || { shard: 0, n: 0 }
    if (progress.done) {
      log(`si/${unit}: already complete (${progress.n})`)
      continue
    }
    let n = progress.n
    let models = 0
    let index
    try {
      index = (await getText(`${BUCKET}${unit}/index.txt`)).split('\n').map((s) => s.trim()).filter(Boolean)
    } catch {
      // some small units have no index.txt — list the bucket prefix instead
      const xml = await getText(`https://smithsonian-open-access.s3-us-west-2.amazonaws.com/?list-type=2&prefix=metadata/edan/${unit}/`)
      index = [...xml.matchAll(/<Key>([^<]+\.txt)<\/Key>/g)].map((m) => `https://smithsonian-open-access.s3-us-west-2.amazonaws.com/${m[1]}`).filter((u) => !u.endsWith('index.txt'))
    }
    for (let s = progress.shard; s < index.length; s++) {
      let lines = 0
      try {
        for await (const line of streamLines(index[s], { gzip: false })) {
          if (!line) continue
          lines++
          let rec
          try {
            rec = JSON.parse(line)
          } catch {
            continue
          }
          const r = normalize(rec, unit, unitName)
          if (!r) continue
          if (r.contentType === '3d') models++
          else if (n >= Math.min(cap, limit)) continue
          if (store.put(r)) n++
        }
      } catch (e) {
        log(`si/${unit}: shard ${s} failed (${e.message}); continuing`)
      }
      store.setProgress('si:' + unit, { shard: s + 1, n })
      if ((s + 1) % 32 === 0) log(`si/${unit}: shard ${s + 1}/${index.length}, ${n} records, ${models} 3d`)
    }
    store.setProgress('si:' + unit, { shard: index.length, n, done: true })
    log(`si/${unit}: complete, ${n} records (${models} 3d)`)
  }
}
