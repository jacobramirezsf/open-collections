// Common record shape shared by the API, the web app and (as documentation) the ingestion scripts.
// The frontend must never need museum-specific logic: every adapter normalizes into this.

export type ContentType = 'image' | '3d'

export interface ItemFile {
  format: string // 'jpg' | 'stl' | 'obj' | 'glb' | 'gltf' | 'zip' | ...
  url: string
  filename?: string
  size?: number
  label?: string
}

export interface Item {
  id: string // "<source>:<sourceId>"
  source: string // short source key, e.g. "met"
  sourceName: string // display name, e.g. "The Met"
  sourceUrl: string // link to the original institutional record

  title: string
  creator: string | null

  dateDisplay: string | null
  yearStart: number | null
  yearEnd: number | null

  objectType: string | null
  medium: string | null
  culture: string | null
  place: string | null

  publicDomain: boolean | null // true = confidently reusable (PD/CC0), false = restricted, null = unclear
  rightsLabel: string // "Public domain", "CC0", "CC BY 4.0", "Rights unclear — check source", ...
  licenseUrl: string | null

  thumbnailUrl: string | null // ~400-600px
  imageUrl: string | null // ~1200-2000px for the viewer
  originalImageUrl: string | null // largest available
  width: number | null // of the image, when known
  height: number | null

  contentType: ContentType
  files: ItemFile[] // downloadable files (images and/or 3D formats)
}

export interface SourceInfo {
  key: string
  name: string
  count: number
  contentTypes: ContentType[]
  homepage: string
  license: string
}

export interface SearchParams {
  q: string
  limit: number
  offset: number
  sources?: string[]
  yearFrom?: number
  yearTo?: number
  content?: 'image' | '3d' | 'all'
  publicDomainOnly?: boolean
  objectType?: string
  medium?: string
  place?: string
  creator?: string
  sort?: 'relevance' | 'oldest' | 'newest' | 'random'
  seed?: number
}

export interface SearchResponse {
  items: Item[]
  total: number // approximate total across sources (capped per source)
  perSource: Record<string, number>
  took: number
  index: { builtAt: string | null }
}
