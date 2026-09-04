// Texture effects for the editor: classic print/analog techniques (ordered + error-diffusion
// dithering, riso-style grain, stippling, glyph mosaics, crosshatch, duotone/cyanotype, pixelate,
// paper grain) implemented scale-aware so the tuned preview re-renders identically at print
// resolution. All pure canvas; transparent pixels (remove.bg cutouts) are respected.

import { type Screen, renderScreen as renderHalftoneScreen } from './halftone'

export type EffectKind = 'halftone' | 'dither' | 'riso' | 'stipple' | 'glyphs' | 'hatch' | 'duotone' | 'pixelate' | 'paper' | 'ascii' | 'risoduo' | 'cmyk' | 'gradient'

export interface TextureParams {
  size: number // cell/block/spacing in preview px
  amount: number // 0..1 intensity/strength
  levels: number // posterize levels where relevant
  angle: number
  ink: string
  ink2: string // second ink (riso duo)
  paper: string // css color or 'transparent'
  invert: boolean
  colorize: boolean // ascii: sample glyph color from the image
}

export interface ControlDef {
  k: keyof TextureParams
  label: string
  min: number
  max: number
  step: number
}

export interface EffectDef {
  key: EffectKind
  label: string
  controls: ControlDef[]
  colors: ('ink' | 'ink2' | 'paper')[]
  invert?: boolean
  colorize?: boolean
  defaults: Partial<TextureParams>
}

export const TEXTURE_DEFAULTS: TextureParams = { size: 6, amount: 0.7, levels: 4, angle: 22, ink: '#141414', ink2: '#e4572e', paper: '#f3f1e8', invert: false, colorize: false }

export const EFFECTS: EffectDef[] = [
  { key: 'halftone', label: 'Halftone', controls: [], colors: [], defaults: {} }, // handled by the dedicated halftone module
  {
    key: 'dither',
    label: 'Dither',
    controls: [
      { k: 'size', label: 'Pixel size', min: 1, max: 12, step: 1 },
      { k: 'amount', label: 'Contrast', min: 0, max: 1, step: 0.05 },
    ],
    colors: ['ink', 'paper'],
    invert: true,
    defaults: { size: 3, amount: 0.5 },
  },
  {
    key: 'riso',
    label: 'Riso grain',
    controls: [
      { k: 'amount', label: 'Grain', min: 0, max: 1, step: 0.05 },
      { k: 'levels', label: 'Ink levels', min: 2, max: 6, step: 1 },
    ],
    colors: ['ink', 'paper'],
    invert: true,
    defaults: { amount: 0.65, levels: 3, ink: '#1d4ed8' },
  },
  {
    key: 'stipple',
    label: 'Stipple',
    controls: [
      { k: 'size', label: 'Dot spacing', min: 3, max: 14, step: 1 },
      { k: 'amount', label: 'Density', min: 0.2, max: 1, step: 0.05 },
    ],
    colors: ['ink', 'paper'],
    invert: true,
    defaults: { size: 5, amount: 0.85 },
  },
  {
    key: 'glyphs',
    label: 'Glyphs',
    controls: [{ k: 'size', label: 'Glyph size', min: 6, max: 24, step: 1 }],
    colors: ['ink', 'paper'],
    invert: true,
    defaults: { size: 10 },
  },
  {
    key: 'hatch',
    label: 'Crosshatch',
    controls: [
      { k: 'size', label: 'Line spacing', min: 3, max: 14, step: 1 },
      { k: 'angle', label: 'Angle', min: 0, max: 90, step: 1 },
      { k: 'amount', label: 'Line weight', min: 0.2, max: 1, step: 0.05 },
    ],
    colors: ['ink', 'paper'],
    defaults: { size: 6, amount: 0.6, angle: 35 },
  },
  {
    key: 'duotone',
    label: 'Duotone',
    controls: [
      { k: 'amount', label: 'Contrast', min: 0, max: 1, step: 0.05 },
      { k: 'levels', label: 'Posterize', min: 0, max: 8, step: 1 },
    ],
    colors: ['ink', 'paper'],
    invert: true,
    defaults: { amount: 0.55, levels: 0, ink: '#123c6e', paper: '#f2ede2' },
  },
  {
    key: 'pixelate',
    label: 'Pixelate',
    controls: [
      { k: 'size', label: 'Block size', min: 2, max: 24, step: 1 },
      { k: 'levels', label: 'Posterize', min: 0, max: 8, step: 1 },
    ],
    colors: [],
    defaults: { size: 8, levels: 5 },
  },
  {
    key: 'ascii',
    label: 'ASCII',
    controls: [{ k: 'size', label: 'Character size', min: 5, max: 20, step: 1 }],
    colors: ['ink', 'paper'],
    invert: true,
    colorize: true,
    defaults: { size: 8 },
  },
  {
    key: 'risoduo',
    label: 'Riso 2-color',
    controls: [
      { k: 'amount', label: 'Grain', min: 0, max: 1, step: 0.05 },
      { k: 'size', label: 'Misregistration', min: 0, max: 12, step: 1 },
    ],
    colors: ['ink', 'ink2', 'paper'],
    invert: true,
    defaults: { amount: 0.55, size: 4, ink: '#1d4ed8', ink2: '#e4572e' },
  },
  {
    key: 'cmyk',
    label: 'CMYK halftone',
    controls: [
      { k: 'size', label: 'Dot size', min: 4, max: 16, step: 1 },
      { k: 'amount', label: 'Dot gain', min: 0.6, max: 1.5, step: 0.05 },
    ],
    colors: ['paper'],
    defaults: { size: 6, amount: 1.05, paper: '#ffffff' },
  },
  {
    key: 'gradient',
    label: 'Gradient',
    controls: [
      { k: 'size', label: 'Detail', min: 2, max: 10, step: 1 },
      { k: 'amount', label: 'Saturation', min: 0, max: 1, step: 0.05 },
    ],
    colors: [],
    defaults: { size: 4, amount: 0.6 },
  },
  {
    key: 'paper',
    label: 'Paper grain',
    controls: [
      { k: 'amount', label: 'Grain', min: 0, max: 1, step: 0.05 },
      { k: 'size', label: 'Fiber scale', min: 1, max: 6, step: 1 },
    ],
    colors: [],
    defaults: { amount: 0.5, size: 2 },
  },
]

export function effectDef(key: EffectKind): EffectDef {
  return EFFECTS.find((e) => e.key === key)!
}

// deterministic PRNG so preview and hi-res export agree on grain/jitter layout
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  const v = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

interface Gray {
  w: number
  h: number
  lum: Float32Array // 0..1 (composited over white)
  alpha: Float32Array // 0..1
  rgb: Uint8ClampedArray
}

function grayOf(src: HTMLCanvasElement): Gray {
  const { width: w, height: h } = src
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const lum = new Float32Array(w * h)
  const alpha = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3] / 255
    alpha[i] = a
    lum[i] = ((0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255) * a + (1 - a)
  }
  return { w, h, lum, alpha, rgb: d }
}

function makeOut(w: number, h: number, paper: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
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

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
]

// downsample luminance/alpha to a cell grid
function grid(g: Gray, cell: number): { gw: number; gh: number; lum: Float32Array; alpha: Float32Array } {
  const gw = Math.ceil(g.w / cell)
  const gh = Math.ceil(g.h / cell)
  const lum = new Float32Array(gw * gh)
  const alpha = new Float32Array(gw * gh)
  const cnt = new Float32Array(gw * gh)
  for (let y = 0; y < g.h; y++) {
    const gy = (y / cell) | 0
    for (let x = 0; x < g.w; x++) {
      const gi = gy * gw + ((x / cell) | 0)
      lum[gi] += g.lum[y * g.w + x]
      alpha[gi] += g.alpha[y * g.w + x]
      cnt[gi]++
    }
  }
  for (let i = 0; i < gw * gh; i++) {
    lum[i] /= cnt[i] || 1
    alpha[i] /= cnt[i] || 1
  }
  return { gw, gh, lum, alpha }
}

function tone(v: number, amount: number, invert: boolean): number {
  // contrast curve around 0.5, then optional invert; v is luminance (1 = white)
  const c = 0.5 + (v - 0.5) * (1 + amount * 2)
  const t = Math.max(0, Math.min(1, c))
  return invert ? 1 - t : t
}

export function applyTexture(effect: EffectKind, src: HTMLCanvasElement, p: TextureParams, previewWidth: number, scale = 1): HTMLCanvasElement {
  const w = Math.round(src.width * scale)
  const h = Math.round(src.height * scale)
  // work from a canvas at output resolution
  let work = src
  if (scale !== 1) {
    work = document.createElement('canvas')
    work.width = w
    work.height = h
    work.getContext('2d')!.drawImage(src, 0, 0, w, h)
  }
  const unit = Math.max(1, (p.size * (src.width / previewWidth)) * scale) // preview px → output px
  const rnd = mulberry32(1234567)

  if (effect === 'ascii') return renderAscii(work, p, unit)
  if (effect === 'risoduo') return renderRisoDuo(work, p, unit)
  if (effect === 'cmyk') return renderCmyk(work, p, unit)
  if (effect === 'gradient') return renderGradient(work, p)

  if (effect === 'pixelate') {
    const block = Math.max(2, Math.round(unit))
    const sw = Math.max(1, Math.round(w / block))
    const sh = Math.max(1, Math.round(h / block))
    const small = document.createElement('canvas')
    small.width = sw
    small.height = sh
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    sctx.drawImage(work, 0, 0, sw, sh)
    if (p.levels >= 2) {
      const im = sctx.getImageData(0, 0, sw, sh)
      const step = 255 / (p.levels - 1)
      for (let i = 0; i < im.data.length; i++) {
        if (i % 4 === 3) continue
        im.data[i] = Math.round(im.data[i] / step) * step
      }
      sctx.putImageData(im, 0, 0)
    }
    const { canvas, ctx } = makeOut(w, h, 'transparent')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, 0, 0, w, h)
    return canvas
  }

  if (effect === 'paper') {
    const { canvas, ctx } = makeOut(w, h, 'transparent')
    ctx.drawImage(work, 0, 0)
    const im = ctx.getImageData(0, 0, w, h)
    const d = im.data
    const fiber = Math.max(1, Math.round(unit))
    const nw = Math.ceil(w / fiber)
    const noise = new Float32Array(nw * Math.ceil(h / fiber))
    for (let i = 0; i < noise.length; i++) noise[i] = rnd()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (d[i + 3] === 0) continue
        const n = noise[((y / fiber) | 0) * nw + ((x / fiber) | 0)]
        const grain = 1 - p.amount * 0.35 * (n - 0.5 + (rnd() - 0.5) * 0.5)
        // gentle vignette
        const dx = x / w - 0.5
        const dy = y / h - 0.5
        const vig = 1 - p.amount * 0.25 * (dx * dx + dy * dy) * 2
        d[i] = Math.min(255, d[i] * grain * vig)
        d[i + 1] = Math.min(255, d[i + 1] * grain * vig)
        d[i + 2] = Math.min(255, d[i + 2] * grain * vig)
      }
    }
    ctx.putImageData(im, 0, 0)
    return canvas
  }

  const g = grayOf(work)

  if (effect === 'duotone') {
    const [ir, ig2, ib] = hexToRgb(p.ink)
    const paperC = p.paper === 'transparent' ? null : hexToRgb(p.paper)
    const { canvas, ctx } = makeOut(w, h, 'transparent')
    const im = ctx.createImageData(w, h)
    const d = im.data
    for (let i = 0; i < w * h; i++) {
      const a = g.alpha[i]
      if (a < 0.02) continue
      let t = tone(g.lum[i], p.amount, !p.invert) // t = ink amount
      if (p.levels >= 2) t = Math.round(t * (p.levels - 1)) / (p.levels - 1)
      const pr = paperC ?? [255, 255, 255]
      d[i * 4] = ir * t + pr[0] * (1 - t)
      d[i * 4 + 1] = ig2 * t + pr[1] * (1 - t)
      d[i * 4 + 2] = ib * t + pr[2] * (1 - t)
      d[i * 4 + 3] = 255 * a
    }
    ctx.putImageData(im, 0, 0)
    if (p.paper !== 'transparent') {
      // composite over paper so semi-transparent edges sit on the sheet
      const { canvas: out, ctx: octx } = makeOut(w, h, p.paper)
      octx.drawImage(canvas, 0, 0)
      return out
    }
    return canvas
  }

  if (effect === 'dither' || effect === 'riso') {
    const px = Math.max(1, Math.round(effect === 'dither' ? unit : Math.max(1, unit / 3)))
    const gw = Math.ceil(w / px)
    const gh = Math.ceil(h / px)
    const gg = grid(g, px)
    const [ir, ig2, ib] = hexToRgb(p.ink)
    const { canvas, ctx } = makeOut(w, h, p.paper)
    const im = ctx.createImageData(gw, gh)
    const d = im.data
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x
        if (gg.alpha[i] < 0.12) continue
        let inkAmt: number
        if (effect === 'dither') {
          const t = tone(gg.lum[i], p.amount, p.invert)
          inkAmt = 1 - t > BAYER8[y % 8][x % 8] / 64 ? 1 : 0
        } else {
          let dark = 1 - tone(gg.lum[i], 0.15, p.invert)
          if (p.levels >= 2) dark = Math.round(dark * (p.levels - 1)) / (p.levels - 1)
          const grain = (rnd() - 0.5) * p.amount * 1.2
          inkAmt = Math.max(0, Math.min(1, dark + grain)) > 0.5 ? Math.max(0, Math.min(1, dark + grain * 0.4)) : 0
        }
        if (inkAmt <= 0.02) continue
        d[i * 4] = ir
        d[i * 4 + 1] = ig2
        d[i * 4 + 2] = ib
        d[i * 4 + 3] = 255 * inkAmt * Math.min(1, gg.alpha[i] * 1.3)
      }
    }
    const cell = document.createElement('canvas')
    cell.width = gw
    cell.height = gh
    cell.getContext('2d')!.putImageData(im, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(cell, 0, 0, gw * px, gh * px)
    return canvas
  }

  if (effect === 'stipple') {
    const cell = Math.max(2, unit)
    const gg = grid(g, cell)
    const { canvas, ctx } = makeOut(w, h, p.paper)
    ctx.fillStyle = p.ink
    for (let y = 0; y < gg.gh; y++) {
      for (let x = 0; x < gg.gw; x++) {
        const i = y * gg.gw + x
        if (gg.alpha[i] < 0.12) continue
        const dark = 1 - tone(gg.lum[i], 0.2, p.invert)
        const n = Math.round(dark * p.amount * 3.2) // dots per cell
        for (let k = 0; k < n; k++) {
          const px2 = (x + rnd()) * cell
          const py = (y + rnd()) * cell
          const r = cell * (0.1 + 0.1 * rnd() + dark * 0.1)
          ctx.globalAlpha = Math.min(1, gg.alpha[i] * 1.3)
          ctx.beginPath()
          ctx.arc(px2, py, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    ctx.globalAlpha = 1
    return canvas
  }

  if (effect === 'glyphs') {
    const RAMP = ' .·:;+=xX#@'
    const cell = Math.max(4, unit)
    const gg = grid(g, cell)
    const { canvas, ctx } = makeOut(w, h, p.paper)
    ctx.fillStyle = p.ink
    ctx.font = `${Math.round(cell * 1.05)}px ui-monospace, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let y = 0; y < gg.gh; y++) {
      for (let x = 0; x < gg.gw; x++) {
        const i = y * gg.gw + x
        if (gg.alpha[i] < 0.12) continue
        const dark = 1 - tone(gg.lum[i], 0.15, p.invert)
        const idx = Math.min(RAMP.length - 1, Math.round(dark * (RAMP.length - 1)))
        if (idx === 0) continue
        ctx.globalAlpha = Math.min(1, gg.alpha[i] * 1.3)
        ctx.fillText(RAMP[idx], (x + 0.5) * cell, (y + 0.55) * cell)
      }
    }
    ctx.globalAlpha = 1
    return canvas
  }

  if (effect === 'hatch') {
    const spacing = Math.max(2, unit)
    const { canvas, ctx } = makeOut(w, h, p.paper)
    const bands = [
      { thr: 0.82, angle: p.angle },
      { thr: 0.55, angle: p.angle + 60 },
      { thr: 0.3, angle: p.angle + 105 },
      { thr: 0.12, angle: p.angle + 30 },
    ]
    const diag = Math.sqrt(w * w + h * h)
    for (const band of bands) {
      // line field for this band
      const lines = document.createElement('canvas')
      lines.width = w
      lines.height = h
      const lctx = lines.getContext('2d')!
      lctx.strokeStyle = p.ink
      lctx.lineWidth = Math.max(0.6, spacing * 0.18 * p.amount * 2)
      lctx.save()
      lctx.translate(w / 2, h / 2)
      lctx.rotate((band.angle * Math.PI) / 180)
      lctx.beginPath()
      for (let o = -diag / 2; o <= diag / 2; o += spacing) {
        lctx.moveTo(-diag / 2, o)
        lctx.lineTo(diag / 2, o)
      }
      lctx.stroke()
      lctx.restore()
      // mask: keep lines where the image is darker than the band threshold
      const mask = document.createElement('canvas')
      mask.width = w
      mask.height = h
      const mctx = mask.getContext('2d')!
      const im = mctx.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const dark = 1 - tone(g.lum[i], 0.1, false)
        im.data[i * 4 + 3] = dark > band.thr && g.alpha[i] > 0.12 ? 255 : 0
      }
      mctx.putImageData(im, 0, 0)
      lctx.globalCompositeOperation = 'destination-in'
      lctx.drawImage(mask, 0, 0)
      ctx.drawImage(lines, 0, 0)
    }
    return canvas
  }

  return work
}

// ---------------------------------------------------------------------------
// ASCII (asciinator-style): character grid; the Editor can also export the raw text.
const ASCII_RAMP = " .`'-:_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@"

export function asciiGrid(src: HTMLCanvasElement, cellPx: number, invert: boolean): { rows: string[]; cell: number; cw: number } {
  const g = grayOf(src)
  const cell = Math.max(3, cellPx)
  const cw = cell * 0.62 // monospace advance vs line height
  const gw = Math.ceil(g.w / cw)
  const gh = Math.ceil(g.h / cell)
  const rows: string[] = []
  for (let y = 0; y < gh; y++) {
    let row = ''
    for (let x = 0; x < gw; x++) {
      let lum = 0
      let alpha = 0
      let cnt = 0
      for (let sy = Math.floor(y * cell); sy < Math.min(g.h, (y + 1) * cell); sy += 2) {
        for (let sx = Math.floor(x * cw); sx < Math.min(g.w, (x + 1) * cw); sx += 2) {
          lum += g.lum[sy * g.w + sx]
          alpha += g.alpha[sy * g.w + sx]
          cnt++
        }
      }
      lum /= cnt || 1
      alpha /= cnt || 1
      if (alpha < 0.12) {
        row += ' '
        continue
      }
      const dark = 1 - tone(lum, 0.1, invert)
      row += ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.round(dark * (ASCII_RAMP.length - 1)))]
    }
    rows.push(row)
  }
  return { rows, cell, cw }
}

function renderAscii(work: HTMLCanvasElement, p: TextureParams, cellPx: number): HTMLCanvasElement {
  const w = work.width
  const h = work.height
  const { rows, cell, cw } = asciiGrid(work, cellPx, p.invert)
  const { canvas, ctx } = makeOut(w, h, p.paper)
  ctx.font = `${Math.round(cell)}px ui-monospace, Menlo, monospace`
  ctx.textBaseline = 'top'
  let colorData: Uint8ClampedArray | null = null
  if (p.colorize) colorData = work.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  ctx.fillStyle = p.ink
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === ' ') continue
      if (colorData) {
        const px = Math.min(w - 1, Math.round((x + 0.5) * cw))
        const py = Math.min(h - 1, Math.round((y + 0.5) * cell))
        const i = (py * w + px) * 4
        ctx.fillStyle = `rgb(${colorData[i]},${colorData[i + 1]},${colorData[i + 2]})`
      }
      ctx.fillText(ch, x * cw, y * cell)
    }
  })
  return canvas
}

// ---------------------------------------------------------------------------
// Riso 2-color: shadows in ink A, midtones in ink B, grainy, with misregistration offsets.
function risoLayer(g: Gray, w: number, h: number, thrLo: number, thrHi: number, ink: string, grain: number, rnd: () => number): HTMLCanvasElement {
  const layer = document.createElement('canvas')
  layer.width = w
  layer.height = h
  const ctx = layer.getContext('2d')!
  const im = ctx.createImageData(w, h)
  const [r, g2, b] = hexToRgb(ink)
  for (let i = 0; i < w * h; i++) {
    if (g.alpha[i] < 0.1) continue
    const dark = 1 - g.lum[i]
    if (dark <= thrLo) continue
    const within = Math.min(1, (dark - thrLo) / Math.max(0.001, thrHi - thrLo))
    const a = Math.max(0, Math.min(1, within + (rnd() - 0.5) * grain * 1.6))
    if (a < 0.06) continue
    im.data[i * 4] = r
    im.data[i * 4 + 1] = g2
    im.data[i * 4 + 2] = b
    im.data[i * 4 + 3] = 255 * a * Math.min(1, g.alpha[i] * 1.2)
  }
  ctx.putImageData(im, 0, 0)
  return layer
}

function renderRisoDuo(work: HTMLCanvasElement, p: TextureParams, offsetPx: number): HTMLCanvasElement {
  const w = work.width
  const h = work.height
  const g = grayOf(work)
  const rnd = mulberry32(97531)
  const layerB = risoLayer(g, w, h, p.invert ? 0.5 : 0.1, p.invert ? 0.95 : 0.5, p.ink2, p.amount, rnd)
  const layerA = risoLayer(g, w, h, p.invert ? 0.08 : 0.45, p.invert ? 0.55 : 0.92, p.ink, p.amount, rnd)
  const { canvas, ctx } = makeOut(w, h, p.paper)
  if (p.paper !== 'transparent') ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(layerB, offsetPx * 0.7, -offsetPx * 0.4)
  ctx.drawImage(layerA, -offsetPx * 0.5, offsetPx * 0.6)
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

// ---------------------------------------------------------------------------
// CMYK halftone: four rotated dot screens (Y 0° / C 15° / M 75° / K 45°), multiply-composited.
// Screens are Screen-shaped so the halftone module can render/vectorize individual plates.
export const CMYK_CHANNELS: { ch: 'c' | 'm' | 'y' | 'k'; angle: number; color: string; name: string }[] = [
  { ch: 'y', angle: 0, color: '#ffee00', name: 'Yellow' },
  { ch: 'c', angle: 15, color: '#00aeef', name: 'Cyan' },
  { ch: 'm', angle: 75, color: '#ec008c', name: 'Magenta' },
  { ch: 'k', angle: 45, color: '#141414', name: 'Black' },
]

// cellPx is in pixels of `src` itself.
export function computeCmykScreens(src: HTMLCanvasElement, cellPx: number, gain: number): Record<'c' | 'm' | 'y' | 'k', Screen> {
  const w = src.width
  const h = src.height
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const cell = Math.max(2, cellPx)
  const out = {} as Record<'c' | 'm' | 'y' | 'k', Screen>
  for (const { ch, angle } of CMYK_CHANNELS) {
    const dots: { x: number; y: number; r: number; a: number }[] = []
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const diag = Math.sqrt(w * w + h * h)
    const cx = w / 2
    const cy = h / 2
    const steps = Math.ceil(diag / cell / 2) + 1
    const sample = Math.max(1, Math.floor(cell / 3))
    for (let gu = -steps; gu <= steps; gu++) {
      for (let gv = -steps; gv <= steps; gv++) {
        const px = cx + (gu * cos - gv * sin) * cell
        const py = cy + (gu * sin + gv * cos) * cell
        if (px < -cell || py < -cell || px > w + cell || py > h + cell) continue
        let v = 0
        let alpha = 0
        let cnt = 0
        const half = cell / 2
        for (let sy = Math.max(0, py - half) | 0; sy < Math.min(h, py + half); sy += sample) {
          for (let sx = Math.max(0, px - half) | 0; sx < Math.min(w, px + half); sx += sample) {
            const i = (sy * w + sx) * 4
            const a = d[i + 3] / 255
            const r = (d[i] / 255) * a + (1 - a)
            const g2 = (d[i + 1] / 255) * a + (1 - a)
            const b = (d[i + 2] / 255) * a + (1 - a)
            const k = 1 - Math.max(r, g2, b)
            let val: number
            if (ch === 'k') val = k
            else if (k >= 0.995) val = 0
            else if (ch === 'c') val = (1 - r - k) / (1 - k)
            else if (ch === 'm') val = (1 - g2 - k) / (1 - k)
            else val = (1 - b - k) / (1 - k)
            v += val
            alpha += a
            cnt++
          }
        }
        if (!cnt) continue
        v /= cnt
        alpha /= cnt
        if (alpha < 0.12) continue
        const r2 = (cell / 2) * gain * Math.sqrt(Math.max(0, Math.min(1, v)))
        if (r2 < cell * 0.03) continue
        dots.push({ x: px, y: py, r: r2, a: Math.min(1, alpha * 1.4) })
      }
    }
    out[ch] = { dots, width: w, height: h, cell, angle }
  }
  return out
}

function renderCmyk(work: HTMLCanvasElement, p: TextureParams, cellPx: number): HTMLCanvasElement {
  const screens = computeCmykScreens(work, cellPx, p.amount)
  const { canvas, ctx } = makeOut(work.width, work.height, p.paper === 'transparent' ? '#ffffff' : p.paper)
  ctx.globalCompositeOperation = 'multiply'
  for (const { ch, color } of CMYK_CHANNELS) {
    const plate = renderHalftoneScreen(screens[ch], { on: true, cell: 0, angle: screens[ch].angle, shape: 'dot', gain: 1, ink: color, paper: 'transparent', invert: false })
    ctx.drawImage(plate, 0, 0)
  }
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

// ---------------------------------------------------------------------------
// Gradient (photogradient-style): heavy downsample + saturation lift + smooth two-stage upscale.
function renderGradient(work: HTMLCanvasElement, p: TextureParams): HTMLCanvasElement {
  const w = work.width
  const h = work.height
  const n = Math.max(2, Math.round(p.size))
  const small = document.createElement('canvas')
  small.width = n
  small.height = Math.max(2, Math.round((n * h) / w))
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(work, 0, 0, small.width, small.height)
  const im = sctx.getImageData(0, 0, small.width, small.height)
  const sat = 1 + p.amount * 1.4
  for (let i = 0; i < im.data.length; i += 4) {
    const r = im.data[i]
    const g = im.data[i + 1]
    const b = im.data[i + 2]
    const l = 0.299 * r + 0.587 * g + 0.114 * b
    im.data[i] = Math.max(0, Math.min(255, l + (r - l) * sat))
    im.data[i + 1] = Math.max(0, Math.min(255, l + (g - l) * sat))
    im.data[i + 2] = Math.max(0, Math.min(255, l + (b - l) * sat))
  }
  sctx.putImageData(im, 0, 0)
  const mid = document.createElement('canvas')
  mid.width = small.width * 8
  mid.height = small.height * 8
  const mctx = mid.getContext('2d')!
  mctx.imageSmoothingEnabled = true
  mctx.imageSmoothingQuality = 'high'
  mctx.drawImage(small, 0, 0, mid.width, mid.height)
  const { canvas, ctx } = makeOut(w, h, 'transparent')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(mid, 0, 0, w, h)
  return canvas
}
