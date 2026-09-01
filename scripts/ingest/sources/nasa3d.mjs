// NASA 3D Resources — science.nasa.gov/3d-resources (WordPress REST). ~380 models with STL/GLB/etc downloads.
import { fetchWithRetry } from '../lib/http.mjs'
import { clean, RIGHTS, extOf } from '../lib/normalize.mjs'

export const key = 'nasa3d'
export const name = 'NASA 3D Resources'
export const homepage = 'https://science.nasa.gov/3d-resources/'

const API = 'https://science.nasa.gov/wp-json/wp/v2/topic?parent=447593&per_page=100&_fields=id,slug,link,title,excerpt,content,featured_image_url,date'
const MODEL_EXT = new Set(['stl', 'glb', 'gltf', 'obj', 'fbx', 'blend', '3ds', 'lwo', 'zip', '7z', 'usdz', 'dae', 'ply'])

export function normalize(t) {
  const html = t.content?.rendered || ''
  const urls = new Set()
  for (const m of html.matchAll(/https:\/\/assets\.science\.nasa\.gov\/content\/dam\/[^"'\s<>]+?\.([a-z0-9]{2,5})(?:\?[^"'\s<>]*)?(?=["'\s<>])/gi)) {
    const u = m[0].replace(/\?.*$/, '')
    const ext = extOf(u)
    if (ext && MODEL_EXT.has(ext) && !/\/resources\/image\//.test(u)) urls.add(u)
  }
  if (!urls.size) return null
  const files = [...urls].map((u) => {
    const fname = decodeURIComponent(u.split('/').pop())
    let format = extOf(u)
    if (format === 'zip' || format === '7z') {
      const hint = fname.match(/\b(stl|obj|glb|gltf|fbx|3ds|blend)\b/i)
      if (hint) format = hint[1].toLowerCase()
    }
    return { format, url: u, filename: fname, label: fname }
  })
  files.sort((a, b) => ['stl', 'glb', 'obj', 'gltf'].indexOf(a.format) - ['stl', 'glb', 'obj', 'gltf'].indexOf(b.format))
  const title = clean(t.title?.rendered)
  const desc = clean(t.excerpt?.rendered || html.replace(/<style[\s\S]*?<\/style>/g, ''), 500)
  const preview = t.featured_image_url ? t.featured_image_url.replace(/\?.*$/, '') : null
  return {
    id: `nasa3d:${t.id}`,
    source: key,
    sourceId: String(t.id),
    sourceUrl: t.link,
    title,
    creator: 'NASA',
    dateDisplay: null,
    yearStart: null,
    yearEnd: null,
    objectType: '3D model',
    medium: [...new Set(files.map((f) => f.format.toUpperCase()))].join(', '),
    culture: null,
    place: null,
    ...RIGHTS.NASA,
    thumbnailUrl: preview ? `${preview}?w=600&fit=clip` : null,
    imageUrl: preview ? `${preview}?w=1600&fit=clip` : null,
    originalImageUrl: preview,
    width: null,
    height: null,
    contentType: '3d',
    files,
    text: ['spacecraft space science 3D model', desc].filter(Boolean).join(' | '),
    boost: 1,
  }
}

export async function ingest(store, { limit = Infinity, log }) {
  let n = 0
  for (let page = 1; page <= 20; page++) {
    const res = await fetchWithRetry(`${API}&page=${page}`, { timeoutMs: 60000 })
    if (res.status === 400) break // past last page
    if (!res.ok) throw new Error(`nasa3d: HTTP ${res.status}`)
    const topics = await res.json()
    if (!Array.isArray(topics) || !topics.length) break
    for (const t of topics) {
      const rec = normalize(t)
      if (rec && store.put(rec)) n++
    }
    log(`nasa3d: page ${page}, ${n} models`)
    if (Number(res.headers.get('x-wp-totalpages')) <= page || n >= limit) break
  }
  log(`nasa3d: ingested ${n}`)
}
