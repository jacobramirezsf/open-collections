// Three more print processes, each built from the way the real one puts ink on paper.
//
//  Screenprint  spot colours pushed through a mesh with a squeegee: every ink is flat and opaque,
//               printed lightest first with the darker inks covering; the mesh leaves a faint
//               weave in the ink, the squeegee never pulls perfectly evenly, wet ink gains a
//               little at every edge, and each screen registers slightly off.
//  Linocut      a carved block: the surface prints solid, what is gouged away stays paper, and the
//               mid-tones are made of parallel gouge cuts that widen as the tone lightens. Cuts
//               wobble and chatter, edges of solids are rough, ink in the solids is a little uneven.
//  Engraving    line engraving as on banknotes: lines in one direction that swell with darkness,
//               bend around the forms (the burin follows the modelling), and are crossed by a
//               second set in the darks. Highlights stay bare paper.
//
// Scale-aware and deterministic, so exports match the preview.

import type { TextureParams } from './textures'
import { LUT_N, separationLut } from './riso3'
import { blur, clamp01, hexToRgb, luminance, mottle, mulberry32, smooth } from './fx'

const scaleOf = (p: TextureParams, unit: number) => unit / Math.max(0.5, p.size)

function paperCanvas(w: number, h: number, paper: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  if (paper !== 'transparent') {
    ctx.fillStyle = paper
    ctx.fillRect(0, 0, w, h)
  }
  return { canvas, ctx }
}

const lutCache = new Map<string, Uint8Array>()

// ---------------------------------------------------------------------------------------------
// Screenprint. size: mesh px, amount: ink coverage, levels: inks 1..4, angle: misregistration.
export function renderScreenprint(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const w = work.width
  const h = work.height
  const src = work.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const s = scaleOf(p, unit)
  const n = Math.max(1, Math.min(4, Math.round(p.levels)))
  const inkHex = [p.ink, p.ink2, p.ink3, p.ink4].slice(0, n)
  const inks = inkHex.map(hexToRgb)
  const key = inkHex.join(',')
  let lut = lutCache.get(key)
  if (!lut) {
    lut = separationLut(inks)
    lutCache.set(key, lut)
  }
  const coverage = p.amount
  const misreg = (p.angle / 8) * 5 * s
  const meshPx = Math.max(1.5, unit)
  const { canvas, ctx } = paperCanvas(w, h, p.paper)
  // per-pixel separation index
  const qi = new Uint32Array(w * h)
  const cover = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3] / 255
    cover[i] = a
    if (a < 0.04) {
      qi[i] = 0xffffffff
      continue
    }
    const r = Math.round(((src[i * 4] / 255) * a + (1 - a)) * (LUT_N - 1))
    const g = Math.round(((src[i * 4 + 1] / 255) * a + (1 - a)) * (LUT_N - 1))
    const b = Math.round(((src[i * 4 + 2] / 255) * a + (1 - a)) * (LUT_N - 1))
    qi[i] = ((r * LUT_N + g) * LUT_N + b) * n
  }
  const lum = (c: [number, number, number]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
  const order = inks.map((c, i) => ({ i, l: lum(c) })).sort((a, b) => b.l - a.l).map((o) => o.i)
  const rnd = mulberry32(8080)
  const pull = mottle(w, h, Math.max(12, 0.12 * Math.min(w, h)), 81, 6) // squeegee unevenness
  for (const i of order) {
    // a screen: the separation, thresholded to a flat stencil, with a little dot gain
    const dens = new Float32Array(w * h)
    for (let k = 0; k < w * h; k++) dens[k] = qi[k] === 0xffffffff ? 0 : lut[qi[k] + i] / 255
    const soft = blur(dens, w, h, Math.max(1, 0.8 * s))
    const [ir, ig, ib] = inks[i]
    const layer = document.createElement('canvas')
    layer.width = w
    layer.height = h
    const lctx = layer.getContext('2d')!
    const im = lctx.createImageData(w, h)
    const d = im.data
    const gain = 0.06 * coverage
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x
        if (cover[k] < 0.04) continue
        // stencil open where the separation wants more than half this ink
        let a = smooth(0.5 - gain - 0.05, 0.5 - gain + 0.05, soft[k])
        if (a <= 0.01) continue
        // the mesh weave and the squeegee pull
        const mesh = 1 - 0.07 * (1 - coverage) * (0.5 + 0.5 * Math.sin((x / meshPx) * Math.PI * 2) * Math.sin((y / meshPx) * Math.PI * 2))
        const sq = 1 - (1 - coverage) * 0.3 * (pull[k] - 0.5) * 2
        a *= (0.86 + 0.14 * coverage) * mesh * sq * Math.min(1, cover[k] * 1.2)
        const o = k * 4
        d[o] = ir
        d[o + 1] = ig
        d[o + 2] = ib
        d[o + 3] = 255 * clamp01(a)
      }
    }
    lctx.putImageData(im, 0, 0)
    const ox = (rnd() - 0.5) * 2 * misreg
    const oy = (rnd() - 0.5) * 2 * misreg
    ctx.drawImage(layer, ox, oy)
  }
  return canvas
}

// ---------------------------------------------------------------------------------------------
// Linocut. size: gouge width px, amount: ink (how much of the tone prints solid), levels: carving
// detail 1..5 (tone bands cut as gouges), angle: gouge direction.
export function renderLinocut(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const { w, h, lum, alpha } = luminance(work, 'pan')
  const s = scaleOf(p, unit)
  const P = Math.max(2, unit)
  const a = (p.angle * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const bands = Math.max(1, Math.min(5, Math.round(p.levels)))
  const ink = hexToRgb(p.ink)
  const paper = hexToRgb(p.paper === 'transparent' ? '#f3efe6' : p.paper)
  const transparent = p.paper === 'transparent'
  // the hand: cuts wobble slowly and chatter along their length; solid edges are rough
  const wobble = mottle(w, h, Math.max(12, 0.07 * Math.min(w, h)), 91, 2)
  const chatter = mottle(w, h, Math.max(3, 4 * s), 92, 6)
  const rough = mottle(w, h, Math.max(2, 2.5 * s), 93)
  const inkTex = mottle(w, h, Math.max(3, 3 * s), 94, 2)
  const tHi = 0.72 - 0.4 * p.amount // darker than this prints solid
  const tLo = tHi - 0.42 // lighter than this is cut clean away
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const im = ctx.createImageData(w, h)
  const d = im.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const dark = 1 - lum[i] + (rough[i] - 0.5) * 0.07
      // fraction of the gouge period left standing (inked): 1 solid … 0 fully cut
      let f = smooth(tLo, tHi, dark)
      if (bands < 5) f = Math.round(f * bands) / bands // coarser carving keeps fewer tone steps
      let inkAmt: number
      if (f >= 0.999) inkAmt = 1
      else if (f <= 0.001) inkAmt = 0
      else {
        // parallel gouges: the ridge between two cuts is what prints
        const u = x * ca + y * sa + (wobble[i] - 0.5) * P * 0.9
        const phase = (((u / P) % 1) + 1) % 1
        const width = f * (0.85 + (chatter[i] - 0.5) * 0.35) // the cut chatters, so the ridge varies
        const half = width / 2
        const dist = Math.abs(phase - 0.5)
        inkAmt = smooth(half + 0.08, half - 0.08, dist)
      }
      // ink in the solids is a little uneven; cuts show the paper
      inkAmt *= 0.9 + (inkTex[i] - 0.5) * 0.2
      inkAmt = clamp01(inkAmt) * Math.min(1, alpha[i] * 1.2)
      const o = i * 4
      if (transparent) {
        d[o] = ink[0]
        d[o + 1] = ink[1]
        d[o + 2] = ink[2]
        d[o + 3] = 255 * inkAmt
      } else {
        d[o] = paper[0] + (ink[0] - paper[0]) * inkAmt
        d[o + 1] = paper[1] + (ink[1] - paper[1]) * inkAmt
        d[o + 2] = paper[2] + (ink[2] - paper[2]) * inkAmt
        d[o + 3] = 255
      }
    }
  }
  ctx.putImageData(im, 0, 0)
  return canvas
}

// ---------------------------------------------------------------------------------------------
// Engraving. size: line spacing px, amount: line weight, levels: 1 one set / 2 crossed darks,
// angle: direction.
export function renderEngraving(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const { w, h, lum, alpha } = luminance(work, 'pan')
  const s = scaleOf(p, unit)
  const P = Math.max(2, unit)
  const a = (p.angle * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const weight = p.amount
  const crossed = Math.round(p.levels) >= 2
  const ink = hexToRgb(p.ink)
  const paper = hexToRgb(p.paper === 'transparent' ? '#f5f2ea' : p.paper)
  const transparent = p.paper === 'transparent'
  // the burin follows the form: lines are displaced by the modelling (a blurred copy of the tone)
  const form = blur(lum, w, h, Math.max(2, 5 * s))
  const swell = P * 2.4
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const im = ctx.createImageData(w, h)
  const d = im.data
  const aa = 0.9 / P // anti-aliasing width in phase units
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const dark = 1 - lum[i]
      let inkAmt = 0
      if (dark > 0.04) {
        const disp = (form[i] - 0.5) * swell
        const u = x * ca + y * sa + disp
        const phase = (((u / P) % 1) + 1) % 1
        // the line swells with the darkness of the tone
        const th = Math.pow(dark, 1.3) * weight * 0.9
        inkAmt = smooth(th / 2 + aa, th / 2 - aa, Math.abs(phase - 0.5))
        if (crossed && dark > 0.5) {
          const v = -x * sa + y * ca + disp * 0.6
          const ph2 = (((v / (P * 1.15)) % 1) + 1) % 1
          const th2 = (dark - 0.5) * 2 * weight * 0.7
          inkAmt = Math.max(inkAmt, smooth(th2 / 2 + aa, th2 / 2 - aa, Math.abs(ph2 - 0.5)))
        }
      }
      inkAmt = clamp01(inkAmt) * Math.min(1, alpha[i] * 1.2)
      const o = i * 4
      if (transparent) {
        d[o] = ink[0]
        d[o + 1] = ink[1]
        d[o + 2] = ink[2]
        d[o + 3] = 255 * inkAmt
      } else {
        d[o] = paper[0] + (ink[0] - paper[0]) * inkAmt
        d[o + 1] = paper[1] + (ink[1] - paper[1]) * inkAmt
        d[o + 2] = paper[2] + (ink[2] - paper[2]) * inkAmt
        d[o + 3] = 255
      }
    }
  }
  ctx.putImageData(im, 0, 0)
  return canvas
}
