// Flatten an SVG to what is actually visible.
//
// AI vectorizers (Arrow 2 / Telos in particular) draw each object as a complete shape and stack
// them, so a ski keeps running underneath the leg that covers it and a jacket outline continues
// behind the arm. Rendered, that looks right; opened in Illustrator, cut on a plotter or used as a
// screenprint separation, all that hidden geometry is in the way. This walks the paint order from
// the top down, subtracting everything already painted above from each shape (Pathfinder ▸ Divide,
// then delete the hidden pieces), so the result is non-overlapping regions that render the same.
//
// Rules of thumb that keep the render true to the image:
//  • only opaque fills knock out what is below them; translucent fills, gradients with alpha and
//    blend modes are left stacked, since cutting under them would change the picture
//  • stroke-only shapes (lines, outlines) are left as they are: their visible area is the stroke,
//    which paper.js cannot outline, so they neither cut nor get cut
//  • a filled shape that also has a stroke loses that stroke when it is cut, otherwise the new
//    cut edges would grow outlines the image never had
//  • clipping groups are left untouched
//
// paper.js does the boolean work and is loaded on first use (~250 KB), never on page load.

export interface FlattenStats {
  shapes: number // paths considered
  cut: number // paths that lost hidden parts
  removed: number // paths entirely hidden
  ms: number
}

type Paper = typeof import('paper')
let paperPromise: Promise<Paper> | null = null
async function loadPaper(): Promise<Paper> {
  if (!paperPromise) paperPromise = import('paper').then((m: any) => (m.default ?? m) as Paper)
  return paperPromise
}

function docSize(svg: string): { w: number; h: number } {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] || ''
  const vb = root.match(/viewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)/i)
  if (vb) return { w: Math.max(1, +vb[3]), h: Math.max(1, +vb[4]) }
  const w = +(root.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1] || 0)
  const h = +(root.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1] || 0)
  return { w: w || 1024, h: h || 1024 }
}

function colorOpaque(c: any): boolean {
  if (!c) return false
  if (c.gradient) return (c.gradient.stops || []).every((s: any) => (s.color?.alpha ?? 1) >= 0.995)
  return (c.alpha ?? 1) >= 0.995
}

function insideClip(item: any): boolean {
  for (let p = item.parent; p; p = p.parent) if (p.clipped) return true
  return false
}

// paper.js cannot carry these through import → boolean ops → export; a document using them is
// returned as drawn rather than quietly losing parts of itself
const CANNOT_ROUND_TRIP = /<(text|tspan|image|use|filter|mask|pattern|marker|symbol|foreignObject)\b/i

export async function flattenSvg(svg: string, onProgress?: (done: number, total: number) => void): Promise<{ svg: string; stats: FlattenStats }> {
  if (CANNOT_ROUND_TRIP.test(svg)) return { svg, stats: { shapes: 0, cut: 0, removed: 0, ms: 0 } }
  const paper = await loadPaper()
  const t0 = performance.now()
  const scope = new paper.PaperScope()
  const { w, h } = docSize(svg)
  scope.setup(new paper.Size(w, h))
  const project = scope.project
  try {
    const root = project.importSVG(svg, { expandShapes: true, insert: true, applyMatrix: true }) as paper.Item
    if (!root) throw new Error('could not read the SVG')
    // paper wraps the document in a clip group for the viewBox; that is not the author's clipping,
    // so drop any clip that covers the whole page and keep only real clipping groups untouched
    for (const g of [root, ...root.getItems({ clipped: true })] as any[]) {
      if (!g.clipped) continue
      const mask = g.children?.find((c: any) => c.clipMask)
      if (mask && mask.bounds.contains(new paper.Rectangle(0, 0, w, h))) {
        g.clipped = false
        mask.remove()
      }
    }
    // every leaf path, in paint order (later = on top)
    const items = root.getItems({ class: paper.PathItem }).filter((it: any) => !it.clipMask && !insideClip(it)) as paper.PathItem[]
    const stats: FlattenStats = { shapes: items.length, cut: 0, removed: 0, ms: 0 }
    let covered: paper.PathItem | null = null
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i] as any
      // lines and other open strokes carry the SVG default black fill but no area: not filled
      const filled = !!item.fillColor && (item.fillColor.alpha ?? 1) > 0 && Math.abs(item.area || 0) > 0.01
      const stroked = !!item.strokeColor && (item.strokeWidth ?? 1) > 0 && (item.strokeColor.alpha ?? 1) > 0
      if (!filled) continue // stroke-only or invisible: leave it, and it covers nothing
      if (item.closed === false && !(item instanceof paper.CompoundPath)) item.closed = true // an open filled path paints as if closed
      const opaque = colorOpaque(item.fillColor) && (item.opacity ?? 1) >= 0.995 && (item.fillColor?.alpha ?? 1) >= 0.995 && (!item.blendMode || item.blendMode === 'normal')
      if (covered) {
        const visible = item.subtract(covered, { insert: false }) as any
        const before = Math.abs(item.area)
        const after = Math.abs(visible?.area ?? 0)
        if (!visible || after < 0.01 || (visible.isEmpty && visible.isEmpty())) {
          // fully hidden: drop it; its area is already inside the cover
          stats.removed++
          item.remove()
          visible?.remove()
          continue
        }
        if (before - after > 0.01) {
          stats.cut++
          visible.copyAttributes(item, false)
          visible.fillColor = item.fillColor
          visible.opacity = item.opacity
          visible.blendMode = item.blendMode
          visible.fillRule = item.fillRule
          if (stroked) visible.strokeColor = null // no outlines along cut edges
          visible.insertAbove(item)
          item.remove()
          items[i] = visible
          if (opaque) {
            const next = covered.unite(visible, { insert: false })
            covered.remove()
            covered = next as paper.PathItem
          }
        } else {
          visible.remove()
          if (opaque) {
            const next = covered.unite(item, { insert: false })
            covered.remove()
            covered = next as paper.PathItem
          }
        }
      } else if (opaque) {
        covered = item.clone({ insert: false }) as paper.PathItem
      }
      if (onProgress && (i & 15) === 0) {
        onProgress(items.length - i, items.length)
        await new Promise((r) => setTimeout(r, 0)) // let the page paint the progress
      }
    }
    covered?.remove()
    const out = project.exportSVG({ asString: true, bounds: 'view', precision: 3 }) as string
    stats.ms = Math.round(performance.now() - t0)
    return { svg: out, stats }
  } finally {
    project.remove()
  }
}
