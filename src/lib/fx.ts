// Small image-math helpers shared by the print and photographic process emulations
// (letterpress, the alternative-process tools). Pure functions, deterministic where seeded.

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  const v = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const mix = (a: number, b: number, t: number) => a + (b - a) * t

// three passes of a box blur ≈ Gaussian; separable
export function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  let a = Float32Array.from(src)
  const b = new Float32Array(w * h)
  const rad = Math.max(1, Math.round(r))
  const norm = 1 / (2 * rad + 1)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w
      let acc = 0
      for (let x = -rad; x <= rad; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * norm
        acc += a[row + Math.min(w - 1, x + rad + 1)] - a[row + Math.max(0, x - rad)]
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -rad; y <= rad; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * norm
        acc += b[Math.min(h - 1, y + rad + 1) * w + x] - b[Math.max(0, y - rad) * w + x]
      }
    }
  }
  return a
}

// soft random field 0..1: a coarse random grid scaled up with the canvas's own smoothing.
// `stretch` > 1 elongates the cells horizontally (fibres, brush strokes, pour marks).
export function mottle(w: number, h: number, cellPx: number, seed: number, stretch = 1): Float32Array {
  const cw = Math.max(2, Math.round(w / (cellPx * stretch)))
  const ch = Math.max(2, Math.round(h / cellPx))
  const small = document.createElement('canvas')
  small.width = cw
  small.height = ch
  const sctx = small.getContext('2d')!
  const im = sctx.createImageData(cw, ch)
  const rnd = mulberry32(seed)
  for (let i = 0; i < cw * ch; i++) {
    const v = Math.round(rnd() * 255)
    im.data[i * 4] = v
    im.data[i * 4 + 1] = v
    im.data[i * 4 + 2] = v
    im.data[i * 4 + 3] = 255
  }
  sctx.putImageData(im, 0, 0)
  const big = document.createElement('canvas')
  big.width = w
  big.height = h
  const bctx = big.getContext('2d', { willReadFrequently: true })!
  bctx.imageSmoothingEnabled = true
  bctx.imageSmoothingQuality = 'high'
  bctx.drawImage(small, 0, 0, w, h)
  const d = bctx.getImageData(0, 0, w, h).data
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4] / 255
  return out
}

// luminance 0..1 of a source, composited over white, with a choice of spectral response:
// 'pan' is the usual eye-weighted mix; 'ortho' is what blue-sensitive emulsions (collodion,
// early papers, cyanotype) see: skies white, reds and warm skin dark.
export function luminance(src: HTMLCanvasElement, response: 'pan' | 'ortho' = 'pan'): { w: number; h: number; lum: Float32Array; alpha: Float32Array; rgb: Uint8ClampedArray } {
  const w = src.width
  const h = src.height
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const lum = new Float32Array(w * h)
  const alpha = new Float32Array(w * h)
  const [wr, wg, wb] = response === 'ortho' ? [0.08, 0.32, 0.6] : [0.299, 0.587, 0.114]
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3] / 255
    alpha[i] = a
    lum[i] = ((wr * d[i * 4] + wg * d[i * 4 + 1] + wb * d[i * 4 + 2]) / 255) * a + (1 - a)
  }
  return { w, h, lum, alpha, rgb: d }
}

// An irregularly coated area, the way a sensitizer goes on with a brush: a rectangle inset by
// `inset` px whose edges wobble, with the brush overshooting here and there. 1 inside, 0 outside,
// soft over a few px. `strokes` in px sets how far the coating wanders.
export function brushedArea(w: number, h: number, inset: number, wander: number, seed: number): Float32Array {
  const out = new Float32Array(w * h)
  if (inset <= 0 && wander <= 0) {
    out.fill(1)
    return out
  }
  const rnd = mulberry32(seed)
  // 1-D wobble per edge, smooth: a few sines with random phases plus a coarse random walk
  const wob = (n: number, len: number) => {
    const arr = new Float32Array(len)
    const k1 = (Math.PI * 2 * (2 + rnd() * 3)) / len
    const k2 = (Math.PI * 2 * (7 + rnd() * 6)) / len
    const p1 = rnd() * 6.28
    const p2 = rnd() * 6.28
    let walk = 0
    for (let i = 0; i < len; i++) {
      walk += (rnd() - 0.5) * 0.3
      walk *= 0.985
      arr[i] = (Math.sin(i * k1 + p1) * 0.6 + Math.sin(i * k2 + p2) * 0.3 + walk * 0.35) * n
    }
    return arr
  }
  const top = wob(wander, w)
  const bottom = wob(wander, w)
  const left = wob(wander, h)
  const right = wob(wander, h)
  // a handful of brush overshoots: short strokes that run past the edge
  const strokes: { x: number; y: number; len: number; th: number; horiz: boolean }[] = []
  const nStrokes = Math.round(4 + rnd() * 6)
  for (let i = 0; i < nStrokes; i++) {
    const side = rnd()
    const horiz = side < 0.5
    strokes.push({
      x: horiz ? rnd() * w : side < 0.75 ? inset : w - inset,
      y: horiz ? (side < 0.25 ? inset : h - inset) : rnd() * h,
      len: (0.5 + rnd()) * Math.max(16, wander * 1.6),
      th: 2 + rnd() * Math.max(3, wander * 0.25),
      horiz,
    })
  }
  const soft = Math.max(1.5, wander * 0.08)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dl = x - (inset + left[y])
      const dr = w - inset + right[y] - x
      const dt = y - (inset + top[x])
      const db = h - inset + bottom[x] - y
      let d = Math.min(dl, dr, dt, db)
      for (const s of strokes) {
        // the stroke extends the coated area outward along its length
        const along = s.horiz ? x - s.x : y - s.y
        const across = s.horiz ? y - s.y : x - s.x
        if (Math.abs(along) < s.len && Math.abs(across) < s.th) d = Math.max(d, s.th - Math.abs(across) - Math.abs(along) / s.len * s.th)
      }
      out[y * w + x] = smooth(-soft, soft, d)
    }
  }
  return out
}

// blend two RGB colours (0..255 tuples) by t
export function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
