// Halftone core shared by the editor preview (canvas), hi-res PNG export and vector SVG export.
// The dot grid is computed once from a source canvas; renderers draw it at any scale, so a preview
// tuned at 1800px re-renders identically at print resolution or as resolution-independent vectors.
export interface HalftoneParams {
  on: boolean
  cell: number // grid pitch in PREVIEW pixels (see previewWidth)
  angle: number // degrees
  shape: 'dot' | 'line' | 'square'
  gain: number
  ink: string
  paper: string // css color or 'transparent'
  invert: boolean
}

export interface Dot {
  x: number // in source-canvas pixels
  y: number
  r: number // dot radius (or half line length / half square side), source pixels
  a: number // opacity 0..1
}

export interface Screen {
  dots: Dot[]
  width: number // source canvas dims
  height: number
  cell: number // grid pitch in source pixels
  angle: number
}

// previewWidth: the width the user tuned `cell` against; the grid is scaled so the pattern looks
// the same regardless of the source canvas resolution.
export function computeScreen(src: HTMLCanvasElement, params: HalftoneParams, previewWidth: number): Screen {
  const { angle, shape, gain, invert } = params
  const w = src.width
  const h = src.height
  const cell = params.cell * (w / previewWidth)
  const dots: Dot[] = []
  const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
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
      let lum = 0
      let alpha = 0
      let cnt = 0
      const half = cell / 2
      for (let sy = Math.max(0, py - half) | 0; sy < Math.min(h, py + half); sy += sample) {
        for (let sx = Math.max(0, px - half) | 0; sx < Math.min(w, px + half); sx += sample) {
          const i = (sy * w + sx) * 4
          const a = data[i + 3] / 255
          lum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a)
          alpha += a
          cnt++
        }
      }
      if (!cnt) continue
      lum /= cnt * 255
      alpha /= cnt
      if (alpha < 0.12) continue
      let v = 1 - lum
      if (invert) v = 1 - v
      const r = half * gain * Math.sqrt(Math.max(0, Math.min(1, v)))
      if (r < cell * 0.035) continue
      dots.push({ x: px, y: py, r, a: Math.min(1, alpha * 1.4) })
    }
  }
  void shape
  return { dots, width: w, height: h, cell, angle }
}

// Renders the screen to a canvas at `scale` × source resolution.
export function renderScreen(screen: Screen, params: HalftoneParams, scale = 1): HTMLCanvasElement {
  const w = Math.round(screen.width * scale)
  const h = Math.round(screen.height * scale)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  if (params.paper !== 'transparent') {
    ctx.fillStyle = params.paper
    ctx.fillRect(0, 0, w, h)
  }
  ctx.fillStyle = params.ink
  ctx.strokeStyle = params.ink
  const rad = (screen.angle * Math.PI) / 180
  const half = (screen.cell * scale) / 2
  for (const d of screen.dots) {
    const x = d.x * scale
    const y = d.y * scale
    const r = d.r * scale
    ctx.globalAlpha = d.a
    if (params.shape === 'dot') {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    } else if (params.shape === 'square') {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rad)
      ctx.fillRect(-r, -r, r * 2, r * 2)
      ctx.restore()
    } else {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rad)
      ctx.lineWidth = Math.min(screen.cell * scale, r * 1.6)
      ctx.beginPath()
      ctx.moveTo(-half, 0)
      ctx.lineTo(half, 0)
      ctx.stroke()
      ctx.restore()
    }
  }
  ctx.globalAlpha = 1
  return out
}

// Serializes the screen as a standalone vector SVG (resolution independent — ideal for screenprint
// separations; open in Illustrator/Inkscape). Dots become circles, squares/lines become rotated rects.
export function screenToSvg(screen: Screen, params: HalftoneParams): string {
  const { width: w, height: h, cell, angle } = screen
  const f = (n: number) => (Math.round(n * 100) / 100).toString()
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">`,
    `<!-- Open Collections halftone · cell ${f(cell)}px · ${f(angle)}° · ${params.shape} -->`,
  )
  if (params.paper !== 'transparent') parts.push(`<rect width="${f(w)}" height="${f(h)}" fill="${params.paper}"/>`)
  parts.push(`<g fill="${params.ink}">`)
  const half = cell / 2
  for (const d of screen.dots) {
    const op = d.a < 0.995 ? ` fill-opacity="${f(d.a)}"` : ''
    if (params.shape === 'dot') {
      parts.push(`<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(d.r)}"${op}/>`)
    } else if (params.shape === 'square') {
      parts.push(`<rect x="${f(-d.r)}" y="${f(-d.r)}" width="${f(d.r * 2)}" height="${f(d.r * 2)}" transform="translate(${f(d.x)} ${f(d.y)}) rotate(${f(angle)})"${op}/>`)
    } else {
      const sw = Math.min(cell, d.r * 1.6)
      parts.push(`<rect x="${f(-half)}" y="${f(-sw / 2)}" width="${f(cell)}" height="${f(sw)}" transform="translate(${f(d.x)} ${f(d.y)}) rotate(${f(angle)})"${op}/>`)
    }
  }
  parts.push('</g></svg>')
  return parts.join('\n')
}
