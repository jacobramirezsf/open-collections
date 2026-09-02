// NIH 3D (3d.nih.gov) — open scientific/medical 3D models (anatomy, proteins, lab hardware).
// No listing API: entry ids are scanned sequentially; each /api/entries/{id} returns submissions with
// per-entry licenses. Kept: published submissions under Public Domain / CC0 / CC BY with model files.
// Downloads go through the site's own output-file proxy (S3 URLs are private).
import { fetchWithRetry, mapLimit } from '../lib/http.mjs'
import { clean, RIGHTS } from '../lib/normalize.mjs'

export const key = 'nih3d'
export const name = 'NIH 3D'
export const homepage = 'https://3d.nih.gov/'

const MAX_ID = Number(process.env.NIH_MAX_ID || 23000)
const MODEL_FORMATS = new Set(['STL', 'GLB', 'OBJ', 'X3D', 'WRL', 'PLY', 'GLTF', 'USDZ', '3MF'])

function licenseOf(meta) {
  const l = (meta?.license || '').toLowerCase()
  if (!l) return null
  if (l.includes('public domain')) return RIGHTS.PD
  if (l.includes('cc0')) return RIGHTS.CC0
  if (l === 'cc-by' || l.includes('cc-by 4') || l.includes('cc by')) return RIGHTS.CC_BY
  if (l.includes('cc-by-sa')) return RIGHTS.CC_BY_SA
  return null
}

export function normalize(e) {
  const subs = (e.submissions || []).filter((s) => s.submissionStatus === 'Published')
  for (const sub of subs.sort((a, b) => (b.version || 0) - (a.version || 0))) {
    const meta = sub.metadata || {}
    const rights = licenseOf(meta)
    if (!rights) continue
    const files = []
    let thumb = null
    for (const run of sub.workflowRuns || []) {
      for (const f of run.outputFiles || []) {
        if (!f.fileId || !run.prefectRunId) continue
        const url = `https://3d.nih.gov/api/submissions/${sub.submissionId}/runs/${run.prefectRunId}/output-files/${f.fileId}`
        const fmt = (f.fileFormat || '').toUpperCase()
        if (MODEL_FORMATS.has(fmt)) {
          files.push({ format: fmt.toLowerCase(), url, filename: f.name, size: f.fileSize || undefined, label: f.name })
        } else if (!thumb && /thumb.*\.(jpg|jpeg|png)$/i.test(f.name || '')) {
          thumb = url
        }
      }
    }
    if (!files.length) continue
    const title = clean(meta.title) || `NIH 3D ${e.threedpxId}`
    const desc = clean(meta.description, 250)
    const kw = [...new Set((e.keywords || []).map((k) => k.trim().toLowerCase()))].slice(0, 12).join(' ')
    return {
      id: `nih3d:${e.threedpxId || e.entryId}`,
      source: key,
      sourceId: String(e.threedpxId || e.entryId),
      sourceUrl: `https://3d.nih.gov/entries/${e.threedpxId || e.entryId}`,
      title,
      creator: clean(sub.modifiedByUser?.displayName) || null,
      dateDisplay: sub.publishedDate ? sub.publishedDate.slice(0, 10) : null,
      yearStart: sub.publishedDate ? Number(sub.publishedDate.slice(0, 4)) : null,
      yearEnd: sub.publishedDate ? Number(sub.publishedDate.slice(0, 4)) : null,
      objectType: clean(e.category) || '3D model',
      medium: [...new Set(files.map((f) => f.format.toUpperCase()))].join(', '),
      culture: null,
      place: null,
      ...rights,
      thumbnailUrl: thumb,
      imageUrl: thumb,
      originalImageUrl: null,
      width: null,
      height: null,
      contentType: '3d',
      files: files.slice(0, 8),
      text: ['science medicine anatomy 3D model', e.category, kw, desc].filter(Boolean).join(' | '),
      boost: 0,
    }
  }
  return null
}

export async function ingest(store, { limit = Infinity, log }) {
  const start = store.getProgress('nih3d')?.next || 1
  let n = store.count(key)
  const ids = []
  for (let i = start; i <= MAX_ID; i++) ids.push(i)
  let done = 0
  let last = start
  await mapLimit(ids, 8, async (id) => {
    if (n >= limit) return
    try {
      const res = await fetchWithRetry(`https://3d.nih.gov/api/entries/${id}`, { retries: 2, timeoutMs: 30000 })
      if (res.status === 404) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const e = await res.json()
      const rec = normalize(e)
      if (rec && store.put(rec)) n++
    } catch (err) {
      // single-entry failures are fine; they'll be retried on the next full run
    } finally {
      done++
      last = Math.max(last, id)
      if (done % 500 === 0) {
        store.setProgress('nih3d', { next: Math.min(last, start + done) })
        log(`nih3d: scanned ${done}/${ids.length}, kept ${n}`)
      }
    }
  })
  store.setProgress('nih3d', { next: MAX_ID + 1 })
  store.flush()
  log(`nih3d: ${n} open-licensed models`)
}
