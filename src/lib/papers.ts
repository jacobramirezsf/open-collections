// Real paper backgrounds (curated from the studio's Background Assets folder, served optimized
// from /public/paper). Selected as an editor "Surface": the sheet becomes the page and the effect
// output is multiplied over it like ink on stock.
export interface PaperSheet {
  slug: string
  label: string
}

export const PAPER_SHEETS: PaperSheet[] = [
  { slug: 'fine-grain', label: 'Fine grain' },
  { slug: 'warm-speckle', label: 'Warm speckle' },
  { slug: 'cream-soft', label: 'Cream soft' },
  { slug: 'crumpled-soft', label: 'Crumpled' },
  { slug: 'crumpled-bright', label: 'Crumpled bright' },
  { slug: 'folded-gray', label: 'Folded gray' },
  { slug: 'kraft', label: 'Kraft' },
  { slug: 'parchment', label: 'Parchment' },
]

export const paperUrl = (slug: string) => `/paper/${slug}.jpg`
