// Letterpress emulator: relief printing, where inked type or a plate is pressed into the paper.
//
// Three things give it away, and all three are here:
//  • The impression. The printed area is pushed below the surface, so its walls catch the light:
//    the wall facing the light is bright, the one facing away is in shadow, and the floor of the
//    bite sits a touch darker. Depth sets how wide and deep the bite reads; the light angle turns
//    it. The impression is present even where the ink is thin, which is why deep-impression work
//    reads as physical.
//  • Ink squash. Pressure pushes the ink outwards, so each shape has a denser rim and a slight
//    halo just past its edge, while the middle of a large solid is starved and mottled.
//  • Coverage. Letterpress ink sits on the paper's surface, so the sheet's texture shows through
//    as a salty, uneven tone rather than a flat fill; the coverage slider goes from a dry, open
//    print to a heavy, near-solid one.
// The image is reduced to printed/not printed (relief printing has no tone of its own), with a
// soft threshold so anti-aliased edges survive. Works with cutouts: unprinted paper shows through.

import type { TextureParams } from './textures'
import { blur, hexToRgb, mottle, smooth } from './fx'

// unit: impression depth in output px (size slider, scale-aware). amount: coverage 0..1.
// levels: squash 0..10. angle: light direction in degrees. invert: print the light areas.
export function renderLetterpress(work: HTMLCanvasElement, p: TextureParams, unit: number): HTMLCanvasElement {
  const w = work.width
  const h = work.height
  const src = work.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const depth = Math.max(1, unit)
  const coverage = Math.max(0, Math.min(1, p.amount))
  const squash = Math.max(0, Math.min(1, p.levels / 10))
  const light = (p.angle * Math.PI) / 180
  const lx = Math.cos(light)
  const ly = Math.sin(light)
  const [ir, ig, ib] = hexToRgb(p.ink)
  const transparent = p.paper === 'transparent'
  const [pr, pg, pb] = transparent ? [255, 255, 255] : hexToRgb(p.paper)

  // 1. what gets printed: a soft threshold on darkness (relief printing has no tone of its own)
  const M = new Float32Array(w * h)
  const alpha = new Float32Array(w * h)
  const thr = 0.62 - 0.34 * coverage // heavy coverage inks more of the midtones
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3] / 255
    alpha[i] = a
    if (a < 0.04) continue
    const lum = ((0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255) * a + (1 - a)
    const dark = p.invert ? lum : 1 - lum
    M[i] = smooth(thr - 0.07, thr + 0.07, dark) * Math.min(1, a * 1.2)
  }

  // 2. the bite: a blurred copy of the mask is the pressed relief; its gradient lights the walls
  const relief = blur(M, w, h, depth * 0.9)
  // 3. ink squash: the rim just inside the edge is denser, the middle of solids starved
  const inner = blur(M, w, h, Math.max(1, depth * 0.6))
  // 4. paper texture and the salty, uneven coverage of surface ink
  const grain = mottle(w, h, Math.max(2, depth * 1.6), 4242)
  const fine = mottle(w, h, Math.max(1.2, depth * 0.55), 99)

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  const im = ctx.createImageData(w, h)
  const d = im.data
  const bevel = 0.55 + 0.25 * Math.min(1, depth / 6) // how strongly the walls read
  const floor = 0.06 // the bottom of the impression sits a little darker
  const halo = 0.12 * squash // a faint ring of squeezed ink outside the edge
  const dry = 1 - coverage // how open and salty the ink is

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      // gradient of the relief (central differences), towards the inside of the shape
      const gx = (relief[Math.min(w - 1, x + 1) + y * w] - relief[Math.max(0, x - 1) + y * w]) * 0.5
      const gy = (relief[x + Math.min(h - 1, y + 1) * w] - relief[x + Math.max(0, y - 1) * w]) * 0.5
      // wall facing the light is bright, the one facing away is dark; scale by depth so the
      // bevel width, not just its slope, sets the look
      const slope = -(gx * lx + gy * ly) * depth * 2.2
      // the shadowed wall reads more than the lit one: paper is already near white
      let shade = (slope < 0 ? Math.max(-0.42, slope * bevel) : Math.min(0.22, slope * bevel * 0.55)) - floor * relief[i]
      // paper tooth, subtle
      shade += (grain[i] - 0.5) * 0.05

      // ink density: mask, with the rim denser than the middle and a halo just outside
      const m = M[i]
      const rim = Math.max(0, m - inner[i]) // high just inside the edge
      const outside = Math.max(0, inner[i] - m) // just outside the edge
      let ink = m * (1 - 0.32 * squash * Math.max(0, inner[i] - rim) * dry) + rim * 0.5 * squash + outside * halo
      // salty coverage: the paper shows through where the ink did not take
      const salt = grain[i] * 0.6 + fine[i] * 0.4
      ink *= 1 - dry * 0.6 * Math.max(0, salt - 0.42) - 0.04 * dry
      ink = Math.max(0, Math.min(1, ink))

      const o = i * 4
      if (transparent) {
        // no sheet to press into: ink only, with its squash and coverage
        d[o] = ir
        d[o + 1] = ig
        d[o + 2] = ib
        d[o + 3] = 255 * ink
        continue
      }
      // paper, lit by the impression, then ink multiplied over it (ink is a little translucent)
      const lit = 1 + shade
      const ipr = pr * lit
      const ipg = pg * lit
      const ipb = pb * lit
      const k = ink * 0.97
      d[o] = ipr * (1 - k * (1 - ir / 255))
      d[o + 1] = ipg * (1 - k * (1 - ig / 255))
      d[o + 2] = ipb * (1 - k * (1 - ib / 255))
      d[o + 3] = 255
    }
  }
  ctx.putImageData(im, 0, 0)
  void alpha
  return out
}
