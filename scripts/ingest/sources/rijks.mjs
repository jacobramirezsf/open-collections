// Rijksmuseum — OAI-PMH harvest (oai_dc, no key) from data.rijksmuseum.nl. Public-domain works with images only.
// Metadata is Dutch; a small dictionary adds English search terms for common types/materials/subjects.
// Docs: https://data.rijksmuseum.nl/docs/oai-pmh
import { fetchWithRetry, mapLimit, sleep } from '../lib/http.mjs'
import { clean, joinUnique, parseYears, RIGHTS } from '../lib/normalize.mjs'

export const key = 'rijks'
export const name = 'Rijksmuseum'
export const homepage = 'https://www.rijksmuseum.nl/en/collection'

const OAI = 'https://data.rijksmuseum.nl/oai'
const CAP = Number(process.env.RIJKS_CAP || 80000)

// Dutch → English (search terms). Keys lowercase, singular; plurals handled loosely.
export const NL_EN = {
  prent: 'print', prenten: 'prints', tekening: 'drawing', tekeningen: 'drawings', schilderij: 'painting', schilderijen: 'paintings', foto: 'photograph photo',
  fotos: 'photographs', "foto's": 'photographs', beeldhouwwerk: 'sculpture', beeld: 'sculpture statue', meubel: 'furniture', meubilair: 'furniture', stoel: 'chair', stoelen: 'chairs',
  kast: 'cabinet', tafel: 'table', servies: 'tableware service', bord: 'plate', kom: 'bowl', schaal: 'dish bowl', vaas: 'vase', kan: 'jug pitcher', glas: 'glass',
  zilver: 'silver', goud: 'gold', papier: 'paper', hout: 'wood', ijzer: 'iron', koper: 'copper', brons: 'bronze', keramiek: 'ceramic', porselein: 'porcelain',
  aardewerk: 'earthenware pottery', faience: 'faience', textiel: 'textile', zijde: 'silk', wol: 'wool', linnen: 'linen', katoen: 'cotton', leer: 'leather',
  boek: 'book', kaart: 'map card', kaarten: 'maps cards', affiche: 'poster', munt: 'coin', penning: 'medal', wapen: 'weapon coat of arms', zwaard: 'sword', helm: 'helmet',
  harnas: 'armor armour', scheepsmodel: 'ship model', model: 'model', poppenhuis: 'dollhouse', speelgoed: 'toy', sieraad: 'jewelry jewellery', ketting: 'necklace',
  kostuum: 'costume', jurk: 'dress', japon: 'dress gown', jas: 'coat jacket', schoen: 'shoe', schoenen: 'shoes', hoed: 'hat', waaier: 'fan', klok: 'clock', horloge: 'watch',
  lamp: 'lamp', kandelaar: 'candlestick', spiegel: 'mirror', tegel: 'tile', tegels: 'tiles', doos: 'box', kist: 'chest', fles: 'bottle', beker: 'cup beaker', lepel: 'spoon',
  mes: 'knife', vork: 'fork', ets: 'etching', gravure: 'engraving', houtsnede: 'woodcut', litho: 'lithograph', lithografie: 'lithograph', aquarel: 'watercolor watercolour',
  olieverf: 'oil paint', doek: 'canvas', paneel: 'panel', borduurwerk: 'embroidery', geborduurd: 'embroidered', kant: 'lace', tapijt: 'carpet', wandtapijt: 'tapestry',
  fotografie: 'photography', albuminedruk: 'albumen print', gelatinezilverdruk: 'gelatin silver print', glasnegatief: 'glass negative', stereofoto: 'stereograph',
  prentbriefkaart: 'postcard', boekband: 'bookbinding', miniatuur: 'miniature', portret: 'portrait', landschap: 'landscape', stilleven: 'still life',
  zelfportret: 'self-portrait', vrouw: 'woman', vrouwen: 'women', man: 'man', mannen: 'men', kind: 'child', kinderen: 'children', bloem: 'flower', bloemen: 'flowers',
  vogel: 'bird', vogels: 'birds', hond: 'dog', paard: 'horse', paarden: 'horses', schip: 'ship', schepen: 'ships', kerk: 'church', huis: 'house', fiets: 'bicycle',
  boot: 'boat', trein: 'train', auto: 'car', brief: 'letter', plattegrond: 'plan', ontwerp: 'design', ontwerptekening: 'design drawing', tekst: 'text', letter: 'letter type',
  letters: 'letters lettering', alfabet: 'alphabet', kalligrafie: 'calligraphy', ornament: 'ornament', ornamentprent: 'ornament print', titelpagina: 'title page',
  omslag: 'cover', verpakking: 'packaging', etiket: 'label', reclame: 'advertisement', advertentie: 'advertisement', kalender: 'calendar', spel: 'game', kaartspel: 'playing cards',
  wapenrusting: 'armour', geweer: 'gun rifle', pistool: 'pistol', kanon: 'cannon', bijl: 'axe', hamer: 'hammer', gereedschap: 'tool tools', werktuig: 'tool implement',
  naaimachine: 'sewing machine', machine: 'machine', instrument: 'instrument', muziekinstrument: 'musical instrument', viool: 'violin', fluit: 'flute', trommel: 'drum',
  bril: 'glasses spectacles', pijp: 'pipe', tabaksdoos: 'tobacco box', theepot: 'teapot', koffiepot: 'coffee pot', kopje: 'cup', schotel: 'saucer', pot: 'pot jar',
  vat: 'barrel', mand: 'basket', tas: 'bag', beurs: 'purse', knoop: 'button', kraag: 'collar', handschoen: 'glove', handschoenen: 'gloves', kous: 'stocking', mouw: 'sleeve',
  japans: 'japanese', chinees: 'chinese', italiaans: 'italian', frans: 'french', duits: 'german', engels: 'english', nederlands: 'dutch', indisch: 'indonesian',
  japan: 'japan', china: 'china', italië: 'italy', frankrijk: 'france', duitsland: 'germany', engeland: 'england', nederland: 'netherlands', indië: 'indonesia',
  zee: 'sea', strand: 'beach', rivier: 'river', berg: 'mountain', bos: 'forest', boom: 'tree', bomen: 'trees', stad: 'city', dorp: 'village', straat: 'street', gezicht: 'view',
  interieur: 'interior', keuken: 'kitchen', molen: 'windmill mill', brug: 'bridge', toren: 'tower', kasteel: 'castle', tuin: 'garden', vrucht: 'fruit', vruchten: 'fruit',
  vis: 'fish', kat: 'cat', leeuw: 'lion', olifant: 'elephant', aap: 'monkey', slang: 'snake', insect: 'insect', vlinder: 'butterfly', schelp: 'shell', schelpen: 'shells',
  soldaat: 'soldier', soldaten: 'soldiers', koning: 'king', koningin: 'queen', prins: 'prince', ruiter: 'rider horseman', engel: 'angel', maria: 'mary', christus: 'christ',
  heilige: 'saint', dood: 'death', skelet: 'skeleton', schedel: 'skull', anatomie: 'anatomy', zon: 'sun', maan: 'moon', ster: 'star', sterren: 'stars', wolk: 'cloud',
  winter: 'winter', zomer: 'summer', ijs: 'ice', sneeuw: 'snow', schaatsen: 'skating', feest: 'party festival', dans: 'dance', muziek: 'music', theater: 'theatre',
  oorlog: 'war', slag: 'battle', zeeslag: 'naval battle', vloot: 'fleet', ontploffing: 'explosion', brand: 'fire', ruïne: 'ruin', ruine: 'ruin', grot: 'cave',
  wagen: 'wagon carriage', koets: 'coach carriage', slee: 'sleigh', vliegtuig: 'airplane', ballon: 'balloon', luchtballon: 'hot air balloon',
  japon_: '', kleding: 'clothing', mode: 'fashion', modeprent: 'fashion plate', uniform: 'uniform', schoenmaker: 'shoemaker', smid: 'blacksmith', boer: 'farmer',
  visser: 'fisherman', markt: 'market', winkel: 'shop', herberg: 'inn', kroeg: 'tavern', school: 'school', ziekenhuis: 'hospital', kerkinterieur: 'church interior',
  glasnegatieven: 'glass negatives', negatief: 'negative', dia: 'slide', album: 'album', fotoalbum: 'photo album', tijdschrift: 'magazine', krant: 'newspaper',
  pamflet: 'pamphlet', spotprent: 'caricature satire cartoon', karikatuur: 'caricature', embleem: 'emblem', devies: 'motto', wapenschild: 'coat of arms heraldry',
  zegel: 'seal', stempel: 'stamp', postzegel: 'postage stamp', bankbiljet: 'banknote', geld: 'money', sleutel: 'key', slot: 'lock', scharnier: 'hinge', spijker: 'nail',
  nagel: 'nail', schroef: 'screw', tandwiel: 'gear cog', pomp: 'pump', ketel: 'kettle boiler', oven: 'oven', kachel: 'stove', haard: 'hearth fireplace', bed: 'bed', wieg: 'cradle',
  kussen: 'cushion pillow', deken: 'blanket', gordijn: 'curtain', behang: 'wallpaper', lijst: 'frame', schilderijlijst: 'picture frame', sokkel: 'pedestal', zuil: 'column',
  bloemstuk: 'flower piece bouquet', boeket: 'bouquet', tulp: 'tulip', roos: 'rose', lelie: 'lily', anjer: 'carnation', druif: 'grape', druiven: 'grapes', appel: 'apple', peer: 'pear',
  citroen: 'lemon', oester: 'oyster', kreeft: 'lobster', brood: 'bread', kaas: 'cheese', wijn: 'wine', bier: 'beer', thee: 'tea', koffie: 'coffee', tabak: 'tobacco', suiker: 'sugar',
}

function englishTerms(...strs) {
  const out = new Set()
  for (const s of strs) {
    if (!s) continue
    for (const w of s.toLowerCase().split(/[^\p{L}']+/u)) {
      const e = NL_EN[w]
      if (e) out.add(e)
    }
  }
  return [...out].join(' ')
}

const tag = (xml, name) => {
  const out = []
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g')
  let m
  while ((m = re.exec(xml))) out.push(decodeXml(m[1]))
  return out
}
const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n)).replace(/&amp;/g, '&')

export function normalizeRecord(xml) {
  const idm = xml.match(/<identifier>https:\/\/id\.rijksmuseum\.nl\/(\d+)<\/identifier>/)
  if (!idm) return null
  const rights = tag(xml, 'dc:rights')[0] || ''
  if (!/publicdomain\/mark|publicdomain\/zero/i.test(rights)) return null
  const iiif = tag(xml, 'dc:relation').find((u) => u.includes('iiif.micr.io'))
  if (!iiif) return null
  const micrio = iiif.match(/iiif\.micr\.io\/([^/]+)\//)?.[1]
  if (!micrio) return null
  const objectNumber = tag(xml, 'dc:identifier').find((s) => /^[A-Z]{1,4}-/.test(s)) || tag(xml, 'dc:identifier')[0]
  const titles = tag(xml, 'dc:title')
  const title = clean(titles[0])
  if (!title) return null
  const creators = tag(xml, 'dc:creator').filter((c) => !/^anoniem$/i.test(c))
  const date = tag(xml, 'dc:date')[0]
  const types = tag(xml, 'dc:type')
  const formats = tag(xml, 'dc:format').map((f) => f.replace(/\s*\((materiaal|techniek)\)\s*/g, ''))
  const desc = tag(xml, 'dc:description')[0]
  const coverage = tag(xml, 'dc:coverage')
  const subjects = tag(xml, 'dc:subject')
  const [ys, ye] = parseYears(date) || [null, null]
  const typeEn = types.map((t) => NL_EN[t.toLowerCase()]?.split(' ')[0] || t)
  const isCC0 = /zero/i.test(rights)
  const base = `https://iiif.micr.io/${micrio}/full`
  return {
    id: `rijks:${objectNumber || idm[1]}`,
    source: key,
    sourceId: objectNumber || idm[1],
    sourceUrl: `https://www.rijksmuseum.nl/en/collection/${encodeURIComponent(objectNumber || '')}`,
    title,
    creator: joinUnique(creators.slice(0, 3)),
    dateDisplay: clean(date),
    yearStart: ys,
    yearEnd: ye,
    objectType: joinUnique(typeEn.slice(0, 3)),
    medium: joinUnique(formats.slice(0, 4)),
    culture: null,
    place: joinUnique(coverage.slice(0, 3)),
    ...(isCC0 ? RIGHTS.CC0 : RIGHTS.PD),
    thumbnailUrl: `${base}/500,/0/default.jpg`,
    imageUrl: `${base}/1600,/0/default.jpg`,
    originalImageUrl: `${base}/max/0/default.jpg`,
    width: null,
    height: null,
    contentType: 'image',
    files: [],
    text: [englishTerms(title, ...types, ...formats, desc, ...subjects), subjects.join(' '), clean(desc, 200)].filter(Boolean).join(' | '),
    boost: 0,
  }
}

async function harvestWindow(store, win, state, log, shouldStop) {
  let url = state.token
    ? `${OAI}?verb=ListRecords&resumptionToken=${encodeURIComponent(state.token)}`
    : `${OAI}?verb=ListRecords&metadataPrefix=oai_dc&from=${win.from}&until=${win.until}`
  let pages = 0
  for (;;) {
    if (shouldStop()) return
    let xml
    try {
      const res = await fetchWithRetry(url, { timeoutMs: 60000, retries: 5 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      xml = await res.text()
    } catch (e) {
      log(`rijks ${win.from}: ${e.message}; pausing 30s`)
      await sleep(30000)
      continue
    }
    if (xml.includes('<error code="noRecordsMatch"')) break
    const recs = xml.split('<record>').slice(1)
    let added = 0
    for (const r of recs) {
      const rec = normalizeRecord(r)
      if (rec && store.put(rec)) added++
    }
    state.n += added
    state.seen += recs.length
    pages++
    const tok = xml.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/)?.[1]
    const size = xml.match(/completeListSize="(\d+)"/)?.[1]
    state.token = tok || null
    if (pages % 20 === 0) log(`rijks ${win.from.slice(0, 13)}: ${state.seen}/${size || '?'} seen, ${state.n} PD kept`)
    if (pages % 5 === 0) store.setProgress('rijks:' + win.from, state)
    if (!tok) break
    url = `${OAI}?verb=ListRecords&resumptionToken=${encodeURIComponent(tok)}`
  }
  state.done = true
  store.setProgress('rijks:' + win.from, state)
  log(`rijks ${win.from.slice(0, 13)}: done, ${state.n} kept of ${state.seen}`)
}

export async function ingest(store, { limit = Infinity, log }) {
  // Most records carry a datestamp from a June 2026 bulk update; split that period into hourly windows so
  // several OAI streams can run in parallel. Windows are resumable via saved resumption tokens.
  const windows = [{ from: '1900-01-01T00:00:00Z', until: '2026-06-07T23:59:59Z' }]
  for (const day of ['2026-06-08', '2026-06-09', '2026-06-10']) {
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, '0')
      windows.push({ from: `${day}T${hh}:00:00Z`, until: `${day}T${hh}:59:59Z` })
    }
  }
  windows.push({ from: '2026-06-11T00:00:00Z', until: '2030-01-01T00:00:00Z' })
  const cap = Math.min(CAP, limit)
  const total = () => store.count('rijks')
  const shouldStop = () => total() >= cap
  const todo = windows.filter((w) => !store.getProgress('rijks:' + w.from)?.done)
  log(`rijks: ${todo.length} windows to harvest (cap ${cap}, have ${total()})`)
  await mapLimit(todo, Number(process.env.RIJKS_PARALLEL || 6), async (w) => {
    const state = store.getProgress('rijks:' + w.from) || { token: null, n: 0, seen: 0 }
    await harvestWindow(store, w, state, log, shouldStop)
  })
  log(`rijks: ${total()} records staged`)
}
