// Riso v3: a fresh take on risograph printing, separate from the earlier riso effects.
//
// What a real riso does, and what this copies:
//  • Each ink is its own pass through the machine. A master is burned per colour and the ink
//    pushed through it, so the image is a set of spot-colour separations, not RGB. Here the
//    picture is separated into up to four inks by solving, per colour, how much of each ink
//    multiplied over paper reproduces it (a small non-negative least-squares fit, cached in a LUT).
//  • The stencil gives a soft, stochastic dot texture, not pixel noise. A blue-noise threshold
//    tile (void-and-cluster style) screens each separation; the grain slider sets the dot size,
//    the texture slider how soft and uneven the dots are.
//  • Inks are translucent and multiply where they overlap; the drum never inks perfectly evenly,
//    so each layer carries a slow density drift and faint streaks along the feed direction.
//  • Every pass registers a little differently: each ink gets its own offset and a touch of
//    rotation, growing with the misregistration slider.
// Everything is deterministic and scale-aware, so the print export matches the preview.

import type { TextureParams } from './textures'

const TILE = 64
let tileCache: Float32Array | null = null

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

// Blue-noise threshold tile: points are placed one at a time at the largest void (lowest
// Gaussian energy), and each point's rank becomes its threshold. Tiles seamlessly.
function blueNoiseTile(): Float32Array {
  if (tileCache) return tileCache
  const N = TILE * TILE
  const R = 6
  const sigma = 1.9
  const kern: number[] = []
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kern.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)))
  const rnd = mulberry32(7)
  const energy = new Float32Array(N)
  for (let i = 0; i < N; i++) energy[i] = rnd() * 1e-4 // tie-break
  const placed = new Uint8Array(N)
  const rank = new Float32Array(N)
  let idx = Math.floor(rnd() * N)
  for (let n = 0; n < N; n++) {
    placed[idx] = 1
    rank[idx] = (n + 0.5) / N
    const px = idx % TILE
    const py = (idx / TILE) | 0
    let k = 0
    for (let dy = -R; dy <= R; dy++) {
      const y = (py + dy + TILE) % TILE
      for (let dx = -R; dx <= R; dx++) {
        const x = (px + dx + TILE) % TILE
        energy[y * TILE + x] += kern[k++]
      }
    }
    let best = -1
    let bv = Infinity
    for (let i = 0; i < N; i++) {
      if (!placed[i] && energy[i] < bv) {
        bv = energy[i]
        best = i
      }
    }
    if (best < 0) break
    idx = best
  }
  tileCache = rank
  return rank
}

export const LUT_N = 33 // quantization per RGB channel for the separation lookup

// For every quantized colour, how much of each ink (0..255) reproduces it when the inks multiply
// over white. Exact 1-D minimization per ink, swept a few times (coordinate descent).
export function separationLut(inks: [number, number, number][]): Uint8Array {
  const n = inks.length
  const I = inks.map(([r, g, b]) => [r / 255, g / 255, b / 255])
  const lut = new Uint8Array(LUT_N * LUT_N * LUT_N * n)
  const d = new Float64Array(n)
  const A = [0, 0, 0]
  const B = [0, 0, 0]
  for (let ri = 0; ri < LUT_N; ri++)
    for (let gi = 0; gi < LUT_N; gi++)
      for (let bi = 0; bi < LUT_N; bi++) {
        const T = [ri / (LUT_N - 1), gi / (LUT_N - 1), bi / (LUT_N - 1)]
        d.fill(0)
        for (let sweep = 0; sweep < 14; sweep++) {
          for (let i = 0; i < n; i++) {
            // f_c = A_c · (1 − d_i·(1 − I_ic)) where A_c is the product of the other inks
            for (let c = 0; c < 3; c++) {
              let a = 1
              for (let j = 0; j < n; j++) if (j !== i) a *= 1 - d[j] * (1 - I[j][c])
              A[c] = a
              B[c] = a * (1 - I[i][c])
            }
            let num = 0
            let den = 1e-6
            for (let c = 0; c < 3; c++) {
              num += B[c] * (A[c] - T[c])
              den += B[c] * B[c]
            }
            d[i] = Math.max(0, Math.min(1, num / den))
          }
        }
        const base = ((ri * LUT_N + gi) * LUT_N + bi) * n
        for (let i = 0; i < n; i++) lut[base + i] = Math.round(d[i] * 255)
      }
  return lut
}

const lutCache = new Map<string, Uint8Array>()

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function lumOf([r, g, b]: [number, number, number]) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// unit: grain size in output pixels (the size slider, scale-aware). p.angle: misregistration in
// preview pixels; p.levels: number of inks; p.amount: texture strength.
export function renderRiso3(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const w = work.width
  const h = work.height
  const src = work.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const n = Math.max(1, Math.min(4, Math.round(p.levels)))
  const inkHex = [p.ink, p.ink2, p.ink3, p.ink4].slice(0, n)
  const inks = inkHex.map(hexToRgb)
  const key = inkHex.join(',')
  let lut = lutCache.get(key)
  if (!lut) {
    lut = separationLut(inks)
    lutCache.set(key, lut)
  }
  const tile = blueNoiseTile()
  const grainPx = Math.max(1, unit)
  const texture = Math.max(0, Math.min(1, p.amount))
  const outScale = unit / Math.max(0.5, p.size) // output px per preview px
  const misreg = Math.max(0, p.angle) * outScale
  const soft = 0.05 + 0.16 * texture // half-width of the soft dot edge in density units
  const inkOpacity = 0.9 - 0.08 * texture // riso ink is a little translucent

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  const transparent = p.paper === 'transparent'
  if (!transparent) {
    ctx.fillStyle = p.paper
    ctx.fillRect(0, 0, w, h)
  }
  ctx.globalCompositeOperation = transparent ? 'source-over' : 'multiply'

  // per-pixel lookups shared by all inks
  const qi = new Uint32Array(w * h) // LUT base index per pixel, or 0xffffffff for clear pixels
  const cover = new Float32Array(w * h) // source alpha
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3] / 255
    cover[i] = a
    if (a < 0.04) {
      qi[i] = 0xffffffff
      continue
    }
    // composite over white, then quantize
    const r = Math.round((((src[i * 4] / 255) * a + (1 - a)) * (LUT_N - 1)))
    const g = Math.round((((src[i * 4 + 1] / 255) * a + (1 - a)) * (LUT_N - 1)))
    const b = Math.round((((src[i * 4 + 2] / 255) * a + (1 - a)) * (LUT_N - 1)))
    qi[i] = ((r * LUT_N + g) * LUT_N + b) * n
  }

  // lightest ink first, the way a print shop would run the drums
  const order = inks.map((c, i) => ({ i, l: lumOf(c) })).sort((a, b) => b.l - a.l).map((o) => o.i)
  const rnd = mulberry32(31337)
  for (const i of order) {
    const [ir, ig, ib] = inks[i]
    // this pass's registration and inking character
    const ox = (rnd() - 0.5) * 2 * misreg
    const oy = (rnd() - 0.5) * 2 * misreg
    const rot = ((rnd() - 0.5) * misreg * 0.0007) // radians; a few px of misregistration → ~0.2°
    const ph1 = rnd() * Math.PI * 2
    const ph2 = rnd() * Math.PI * 2
    const ph3 = rnd() * Math.PI * 2
    const f1 = (Math.PI * 2 * (1.5 + rnd())) / Math.max(w, h)
    const f2 = (Math.PI * 2 * (1.5 + rnd())) / Math.max(w, h)
    const fs = (Math.PI * 2 * 38) / w // faint streaks across the sheet
    const drift = 0.14 * texture
    const streak = 0.05 * texture
    const dropout = 0.06 * texture

    const layer = document.createElement('canvas')
    layer.width = w
    layer.height = h
    const lctx = layer.getContext('2d')!
    const im = lctx.createImageData(w, h)
    const d = im.data
    for (let y = 0; y < h; y++) {
      const ty = ((y / grainPx) | 0) % TILE
      const rowDrift = Math.sin(y * f2 + ph2)
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        const base = qi[idx]
        if (base === 0xffffffff) continue
        let dens = lut[base + i] / 255
        if (dens <= 0.004) continue
        // uneven inking: slow drift plus streaks (a full solid stays a solid)
        const solid = dens >= 0.96
        if (!solid) dens *= 1 + drift * Math.sin(x * f1 + ph1) * rowDrift + streak * Math.sin(x * fs + ph3)
        const tx = ((x / grainPx) | 0) % TILE
        const thr = tile[ty * TILE + tx]
        // the soft edge is folded into the density scale so full density clears every threshold
        let cov = smooth(thr - soft, thr + soft, dens * (1 + soft))
        if (cov <= 0.01) continue
        if (dropout > 0 && !solid) {
          // the odd dot that did not take: cheap hash on the grain cell
          const hx = ((x / grainPx) | 0) * 374761393 + ((y / grainPx) | 0) * 668265263 + i * 1013904223
          const hv = ((hx ^ (hx >>> 13)) * 1274126177) >>> 0
          if ((hv & 1023) / 1024 < dropout) cov *= 0.35
        }
        const o = idx * 4
        d[o] = ir
        d[o + 1] = ig
        d[o + 2] = ib
        d[o + 3] = 255 * cov * inkOpacity * Math.min(1, cover[idx] * 1.15)
      }
    }
    lctx.putImageData(im, 0, 0)
    ctx.save()
    ctx.translate(w / 2 + ox, h / 2 + oy)
    ctx.rotate(rot)
    ctx.translate(-w / 2, -h / 2)
    ctx.drawImage(layer, 0, 0)
    ctx.restore()
  }
  ctx.globalCompositeOperation = 'source-over'
  return out
}
