// Europeana — aggregated EU cultural heritage (Search API, free key: EUROPEANA_API_KEY).
// 21M openly-licensed images exist but are dominated by natural-history specimen scans, so we
// harvest curated THEME collections with per-theme and per-provider caps, and exclude providers we
// already index directly (Rijksmuseum, SMK, Wellcome). Rights are per record (PD/CC0/CC BY/BY-SA).
// Docs: https://europeana.atlassian.net/wiki/spaces/EF/pages/2385739812/Search+API
import { getJson, sleep } from '../lib/http.mjs'
import { clean, joinUnique, years, RIGHTS } from '../lib/normalize.mjs'

export const key = 'europeana'
export const name = 'Europeana'
export const homepage = 'https://www.europeana.eu/en/collections'

// theme → [cap, per-provider cap]
const THEMES = {
  art: [160000, 15000],
  photography: [80000, 12000],
  archaeology: [45000, 10000],
  industrial: [40000, 10000],
  fashion: [40000, 10000],
  music: [20000, 6000],
  manuscript: [15000, 6000],
}
const EXCLUDE_PROVIDERS = ['Rijksmuseum', 'National Gallery of Denmark', 'Wellcome Collection', 'Statens Museum for Kunst']

const RIGHTS_MAP = [
  [/publicdomain\/mark/, RIGHTS.PD],
  [/publicdomain\/zero/, RIGHTS.CC0],
  [/licenses\/by\/(?!nc|nd)/, RIGHTS.CC_BY],
  [/licenses\/by-sa/, RIGHTS.CC_BY_SA],
]

function pickTitle(i) {
  const la = i.dcTitleLangAware || {}
  const en = la.en?.[0] || la.eng?.[0]
  return clean(en || i.title?.[0], 220)
}

export function normalize(i, theme) {
  const rightsUrl = i.rights?.[0] || ''
  const rights = RIGHTS_MAP.find(([re]) => re.test(rightsUrl))?.[1]
  if (!rights) return null
  const shownBy = i.edmIsShownBy?.[0]
  if (!shownBy || !/^https?:\/\//.test(shownBy)) return null
  const title = pickTitle(i)
  if (!title || /^\[?(untitled|unknown|zonder titel|ohne titel)\]?$/i.test(title)) return null
  const id = String(i.id || '').replace(/^\//, '')
  if (!id) return null
  const yr = Array.isArray(i.year) ? i.year.map(Number).filter((y) => Number.isFinite(y) && y > 0 && y <= 2100) : []
  const [ys, ye] = yr.length ? [Math.min(...yr), Math.max(...yr)] : years(null, null, null)
  const provider = clean(i.dataProvider?.[0], 90)
  const enDesc = i.dcDescriptionLangAware?.en?.[0] || i.dcDescription?.[0]
  const thumb = `https://api.europeana.eu/thumbnail/v2/url.json?uri=${encodeURIComponent(shownBy)}&type=IMAGE&size=w400`
  return {
    id: `europeana:${id}`,
    source: key,
    sourceId: id,
    sourceUrl: `https://www.europeana.eu/en/item/${id}`,
    title,
    creator: joinUnique((i.dcCreator || []).slice(0, 3), '; ', 140),
    dateDisplay: yr.length ? (ys === ye ? String(ys) : `${ys}–${ye}`) : null,
    yearStart: ys,
    yearEnd: ye,
    objectType: null,
    medium: null,
    culture: null,
    place: joinUnique((i.country || []).slice(0, 2)),
    publicDomain: rights.publicDomain,
    rightsLabel: rights.rightsLabel + (provider ? ` · ${provider}` : ''),
    licenseUrl: rightsUrl || rights.licenseUrl,
    thumbnailUrl: thumb,
    imageUrl: shownBy,
    originalImageUrl: shownBy,
    width: null,
    height: null,
    contentType: 'image',
    files: [],
    text: [theme, provider, clean(enDesc, 220)].filter(Boolean).join(' | '),
    boost: 0,
  }
}

async function harvestTheme(store, theme, cap, perProvider, apikey, log) {
  const state = store.getProgress('eu:' + theme) || { cursor: '*', n: 0, done: false, providers: {} }
  if (state.done) {
    log(`europeana/${theme}: already complete (${state.n})`)
    return
  }
  const providers = state.providers
  const qf = ['TYPE:IMAGE', `collection:${theme}`, ...EXCLUDE_PROVIDERS.map((p) => `-DATA_PROVIDER:"${p}"`)]
  let requests = 0
  const maxRequests = Math.ceil((cap / 100) * 3)
  while (state.n < cap && requests < maxRequests && state.cursor) {
    const sp = new URLSearchParams({ wskey: apikey, query: '*', rows: '100', profile: 'rich', reusability: 'open', cursor: state.cursor })
    for (const f of qf) sp.append('qf', f)
    let res
    try {
      res = await getJson(`https://api.europeana.eu/record/v2/search.json?${sp}`, { timeoutMs: 60000, retries: 4 })
    } catch (e) {
      log(`europeana/${theme}: ${e.message}; pausing 20s`)
      await sleep(20000)
      continue
    }
    requests++
    for (const item of res.items || []) {
      if (state.n >= cap) break
      const prov = item.dataProvider?.[0] || '?'
      if ((providers[prov] || 0) >= perProvider) continue
      const rec = normalize(item, theme)
      if (rec && store.put(rec)) {
        state.n++
        providers[prov] = (providers[prov] || 0) + 1
      }
    }
    state.cursor = res.nextCursor || null
    if (requests % 40 === 0) {
      store.setProgress('eu:' + theme, state)
      log(`europeana/${theme}: ${state.n}/${cap} kept (${requests} pages, total ${res.totalResults})`)
    }
    if (!res.items?.length) break
    await sleep(120)
  }
  state.done = true
  store.setProgress('eu:' + theme, state)
  log(`europeana/${theme}: done, ${state.n} kept`)
}

export async function ingest(store, { log }) {
  const apikey = process.env.EUROPEANA_API_KEY
  if (!apikey) throw new Error('EUROPEANA_API_KEY not set')
  // three themes at a time keeps us at a polite request rate
  const entries = Object.entries(THEMES)
  const workers = []
  let idx = 0
  for (let w = 0; w < 3; w++) {
    workers.push(
      (async () => {
        while (idx < entries.length) {
          const [theme, [cap, per]] = entries[idx++]
          await harvestTheme(store, theme, cap, per, apikey, log)
        }
      })(),
    )
  }
  await Promise.all(workers)
  log(`europeana: total staged ${store.count(key)}`)
}
