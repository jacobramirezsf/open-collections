// POST /api/vectorize { w, h, bits, corners?, curveFit? } → { svg }
// The vectorizer's Outline engine: Potrace (esm-potrace-wasm, GPL-2.0) traces a black-and-white
// mask into smooth filled outlines. The browser does all the image prep (threshold, blur, bridge,
// despeckle) and sends the result as 1 bit per pixel, row-major, most significant bit first,
// base64; this function only runs Potrace. It runs here rather than in the browser to keep the
// GPL code out of the page we distribute.
import { createRequire } from 'node:module'
import { handler, error, json } from './_lib/http.js'

export const config = { maxDuration: 30 }

const MAX_PIXELS = 4096 * 4096

type Potrace = typeof import('esm-potrace-wasm')
let potraceReady: Promise<Potrace> | null = null

// The emscripten build detects Node and then reaches for CommonJS `require` and `__dirname`,
// which an ES module does not have; give it both before it loads.
function loadPotrace(): Promise<Potrace> {
  if (!potraceReady) {
    const g = globalThis as any
    g.require ??= createRequire(import.meta.url)
    g.__dirname ??= '/'
    potraceReady = import('esm-potrace-wasm').then(async (m) => {
      await m.init()
      return m
    })
  }
  return potraceReady
}

export default handler(async (req: Request) => {
  if (req.method !== 'POST') return error('POST only', 405)
  const text = await req.text()
  if (text.length > 4_400_000) return error('Image too large to trace.', 413)
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    return error('invalid body')
  }
  const w = Math.trunc(Number(body?.w))
  const h = Math.trunc(Number(body?.h))
  if (!(w > 0 && h > 0) || w * h > MAX_PIXELS || typeof body?.bits !== 'string') return error('w, h and bits required')
  const bits = Buffer.from(body.bits, 'base64')
  if (bits.length !== Math.ceil((w * h) / 8)) return error('bits do not match w×h')

  const rgba = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let i = 0; i < w * h; i++) {
    if ((bits[i >> 3] >> (7 - (i & 7))) & 1) rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 0
  }
  const clamp = (v: unknown, lo: number, hi: number, def: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : def)
  const { potrace } = await loadPotrace()
  const svg = await potrace({ data: rgba, width: w, height: h } as unknown as Parameters<Potrace['potrace']>[0], {
    turdsize: 0, // specks were already removed by the browser's despeckle
    turnpolicy: 4,
    alphamax: clamp(body.corners, 0, 1.3334, 1),
    opticurve: 1,
    opttolerance: clamp(body.curveFit, 0, 1, 0.2),
    pathonly: false,
    extractcolors: false,
    posterizelevel: 2,
    posterizationalgorithm: 0,
  })
  return json({ svg }, { headers: { 'cache-control': 'no-store' } })
})
