import type { Item, ItemFile } from '../../shared/types.js'
import { getDb } from './db.js'
import { sourceName } from './sources.js'
import { expandImages, defaultRecordUrl, defaultRights } from '../../shared/urls.js'

export interface Row {
  rowid: number
  id: string
  source: string
  source_id: string
  img: string | null
  title: string
  creator: string | null
  date_display: string | null
  year_start: number | null
  year_end: number | null
  object_type: string | null
  medium: string | null
  culture: string | null
  place: string | null
  public_domain: number | null
  rights_label: string | null
  license_url: string | null
  thumb_url: string | null
  image_url: string | null
  original_url: string | null
  width: number | null
  height: number | null
  content_type: 'image' | '3d'
  files: string | null
  source_url: string
  boost: number
}

export const ROW_COLS =
  'rowid, id, source, source_id, img, title, creator, date_display, year_start, year_end, object_type, medium, culture, place, public_domain, rights_label, license_url, thumb_url, image_url, original_url, width, height, content_type, files, source_url, boost'

function extOf(url: string): string | null {
  const m = url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : null
}

export function rowToItem(r: Row): Item {
  let files: ItemFile[] = []
  if (r.files) {
    try {
      files = JSON.parse(r.files)
    } catch {
      files = []
    }
  }
  const imgs = r.img ? expandImages(r.source, r.img) : { thumb: r.thumb_url, image: r.image_url, original: r.original_url }
  if (r.content_type === 'image' && imgs.original && !files.some((f) => f.url === imgs.original)) {
    files.unshift({ format: extOf(imgs.original) || 'jpg', url: imgs.original, label: r.source === 'cma' ? 'Full resolution TIFF' : 'Original' })
    if (r.source === 'cma' && imgs.image) files.splice(1, 0, { format: 'jpg', url: imgs.image, label: 'Print (~3400px)' })
  }
  const rights = defaultRights(r.source)
  const publicDomain = r.rights_label != null || !rights ? (r.public_domain == null ? null : r.public_domain === 1) : rights.publicDomain
  const rightsLabel = r.rights_label ?? rights?.label ?? 'Rights unclear — check source'
  const licenseUrl = r.rights_label != null ? r.license_url : (rights?.licenseUrl ?? r.license_url)
  return {
    id: r.id,
    source: r.source,
    sourceName: sourceName(r.source),
    sourceUrl: r.source_url ?? defaultRecordUrl(r.source, r.source_id, r.img) ?? '',
    title: r.title,
    creator: r.creator,
    dateDisplay: r.date_display,
    yearStart: r.year_start,
    yearEnd: r.year_end,
    objectType: r.object_type,
    medium: r.medium,
    culture: r.culture,
    place: r.place,
    publicDomain,
    rightsLabel,
    licenseUrl,
    thumbnailUrl: imgs.thumb,
    imageUrl: imgs.image ?? imgs.thumb,
    originalImageUrl: imgs.original ?? imgs.image ?? imgs.thumb,
    width: r.width,
    height: r.height,
    contentType: r.content_type,
    files,
  }
}

export function getItemsByRowids(rowids: number[]): Item[] {
  if (!rowids.length) return []
  const db = getDb()
  const out: Item[] = []
  for (let i = 0; i < rowids.length; i += 500) {
    const chunk = rowids.slice(i, i + 500)
    const rows = db.prepare(`SELECT ${ROW_COLS} FROM items WHERE rowid IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as unknown as Row[]
    const byId = new Map(rows.map((r) => [r.rowid, r]))
    for (const id of chunk) {
      const r = byId.get(id)
      if (r) out.push(rowToItem(r))
    }
  }
  return out
}

export function getItemById(id: string): Item | null {
  const db = getDb()
  const r = db.prepare(`SELECT ${ROW_COLS} FROM items WHERE id = ?`).get(id) as unknown as Row | undefined
  return r ? rowToItem(r) : null
}
