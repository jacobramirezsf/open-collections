// SMK — Statens Museum for Kunst / National Gallery of Denmark. Open API (no key), public-domain
// works with images (~40k). https://www.smk.dk/en/article/smk-api/
import { getJson } from '../lib/http.mjs'
import { clean, joinUnique, years, RIGHTS } from '../lib/normalize.mjs'

export const key = 'smk'
export const name = 'SMK (Denmark)'
export const homepage = 'https://open.smk.dk/en/'

const API = 'https://api.smk.dk/api/v1/art/search/'

// Danish → English search terms for common types/techniques/subjects.
export const DA_EN = {
  maleri: 'painting', malerier: 'paintings', tegning: 'drawing', tegninger: 'drawings', grafik: 'print graphic art', træsnit: 'woodcut',
  clairobscurtræsnit: 'chiaroscuro woodcut', radering: 'etching', kobberstik: 'engraving', litografi: 'lithograph', akvarel: 'watercolor',
  gouache: 'gouache', pastel: 'pastel', skulptur: 'sculpture', buste: 'bust', relief: 'relief', gips: 'plaster', bronze: 'bronze', marmor: 'marble',
  portræt: 'portrait', selvportræt: 'self-portrait', landskab: 'landscape', søstykke: 'seascape marine', stilleben: 'still life', interiør: 'interior',
  kvinde: 'woman', kvinder: 'women', mand: 'man', mænd: 'men', barn: 'child', børn: 'children', pige: 'girl', dreng: 'boy',
  blomst: 'flower', blomster: 'flowers', frugt: 'fruit', træ: 'tree wood', træer: 'trees', hest: 'horse', heste: 'horses', hund: 'dog', kat: 'cat',
  fugl: 'bird', fugle: 'birds', fisk: 'fish', ko: 'cow', køer: 'cows', får: 'sheep', skib: 'ship', skibe: 'ships', båd: 'boat', hav: 'sea', strand: 'beach',
  skov: 'forest', bjerg: 'mountain', flod: 'river', kirke: 'church', slot: 'castle', hus: 'house', gade: 'street', by: 'city town', bro: 'bridge',
  krig: 'war', slag: 'battle', soldat: 'soldier', konge: 'king', dronning: 'queen', engel: 'angel', kristus: 'christ', madonna: 'madonna',
  nøgen: 'nude', model: 'model', dans: 'dance', musik: 'music', vinter: 'winter', sommer: 'summer', sne: 'snow', nat: 'night', måne: 'moon', sol: 'sun',
  papir: 'paper', lærred: 'canvas', olie: 'oil', pen: 'pen', blyant: 'pencil', kridt: 'chalk', kul: 'charcoal', tusch: 'ink',
}

function englishTerms(...strs) {
  const out = new Set()
  for (const s of strs) {
    if (!s) continue
    for (const w of String(s).toLowerCase().split(/[^\p{L}]+/u)) {
      const e = DA_EN[w]
      if (e) out.add(e)
    }
  }
  return [...out].join(' ')
}

export function normalize(i) {
  if (!i.object_number || i.public_domain !== true) return null
  const thumb = i.image_thumbnail
  const iiifMatch = String(thumb || '').match(/^https:\/\/iip-thumb\.smk\.dk\/iiif\/jp2\/([^/]+)\/full\//)
  // ~17% of works use a plain thumbnail service instead of IIIF; keep them with what they have.
  if (!iiifMatch && !/^https:\/\/api\.smk\.dk\/api\/v1\/thumbnail\//.test(String(thumb || ''))) return null
  const base = iiifMatch ? `https://iip-thumb.smk.dk/iiif/jp2/${iiifMatch[1]}` : null
  const title = clean(i.titles?.[0]?.title)
  if (!title) return null
  const prod = i.production_date?.[0]
  const [ys, ye] = years(prod?.start?.slice(0, 4), prod?.end?.slice(0, 4), prod?.period)
  const types = (i.object_names || []).map((o) => o?.name).filter(Boolean)
  const typesEn = types.map((t) => DA_EN[String(t).toLowerCase()]?.split(' ')[0] || t)
  const creators = (i.production || []).map((p) => p?.creator).filter((c) => c && !/^ubekendt/i.test(c))
  const isCC0 = /zero/i.test(i.rights || '')
  return {
    id: `smk:${i.object_number}`,
    source: key,
    sourceId: i.object_number,
    sourceUrl: `https://open.smk.dk/en/artwork/image/${encodeURIComponent(i.object_number)}`,
    title,
    creator: joinUnique(creators.slice(0, 3)),
    dateDisplay: clean(prod?.period),
    yearStart: ys,
    yearEnd: ye,
    objectType: joinUnique(typesEn.slice(0, 3)),
    medium: joinUnique([...(i.techniques || []), ...(i.materials || [])].slice(0, 4)),
    culture: null,
    place: null,
    ...(isCC0 ? RIGHTS.CC0 : RIGHTS.PD),
    thumbnailUrl: base ? `${base}/full/!600,600/0/default.jpg` : thumb,
    imageUrl: base ? `${base}/full/!1600,1600/0/default.jpg` : thumb,
    originalImageUrl: base ? `${base}/full/max/0/default.jpg` : i.image_native || thumb,
    width: i.image_width || null,
    height: i.image_height || null,
    contentType: 'image',
    files: i.image_native ? [{ format: 'jpg', url: i.image_native, label: 'Full resolution (SMK download)' }] : [],
    text: [englishTerms(title, ...types, ...(i.techniques || [])), 'Denmark Danish'].filter(Boolean).join(' | '),
    boost: 0,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  let offset = store.getProgress('smk')?.offset || 0
  let n = 0
  let stalls = 0
  for (;;) {
    const url = `${API}?keys=*&filters=%5Bhas_image%3Atrue%5D,%5Bpublic_domain%3Atrue%5D&offset=${offset}&rows=250`
    let res
    try {
      res = await getJson(url, { timeoutMs: 120000, retries: 5 })
      stalls = 0
    } catch (e) {
      if (++stalls > 8) throw e
      log(`smk: page at ${offset} failed (${e.message}); retrying in 15s`)
      await new Promise((r) => setTimeout(r, 15000))
      continue
    }
    const items = res.items || []
    for (const i of items) {
      const rec = normalize(i)
      if (rec && store.put(rec)) n++
    }
    offset += items.length
    store.setProgress('smk', { offset })
    if (offset % 5000 < 250) log(`smk: ${offset}/${res.found}, kept ${n}`)
    if (!items.length || offset >= (res.found || 0) || n >= limit) break
  }
  store.setProgress('smk', null)
  log(`smk: ingested ${n} (total staged ${store.count('smk')})`)
}
