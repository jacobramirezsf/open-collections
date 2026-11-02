// Finishing touches shared by every engine's SVG: a clean root element with a viewBox, an optional
// physical size (so a plotter, cutter or embroidery program opens it at the intended size), an
// optional outlines-only version of filled shapes (for pens, lasers and knives), and stats.

// Rewrites the root <svg> to just xmlns + viewBox + width/height, dropping XML prologs, doctypes
// and generator comments. `w`×`h` is the traced bitmap size (the coordinate space of the paths).
export function normalizeRoot(svg: string, w: number, h: number, widthMm: number): string {
  const body = svg
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim()
  const size = widthMm > 0 ? `width="${fmt(widthMm)}mm" height="${fmt((widthMm * h) / w)}mm"` : `width="${w}" height="${h}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ${size}>\n${body}\n</svg>\n`
}

// Filled shapes become hairline outlines in their own colour. The stroke ignores transforms
// (Potrace draws at 10x with a scale), so it stays one unit wide in the viewer.
export function outlinesOnly(svg: string): string {
  return svg
    .replace(/\sstroke="none"/g, '')
    .replace(/\sfill="(?!none)([^"]+)"/g, ' fill="none" stroke="$1" stroke-width="1" vector-effect="non-scaling-stroke"')
}

export interface SvgStats {
  paths: number
  points: number // path commands, a rough node count
  bytes: number
}

export function svgStats(svg: string): SvgStats {
  let points = 0
  for (const m of svg.matchAll(/\sd="([^"]*)"/g)) points += (m[1].match(/[MLCQSTAHVZmlcqstahvz]/g) || []).length
  return { paths: (svg.match(/<path\b/g) || []).length, points, bytes: new Blob([svg]).size }
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()
