// Alternative photographic processes, emulated from how each one physically forms an image.
// Grounded in the process literature (alternativephotography.com, conservation notes, the
// Wikipedia process articles). Each tool copies the things that make the real object
// recognisable, not a colour preset:
//
//  Salt print      the calotype's paper negative printed on salted paper: soft, matte, the paper
//                  fibre in the image, reddish- to purplish-brown, a long gentle scale with limited
//                  dmax, hand-brushed sensitizer borders, warm fading at the edges.
//  Cyanotype       Prussian blue by UV, brushed coating with stroke marks, short scale with
//                  contrasty mids; overexposure blocks the shadows and bronzes them; tea or tannin
//                  toning turns the blue to grey-browns and yellows the paper.
//  Lith print      infectious development: hard gritty shadows that race to black, creamy soft
//                  highlights, and a colour split between peachy lights and olive-brown darks.
//  Gum bichromate  watercolour pigment in gum on rough paper, one thin layer per pigment, each with
//                  a short tonal range and soft washed edges, pigment pooling at the edges of dark
//                  areas, tri-colour layers registered a little off.
//
// All scale-aware and deterministic, so the print export matches the preview.

import type { TextureParams } from './textures'
import { blur, brushedArea, clamp01, hexToRgb, lerpRgb, luminance, mottle, mulberry32, smooth } from './fx'

type Rgb = [number, number, number]

// piecewise-linear colour map over density 0..1
function ramp(stops: [number, Rgb][]): (t: number) => Rgb {
  return (t) => {
    if (t <= stops[0][0]) return stops[0][1]
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [a, ca] = stops[i - 1]
        const [b, cb] = stops[i]
        return lerpRgb(ca, cb, (t - a) / Math.max(1e-6, b - a))
      }
    }
    return stops[stops.length - 1][1]
  }
}

function outCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; im: ImageData } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  return { canvas, ctx, im: ctx.createImageData(w, h) }
}

// how many output px one preview px is (the size slider arrives already scaled as `unit`)
const scaleOf = (p: TextureParams, unit: number) => unit / Math.max(0.5, p.size)

// ---------------------------------------------------------------------------------------------
// Salt print from a calotype negative. size: softness px, amount: exposure, levels: paper fibre
// 0..10, angle: brushed edge 0..10. ink: print colour, paper: sheet.
export function renderSaltPrint(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const { w, h, lum: raw, alpha } = luminance(work, 'ortho')
  const s = scaleOf(p, unit)
  const lum = p.size > 0.2 ? blur(raw, w, h, unit) : raw
  const paper = hexToRgb(p.paper === 'transparent' ? '#e9dcc3' : p.paper)
  const ink = hexToRgb(p.ink)
  // mids lean purplish: the classic salt-print colour turn
  const mid = lerpRgb(lerpRgb(paper, ink, 0.55), [120, 70, 80], 0.18)
  const tone = ramp([[0, paper], [0.5, mid], [1, ink]])
  const fibreK = p.levels / 10
  const fibre = mottle(w, h, Math.max(1.5, 1.8 * s), 31, 4)
  const coarse = mottle(w, h, Math.max(6, 0.06 * Math.min(w, h)), 32)
  const coat = brushedArea(w, h, p.angle > 0 ? 0.035 * Math.min(w, h) : 0, (p.angle / 10) * 0.045 * Math.min(w, h), 33)
  const { canvas, ctx, im } = outCanvas(w, h)
  const d = im.data
  const e = p.amount
  for (let i = 0; i < w * h; i++) {
    const dark = 1 - lum[i]
    // printing-out: self-masking, a long gentle scale, dmax that never quite gets to black
    let dens = 0.04 + 0.84 * Math.pow(smooth(0.02, 1, dark), 0.9 + 0.5 * (1 - e)) * (0.55 + 0.5 * e)
    dens *= 1 + (fibre[i] - 0.5) * 0.4 * fibreK + (coarse[i] - 0.5) * 0.12 * fibreK
    dens = clamp01(dens * coat[i])
    // bare paper past the coating, warmer and a little yellowed towards the edges
    const edge = 1 - coat[i]
    let c = tone(dens)
    c = lerpRgb(c, [paper[0], paper[1] * 0.96, paper[2] * 0.86], edge * 0.6)
    const g = 1 + (fibre[i] - 0.5) * 0.06 * fibreK
    const o = i * 4
    d[o] = c[0] * g
    d[o + 1] = c[1] * g
    d[o + 2] = c[2] * g
    d[o + 3] = p.paper === 'transparent' ? 255 * alpha[i] : 255
  }
  ctx.putImageData(im, 0, 0)
  return canvas
}

// ---------------------------------------------------------------------------------------------
// Cyanotype. size: brushed edge 0..10, amount: exposure, levels: toning 0 blue .. 10 tea,
// angle: paper texture 0..10. paper: sheet.
export function renderCyanotype(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const { w, h, lum, alpha } = luminance(work, 'ortho')
  const s = scaleOf(p, unit)
  const e = p.amount
  const tea = p.levels / 10
  const paper0 = hexToRgb(p.paper === 'transparent' ? '#efe9dc' : p.paper)
  const paper: Rgb = lerpRgb(paper0, [paper0[0], paper0[1] * 0.93, paper0[2] * 0.78], tea)
  const light: Rgb = lerpRgb([146, 182, 214], [176, 160, 140], tea)
  const blue: Rgb = lerpRgb([16, 56, 118], [98, 78, 66], tea)
  const deep: Rgb = lerpRgb([7, 28, 66], [40, 32, 28], tea)
  const tone = ramp([[0, paper], [0.35, light], [0.8, blue], [1, deep]])
  const BRONZE: Rgb = [92, 84, 70]
  const strokes = mottle(w, h, Math.max(3, 3 * s), 41, 12) // the brush left its marks in the coating
  const tex = mottle(w, h, Math.max(1.5, 1.5 * s), 42)
  const texK = p.angle / 10
  const coat = brushedArea(w, h, p.size > 0 ? 0.04 * Math.min(w, h) : 0, (p.size / 10) * 0.045 * Math.min(w, h), 43)
  const { canvas, ctx, im } = outCanvas(w, h)
  const d = im.data
  for (let i = 0; i < w * h; i++) {
    const dark = 1 - lum[i]
    // a short, contrasty scale that saturates: more exposure blocks the shadows
    const k = 0.7 + 1.6 * e
    let dens = 1 - Math.exp(-k * 1.6 * Math.pow(dark, 1.15))
    dens *= 1 + (strokes[i] - 0.5) * 0.1 + (tex[i] - 0.5) * 0.12 * texK
    dens = clamp01(dens * coat[i])
    let c = tone(dens)
    // bronzing: blocked, overexposed shadows go metallic
    if (e > 0.55) c = lerpRgb(c, BRONZE, smooth(0.86, 1, dens) * ((e - 0.55) / 0.45) * 0.7)
    // the paper's tooth
    const g = 1 + (tex[i] - 0.5) * 0.05 * texK
    const o = i * 4
    d[o] = c[0] * g
    d[o + 1] = c[1] * g
    d[o + 2] = c[2] * g
    d[o + 3] = p.paper === 'transparent' ? 255 * alpha[i] : 255
  }
  ctx.putImageData(im, 0, 0)
  return canvas
}

// ---------------------------------------------------------------------------------------------
// Lith print. size: grain px, amount: development, levels: colour split 0..10, angle: snatch
// point 0..10 (earlier = brighter, emptier highlights). ink: shadows, ink2: highlight tint, paper.
export function renderLith(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const { w, h, lum, alpha } = luminance(work, 'pan')
  const dev = p.amount
  const split = p.levels / 10
  const snatch = p.angle / 10
  const paper = hexToRgb(p.paper === 'transparent' ? '#f2eadb' : p.paper)
  const ink = hexToRgb(p.ink)
  const warm = lerpRgb(lerpRgb(paper, ink, 0.4), hexToRgb(p.ink2), split)
  const tone = ramp([[0, paper], [0.38, warm], [1, ink]])
  const g1 = mottle(w, h, Math.max(1, unit), 61)
  const g2 = mottle(w, h, Math.max(1, unit * 0.5), 62)
  const { canvas, ctx, im } = outCanvas(w, h)
  const d = im.data
  for (let i = 0; i < w * h; i++) {
    const dark = 1 - lum[i]
    // highlights come from exposure: soft and creamy, emptier with an early snatch
    const dh = Math.pow(dark, 1.7) * 0.5 * (1 - 0.5 * snatch)
    // shadows come from development: infectious, they race to black past a point
    const ds = Math.pow(smooth(0.42 - 0.3 * dev, 0.85 - 0.1 * dev, dark), 0.9)
    let dens = dh + (1 - dh) * ds * (0.55 + 0.45 * dev)
    // gritty grain in the shadows, none in the highlights
    const grain = (g1[i] - 0.5) * 0.9 + (g2[i] - 0.5) * 0.5
    dens += grain * ds * (1 - ds * 0.6) * (0.5 + 0.5 * dev)
    dens = clamp01(dens)
    const c = tone(dens)
    const o = i * 4
    d[o] = c[0]
    d[o + 1] = c[1]
    d[o + 2] = c[2]
    d[o + 3] = p.paper === 'transparent' ? 255 * alpha[i] : 255
  }
  ctx.putImageData(im, 0, 0)
  return canvas
}

// ---------------------------------------------------------------------------------------------
// Gum bichromate. size: paper texture px, amount: contrast, levels: layers 1..3, angle:
// misregistration 0..10. ink / ink2 / ink3: pigments (mono uses ink), paper.
export function renderGum(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const w = work.width
  const h = work.height
  const src = work.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const s = scaleOf(p, unit)
  const layers = Math.max(1, Math.min(3, Math.round(p.levels)))
  const contrast = p.amount
  const misreg = (p.angle / 10) * 6 * s
  const transparent = p.paper === 'transparent'
  const paper = hexToRgb(transparent ? '#f0e8d8' : p.paper)
  const tex = mottle(w, h, Math.max(3, unit * 2.2), 71)
  const tex2 = mottle(w, h, Math.max(2, unit * 0.9), 72)
  const coat = brushedArea(w, h, 0.03 * Math.min(w, h), 0.03 * Math.min(w, h), 73)
  // separations: one pigment from luminance, or three from the subtractive primaries
  const seps: Float32Array[] = []
  const pigments: Rgb[] = []
  const inks = [hexToRgb(p.ink), hexToRgb(p.ink2), hexToRgb(p.ink3)]
  const alphaArr = new Float32Array(w * h)
  for (let L = 0; L < layers; L++) {
    const sep = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const a = src[i * 4 + 3] / 255
      alphaArr[i] = a
      const r = (src[i * 4] / 255) * a + (1 - a)
      const g = (src[i * 4 + 1] / 255) * a + (1 - a)
      const b = (src[i * 4 + 2] / 255) * a + (1 - a)
      let v: number
      if (layers === 1) v = 1 - (0.299 * r + 0.587 * g + 0.114 * b)
      else if (layers === 2) v = L === 0 ? 1 - (0.299 * r + 0.587 * g + 0.114 * b) : clamp01((r - b) * 0.9 + 0.2) * (1 - (r + g + b) / 3 * 0.5)
      else v = L === 0 ? 1 - r : L === 1 ? 1 - g : 1 - b // cyan, magenta, yellow pigments
      sep[i] = clamp01(v)
    }
    seps.push(sep)
    pigments.push(inks[L])
  }
  const { canvas, ctx } = outCanvas(w, h)
  if (!transparent) {
    // rough watercolour paper
    const im = ctx.createImageData(w, h)
    for (let i = 0; i < w * h; i++) {
      const g = 1 + (tex[i] - 0.5) * 0.06 + (tex2[i] - 0.5) * 0.03
      im.data[i * 4] = paper[0] * g
      im.data[i * 4 + 1] = paper[1] * g
      im.data[i * 4 + 2] = paper[2] * g
      im.data[i * 4 + 3] = 255
    }
    ctx.putImageData(im, 0, 0)
    ctx.globalCompositeOperation = 'multiply'
  }
  const rnd = mulberry32(74)
  const gamma = 1.5 - 0.9 * contrast
  for (let L = 0; L < layers; L++) {
    const sep = seps[L]
    // one thin coat: a short tonal range, washed soft, pigment pooling at the edges of darks
    const soft = blur(sep, w, h, Math.max(1, 1.5 * s))
    const wide = blur(sep, w, h, Math.max(2, 7 * s))
    const layer = document.createElement('canvas')
    layer.width = w
    layer.height = h
    const lctx = layer.getContext('2d')!
    const im = lctx.createImageData(w, h)
    const [pr, pg, pb] = pigments[L]
    for (let i = 0; i < w * h; i++) {
      let dens = smooth(0.06, 0.94, Math.pow(soft[i], gamma))
      const pool = Math.max(0, soft[i] - wide[i])
      dens += pool * 0.5
      // pigment settles into the paper's valleys; the coat thins where the brush was dry
      dens *= 0.9 + (tex[i] - 0.5) * 0.22 + (tex2[i] - 0.5) * 0.08
      dens = clamp01(dens * 0.9) * coat[i] * Math.min(1, alphaArr[i] * 1.2)
      const o = i * 4
      im.data[o] = pr
      im.data[o + 1] = pg
      im.data[o + 2] = pb
      im.data[o + 3] = 255 * dens
    }
    lctx.putImageData(im, 0, 0)
    const ox = (rnd() - 0.5) * 2 * misreg
    const oy = (rnd() - 0.5) * 2 * misreg
    ctx.drawImage(layer, L === 0 ? 0 : ox, L === 0 ? 0 : oy)
  }
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}
