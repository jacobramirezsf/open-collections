// Texture effects for the editor: classic print/analog techniques (ordered + error-diffusion
// dithering, riso-style grain, stippling, glyph mosaics, crosshatch, duotone/cyanotype, pixelate,
// paper grain) implemented scale-aware so the tuned preview re-renders identically at print
// resolution. All pure canvas; transparent pixels (remove.bg cutouts) are respected.

export type EffectKind = 'halftone' | 'dither' | 'riso' | 'stipple' | 'glyphs' | 'hatch' | 'duotone' | 'pixelate' | 'paper'

export interface TextureParams {
  size: number // cell/block/spacing in preview px
  amount: number // 0..1 intensity/strength
  levels: number // posterize levels where relevant
  angle: number
  ink: string
  paper: string // css color or 'transparent'
  invert: boolean
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
  colors: ('ink' | 'paper')[]
  invert?: boolean
  defaults: Partial<TextureParams>
}

export const TEXTURE_DEFAULTS: TextureParams = { size: 6, amount: 0.7, levels: 4, angle: 22, ink: '#141414', paper: '#f3f1e8', invert: false }

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
