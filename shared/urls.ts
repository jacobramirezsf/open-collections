// Per-source URL templates so the index stores a short image key instead of three long URLs per record.
// Used by scripts/ingest/build-index.mjs (compact) and api/_lib/items.ts (expand).

export interface ImageSet {
  thumb: string | null
  image: string | null
  original: string | null
}

interface Template {
  // Try to derive a short key from the full URLs; return null if they don't match the template.
  extract(urls: ImageSet): string | null
  expand(key: string): ImageSet
  recordUrl?: (sourceId: string, key: string | null) => string
  rights?: { publicDomain: boolean | null; label: string; licenseUrl: string | null }
}

const CC0 = { publicDomain: true, label: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }
const PD = { publicDomain: true, label: 'Public domain', licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/' }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const TEMPLATES: Record<string, Template> = {
  met: {
    extract: ({ thumb, original }) => {
      const c = (original || '').match(/^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/([^?]+)$/)
      if (c) {
        try {
          return 'c:' + decodeURIComponent(c[1])
        } catch {
          return null
        }
      }
      const m = (original || thumb || '').match(/^https:\/\/images\.metmuseum\.org\/CRDImages\/([^/]+)\/(?:original|web-large)\/([^/?#]+)$/)
      return m ? `${m[1]}/${m[2]}` : null
    },
    expand: (k) => {
      if (k.startsWith('c:')) {
        const enc = encodeURIComponent(k.slice(2))
        return {
          thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}?width=600`,
          image: `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}?width=1600`,
          original: `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}`,
        }
      }
      const i = k.indexOf('/')
      const dept = k.slice(0, i)
      const file = k.slice(i + 1)
      return {
        thumb: `https://images.metmuseum.org/CRDImages/${dept}/web-large/${file}`,
        image: `https://images.metmuseum.org/CRDImages/${dept}/web-large/${file}`,
        original: `https://images.metmuseum.org/CRDImages/${dept}/original/${file}`,
      }
    },
    recordUrl: (sid) => `https://www.metmuseum.org/art/collection/search/${sid}`,
    rights: CC0,
  },
  aic: {
    extract: ({ thumb }) => {
      const m = (thumb || '').match(/^https:\/\/www\.artic\.edu\/iiif\/2\/([^/]+)\/full\//)
      return m ? m[1] : null
    },
    expand: (k) => ({
      thumb: `https://www.artic.edu/iiif/2/${k}/full/600,/0/default.jpg`,
      image: `https://www.artic.edu/iiif/2/${k}/full/1686,/0/default.jpg`,
      original: `https://www.artic.edu/iiif/2/${k}/full/3000,/0/default.jpg`,
    }),
    recordUrl: (sid) => `https://www.artic.edu/artworks/${sid}`,
    rights: CC0,
  },
  cma: {
    extract: ({ thumb, image, original }) => {
      const m = (thumb || '').match(/^https:\/\/openaccess-cdn\.clevelandart\.org\/([^/]+)\/\1_web\.jpg$/)
      if (!m) return null
      const acc = m[1]
      const ok =
        (!image || image === `https://openaccess-cdn.clevelandart.org/${acc}/${acc}_print.jpg`) &&
        (!original || original === `https://openaccess-cdn.clevelandart.org/${acc}/${acc}_full.tif`)
      return ok ? acc : null
    },
    expand: (acc) => ({
      thumb: `https://openaccess-cdn.clevelandart.org/${acc}/${acc}_web.jpg`,
      image: `https://openaccess-cdn.clevelandart.org/${acc}/${acc}_print.jpg`,
      original: `https://openaccess-cdn.clevelandart.org/${acc}/${acc}_full.tif`,
    }),
    recordUrl: (_sid, key) => (key ? `https://clevelandart.org/art/${key}` : `https://www.clevelandart.org/art/collection/search`),
    rights: CC0,
  },
  nga: {
    extract: ({ thumb }) => {
      const m = (thumb || '').match(/^https:\/\/api\.nga\.gov\/iiif\/([^/]+)\/full\//)
      return m ? m[1] : null
    },
    expand: (k) => ({
      thumb: `https://api.nga.gov/iiif/${k}/full/!600,600/0/default.jpg`,
      image: `https://api.nga.gov/iiif/${k}/full/!1600,1600/0/default.jpg`,
      original: `https://api.nga.gov/iiif/${k}/full/max/0/default.jpg`,
    }),
    recordUrl: (sid) => `https://www.nga.gov/collection/art-object-page.${sid}.html`,
    rights: CC0,
  },
  si: {
    extract: ({ original }) => {
      const m = (original || '').match(/^https:\/\/ids\.si\.edu\/ids\/deliveryService\?id=([^&]+)$/)
      return m ? decodeURIComponent(m[1]) : null
    },
    expand: (k) => {
      const base = `https://ids.si.edu/ids/deliveryService?id=${encodeURIComponent(k)}`
      return { thumb: `${base}&max=600`, image: `${base}&max=1600`, original: base }
    },
    rights: CC0,
  },
  rijks: {
    extract: ({ thumb }) => {
      const m = (thumb || '').match(/^https:\/\/iiif\.micr\.io\/([^/]+)\/full\//)
      return m ? m[1] : null
    },
    expand: (k) => ({
      thumb: `https://iiif.micr.io/${k}/full/500,/0/default.jpg`,
      image: `https://iiif.micr.io/${k}/full/1600,/0/default.jpg`,
      original: `https://iiif.micr.io/${k}/full/max/0/default.jpg`,
    }),
    recordUrl: (sid) => `https://www.rijksmuseum.nl/en/collection/${sid}`,
    rights: PD,
  },
  wellcome: {
    extract: ({ thumb }) => {
      const m = (thumb || '').match(/^https:\/\/iiif\.wellcomecollection\.org\/image\/([^/]+)\/full\//)
      return m ? m[1] : null
    },
    expand: (k) => ({
      thumb: `https://iiif.wellcomecollection.org/image/${k}/full/600,/0/default.jpg`,
      image: `https://iiif.wellcomecollection.org/image/${k}/full/1600,/0/default.jpg`,
      original: `https://iiif.wellcomecollection.org/image/${k}/full/max/0/default.jpg`,
    }),
  },
}

export function compactImages(source: string, urls: ImageSet): string | null {
  const t = TEMPLATES[source]
  if (!t) return null
  try {
    const key = t.extract(urls)
    if (!key) return null
    // Round-trip check: only compact when expansion reproduces every provided URL.
    const e = t.expand(key)
    if ((urls.thumb && urls.thumb !== e.thumb) || (urls.image && urls.image !== e.image) || (urls.original && urls.original !== e.original)) return null
    return key
  } catch {
    return null
  }
}

export function expandImages(source: string, key: string): ImageSet {
  return TEMPLATES[source].expand(key)
}

export function defaultRecordUrl(source: string, sourceId: string, key: string | null): string | null {
  const t = TEMPLATES[source]
  return t?.recordUrl ? t.recordUrl(sourceId, key) : null
}

export function defaultRights(source: string) {
  return TEMPLATES[source]?.rights ?? null
}

export { esc as _esc }
