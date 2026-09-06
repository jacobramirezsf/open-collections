// Text as canvas artwork: the same effects that run on a found image run on lettering too, so a
// caption can be halftoned, riso'd or stitched alongside the art it sits next to.
import { TEXTURE_DEFAULTS, applyTexture, type EffectKind, type TextureParams } from './textures'
import { computeScreen, renderScreen } from './halftone'

export interface FontDef {
  css: string // font-family stack
  label: string
  weights: number[]
}

export const FONTS: FontDef[] = [
  { css: "'Playfair Display', serif", label: 'Playfair Display', weights: [400, 700, 900] },
  { css: "'DM Serif Display', serif", label: 'DM Serif Display', weights: [400] },
  { css: "'Libre Baskerville', serif", label: 'Libre Baskerville', weights: [400, 700] },
  { css: "'Cormorant Garamond', serif", label: 'Cormorant Garamond', weights: [400, 700] },
  { css: "'Archivo Black', sans-serif", label: 'Archivo Black', weights: [400] },
  { css: "'Anton', sans-serif", label: 'Anton', weights: [400] },
  { css: "'Bebas Neue', sans-serif", label: 'Bebas Neue', weights: [400] },
  { css: "'Rubik Mono One', monospace", label: 'Rubik Mono One', weights: [400] },
  { css: "'Space Mono', monospace", label: 'Space Mono', weights: [400, 700] },
  { css: "'Caveat', cursive", label: 'Caveat', weights: [400, 700] },
  { css: 'Georgia, serif', label: 'Georgia', weights: [400, 700] },
  { css: 'Helvetica, Arial, sans-serif', label: 'Helvetica', weights: [400, 700] },
]

export type TextShape = 'straight' | 'arch' | 'valley' | 'circle' | 'stack'

export const TEXT_SHAPES: { key: TextShape; label: string }[] = [
  { key: 'straight', label: 'Straight' },
  { key: 'arch', label: 'Arch' },
  { key: 'valley', label: 'Valley' },
  { key: 'circle', label: 'Circle' },
  { key: 'stack', label: 'Stack' },
]

export interface TextProps {
  value: string
  font: string
  weight: number
  color: string
  italic: boolean
  align: 'left' | 'center' | 'right'
  tracking: number // em
  leading: number // multiple of font size
  shape: TextShape
  curve: number // 0..1, how hard an arch or valley bends
  effect?: EffectKind | 'none'
}

export const TEXT_DEFAULTS: TextProps = {
  value: 'Open Collections',
  font: FONTS[0].css,
  weight: 700,
  color: '#141414',
  italic: false,
  align: 'center',
  tracking: 0,
  leading: 1.12,
  shape: 'straight',
  curve: 0.45,
  effect: 'none',
}

const FONT_PX = 200 // render size; the piece is scaled on the canvas, so this is just fidelity

export async function renderTextPiece(p: TextProps): Promise<HTMLCanvasElement> {
  // wait for the webfont, otherwise the first render silently falls back to a system face
  const spec = `${p.italic ? 'italic ' : ''}${p.weight} ${FONT_PX}px ${p.font}`
  try {
    await document.fonts.load(spec, p.value || 'A')
    await document.fonts.ready
  } catch {
    /* fall through to whatever is available */
  }
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = spec
  if ('letterSpacing' in measure) (measure as any).letterSpacing = `${p.tracking}em`

  const draw = (ctx: CanvasRenderingContext2D, cx: number, cy: number) => {
    ctx.font = spec
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${p.tracking}em`
    ctx.fillStyle = p.color
    ctx.textBaseline = 'middle'
    const lineH = FONT_PX * p.leading

    if (p.shape === 'stack') {
      // each word on its own line, stretched to a common width: a stacked lockup
      const words = p.value.split(/\s+/).filter(Boolean)
      const widths = words.map((w) => measure.measureText(w).width)
      const target = Math.max(1, ...widths)
      ctx.textAlign = 'center'
      const top = cy - (lineH * words.length) / 2
      words.forEach((w, i) => {
        ctx.save()
        ctx.translate(cx, top + lineH * (i + 0.5))
        ctx.scale(target / Math.max(1, widths[i]), 1)
        ctx.fillText(w, 0, 0)
        ctx.restore()
      })
      return
    }

    if (p.shape === 'straight') {
      const lines = (p.value || ' ').split('\n')
      ctx.textAlign = p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left'
      const widths = lines.map((l) => measure.measureText(l || ' ').width)
      const maxW = Math.max(1, ...widths)
      const x = p.align === 'center' ? cx : p.align === 'right' ? cx + maxW / 2 : cx - maxW / 2
      const top = cy - (lineH * lines.length) / 2
      lines.forEach((l, i) => ctx.fillText(l, x, top + lineH * (i + 0.5)))
      return
    }

    // curved: place each glyph explicitly on a circle. An arch bows up with the centre of
    // curvature below; a valley bows down with the centre above and the glyphs kept upright.
    const text = p.value.replace(/\n/g, ' ')
    const chars = [...text]
    const advances = chars.map((c) => measure.measureText(c).width)
    const total = advances.reduce((a, b) => a + b, 0)
    const full = p.shape === 'circle'
    const sweep = full ? Math.PI * 2 : Math.max(0.15, p.curve) * Math.PI * 1.25
    const R = total / sweep
    ctx.textAlign = 'center'
    let angle = -sweep / 2
    chars.forEach((ch, i) => {
      const a = angle + advances[i] / (2 * R)
      let px: number
      let py: number
      let rot: number
      if (p.shape === 'valley') {
        px = cx + R * Math.sin(a)
        py = cy - R + R * Math.cos(a)
        rot = -a
      } else {
        // arch, and the full ring, both curve around a centre below the middle of the line
        px = cx + R * Math.sin(a)
        py = cy + R - R * Math.cos(a)
        rot = a
      }
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(rot)
      ctx.fillText(ch, 0, 0)
      ctx.restore()
      angle += advances[i] / R
    })
  }

  // draw onto a generous canvas, then trim to what was actually inked: this keeps every shape
  // tight without working out its bounding box analytically
  const big = document.createElement('canvas')
  const est = Math.max(measure.measureText(p.value.replace(/\n/g, ' ')).width, FONT_PX * 4)
  big.width = Math.ceil(est * 1.6 + FONT_PX * 4)
  big.height = Math.ceil(est * 1.6 + FONT_PX * 4)
  const bctx = big.getContext('2d', { willReadFrequently: true })!
  draw(bctx, big.width / 2, big.height / 2)
  const data = bctx.getImageData(0, 0, big.width, big.height).data
  let x0 = big.width, y0 = big.height, x1 = 0, y1 = 0
  for (let y = 0; y < big.height; y++) {
    for (let x = 0; x < big.width; x++) {
      if (data[(y * big.width + x) * 4 + 3] > 4) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < x0 || y1 < y0) {
    x0 = 0; y0 = 0; x1 = 1; y1 = 1
  }
  const pad = Math.round(FONT_PX * 0.16)
  const c = document.createElement('canvas')
  c.width = x1 - x0 + 1 + pad * 2
  c.height = y1 - y0 + 1 + pad * 2
  c.getContext('2d')!.drawImage(big, x0 - pad, y0 - pad, c.width, c.height, 0, 0, c.width, c.height)

  if (p.effect && p.effect !== 'none') {
    if (p.effect === 'halftone') {
      // halftone lives in its own module rather than the shared texture table
      const ht = { on: true, cell: 10, angle: 22, shape: 'dot' as const, gain: 1.15, ink: p.color, paper: 'transparent', invert: false }
      return renderScreen(computeScreen(c, ht, c.width), ht)
    }
    const params: TextureParams = { ...TEXTURE_DEFAULTS, paper: 'transparent', ink: p.color }
    return applyTexture(p.effect, c, params, c.width, 1)
  }
  return c
}
