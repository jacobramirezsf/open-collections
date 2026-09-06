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

export interface TextProps {
  value: string
  font: string
  weight: number
  color: string
  italic: boolean
  align: 'left' | 'center' | 'right'
  tracking: number // em
  leading: number // multiple of font size
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
  const lines = (p.value || ' ').split('\n')
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = spec
  if ('letterSpacing' in measure) (measure as any).letterSpacing = `${p.tracking}em`
  const widths = lines.map((l) => measure.measureText(l || ' ').width)
  const textW = Math.max(1, ...widths)
  const lineH = FONT_PX * p.leading
  const pad = FONT_PX * 0.22
  const c = document.createElement('canvas')
  c.width = Math.ceil(textW + pad * 2)
  c.height = Math.ceil(lineH * lines.length + pad * 2)
  const ctx = c.getContext('2d')!
  ctx.font = spec
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${p.tracking}em`
  ctx.fillStyle = p.color
  ctx.textBaseline = 'middle'
  ctx.textAlign = p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left'
  const x = p.align === 'center' ? c.width / 2 : p.align === 'right' ? c.width - pad : pad
  lines.forEach((l, i) => ctx.fillText(l, x, pad + lineH * (i + 0.5)))
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
