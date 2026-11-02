// Turning a picture into an ink mask: the shared first step of the centerline and outline engines.
// grayscale (transparent counts as paper) → optional box blur → threshold (Otsu, fixed, or
// Bradley–Roth adaptive for uneven scans) → bridge gaps (morphological closing, so dotted or
// broken scan lines read as one line) → despeckle (drop tiny ink blobs, fill tiny holes).
// A mask is one byte per pixel, 1 = ink.

export interface PrepParams {
  threshold: number // 0 = automatic (Otsu); otherwise pixels darker than this are ink (1..254)
  adaptive: boolean // local threshold against the neighbourhood mean, for uneven lighting
  invert: boolean // light lines on a dark ground
  blur: number // box-blur radius in px before thresholding (0 = off)
  bridge: number // close gaps up to about twice this many px between bits of ink (0 = off)
  despeckle: number // ink blobs and holes smaller than this many px are cleaned away
}

export interface Mask {
  w: number
  h: number
  ink: Uint8Array
}

export function grayscale(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    const lum = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]
    const a = rgba[j + 3] / 255
    g[i] = Math.round(255 - a * (255 - lum)) // composite over white paper
  }
  return g
}

function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return src
  const tmp = new Uint8Array(src.length)
  const out = new Uint8Array(src.length)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

export function otsu(g: Uint8Array): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < g.length; i++) hist[g[i]]++
  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]
  let wB = 0
  let sumB = 0
  let best = 0
  let bestT = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = g.length - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      bestT = t
    }
  }
  return bestT + 1 // ink is strictly darker than the threshold
}

// Bradley–Roth: ink where a pixel is more than 15% darker than the mean of its window.
function adaptiveInk(g: Uint8Array, w: number, h: number): Uint8Array {
  const integral = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += g[y * w + x]
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row
    }
  }
  const s = Math.max(8, Math.round(Math.min(w, h) / 8)) >> 1
  const ink = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - s)
    const y1 = Math.min(h, y + s + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - s)
      const x1 = Math.min(w, x + s + 1)
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      ink[y * w + x] = g[y * w + x] < mean * 0.85 ? 1 : 0
    }
  }
  return ink
}

// Flood-fills each connected region of `value` and clears the ones smaller than `minArea`
// (setting them to the other value). Ink uses 8-connectivity, holes 4-connectivity, so a diagonal
// line stays one stroke and the paper inside it stays one hole. Holes touching the border are
// background, never filled.
function dropSmall(m: Uint8Array, w: number, h: number, value: 0 | 1, minArea: number): void {
  const seen = new Uint8Array(m.length)
  const stack = new Int32Array(m.length)
  const region: number[] = []
  const eight = value === 1
  for (let start = 0; start < m.length; start++) {
    if (seen[start] || m[start] !== value) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    region.length = 0
    let border = false
    while (top) {
      const p = stack[--top]
      region.push(p)
      const x = p % w
      const y = (p / w) | 0
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          if (!eight && dx && dy) continue
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const q = ny * w + nx
          if (!seen[q] && m[q] === value) {
            seen[q] = 1
            stack[top++] = q
          }
        }
      }
    }
    if (region.length < minArea && !(value === 0 && border)) for (const p of region) m[p] = value ? 0 : 1
  }
}

// Square window filter of radius r: dilate (value 1) or erode (value 0). Separable; each 1-D pass
// uses a running count of `value` pixels, so a pixel becomes `value` if any lies within r of it.
function morph(m: Uint8Array, w: number, h: number, r: number, value: 0 | 1): Uint8Array {
  const pass = (src: Uint8Array, n: number, count: number, idx: (line: number, i: number) => number) => {
    const out = new Uint8Array(src.length)
    const pre = new Int32Array(n + 1)
    for (let line = 0; line < count; line++) {
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (src[idx(line, i)] === value ? 1 : 0)
      for (let i = 0; i < n; i++) out[idx(line, i)] = pre[Math.min(n, i + r + 1)] - pre[Math.max(0, i - r)] > 0 ? value : value ^ 1
    }
    return out
  }
  const rows = pass(m, w, h, (y, x) => y * w + x)
  return pass(rows, h, w, (x, y) => y * w + x)
}

export function inkMask(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, p: PrepParams): Mask {
  const g = boxBlur(grayscale(rgba, w, h), w, h, Math.round(p.blur))
  let ink: Uint8Array
  if (p.adaptive) {
    ink = adaptiveInk(g, w, h)
    if (p.invert) for (let i = 0; i < ink.length; i++) ink[i] ^= 1
  } else {
    const t = p.threshold > 0 ? p.threshold : otsu(g)
    ink = new Uint8Array(w * h)
    for (let i = 0; i < g.length; i++) ink[i] = (p.invert ? g[i] >= t : g[i] < t) ? 1 : 0
  }
  if (p.bridge > 0) {
    const r = Math.round(p.bridge)
    ink = morph(morph(ink, w, h, r, 1), w, h, r, 0)
  }
  if (p.despeckle > 0) {
    dropSmall(ink, w, h, 1, p.despeckle)
    dropSmall(ink, w, h, 0, p.despeckle)
  }
  return { w, h, ink }
}

// 1 bit per pixel, row-major, most significant bit first (what /api/vectorize expects).
export function packMask(m: Mask): Uint8Array {
  const out = new Uint8Array(Math.ceil((m.w * m.h) / 8))
  for (let i = 0; i < m.ink.length; i++) if (m.ink[i]) out[i >> 3] |= 0x80 >> (i & 7)
  return out
}

export function unpackMask(bits: Uint8Array, w: number, h: number): Mask {
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) ink[i] = (bits[i >> 3] >> (7 - (i & 7))) & 1
  return { w, h, ink }
}
