// Real surfaces (curated from the studio's Background Assets folder, served optimized from
// /public/paper). Selected as an editor "Surface": the sheet becomes the page and the effect
// output is multiplied over it like ink on stock.
//
// `edge` sheets are cutouts with a real deckle / torn / pinked edge (webp with alpha): the
// artwork is printed inside the sheet and the output keeps the sheet's silhouette, transparent
// around the edge.
export interface PaperSheet {
  slug: string
  label: string
  group: 'paper' | 'edge' | 'fabric'
  ext?: 'jpg' | 'webp'
  edge?: boolean
}

export const PAPER_SHEETS: PaperSheet[] = [
  // full-bleed papers
  { slug: 'fine-grain', label: 'Fine grain', group: 'paper' },
  { slug: 'warm-speckle', label: 'Warm speckle', group: 'paper' },
  { slug: 'cream-soft', label: 'Cream soft', group: 'paper' },
  { slug: 'soft-cream', label: 'Handmade cream', group: 'paper' },
  { slug: 'laid-white', label: 'Laid white', group: 'paper' },
  { slug: 'bright-white', label: 'Bright white', group: 'paper' },
  { slug: 'vintage-white', label: 'Vintage white', group: 'paper' },
  { slug: 'crumpled-soft', label: 'Crumpled', group: 'paper' },
  { slug: 'crumpled-bright', label: 'Crumpled bright', group: 'paper' },
  { slug: 'poster-crinkle', label: 'Poster crinkle', group: 'paper' },
  { slug: 'blush-crumple', label: 'Blush crumple', group: 'paper' },
  { slug: 'peach-crumple', label: 'Peach crumple', group: 'paper' },
  { slug: 'folded-gray', label: 'Folded gray', group: 'paper' },
  { slug: 'kraft', label: 'Kraft', group: 'paper' },
  { slug: 'parchment', label: 'Parchment', group: 'paper' },
  // deckle / torn edge sheets (alpha cutouts)
  { slug: 'deckle-white', label: 'Deckle white', group: 'edge', ext: 'webp', edge: true },
  { slug: 'torn-beige', label: 'Torn beige', group: 'edge', ext: 'webp', edge: true },
  { slug: 'torn-white', label: 'Torn white', group: 'edge', ext: 'webp', edge: true },
  { slug: 'handmade-gray', label: 'Handmade rough', group: 'edge', ext: 'webp', edge: true },
  // fabric
  { slug: 'denim', label: 'Denim', group: 'fabric' },
  { slug: 'red-handmade', label: 'Red fiber', group: 'fabric' },
  { slug: 'pink-weave', label: 'Pink weave', group: 'fabric' },
  { slug: 'swatch-black', label: 'Swatch black', group: 'fabric', ext: 'webp', edge: true },
  { slug: 'swatch-navy', label: 'Swatch navy', group: 'fabric', ext: 'webp', edge: true },
  { slug: 'swatch-blue', label: 'Swatch blue', group: 'fabric', ext: 'webp', edge: true },
  { slug: 'swatch-chambray', label: 'Swatch chambray', group: 'fabric', ext: 'webp', edge: true },
  { slug: 'swatch-green', label: 'Swatch green', group: 'fabric', ext: 'webp', edge: true },
  { slug: 'denim-patch', label: 'Denim patch', group: 'fabric', ext: 'webp', edge: true },
]

export const sheetDef = (slug: string) => PAPER_SHEETS.find((s) => s.slug === slug)

export const paperUrl = (slug: string) => `/paper/${slug}.${sheetDef(slug)?.ext || 'jpg'}`
