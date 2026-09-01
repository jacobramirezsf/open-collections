// Normalization helpers shared by all source adapters.

export function clean(s, max = 400) {
  if (s == null) return null
  let t = String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return null
  if (t.length > max) t = t.slice(0, max - 1) + '…'
  return t
}

export function joinUnique(arr, sep = '; ', max = 300) {
  if (!arr) return null
  const seen = new Set()
  const out = []
  for (const a of arr) {
    const c = clean(a, 200)
    if (!c) continue
    const k = c.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out.length ? clean(out.join(sep), max) : null
}

export function slug(s, max = 60) {
  return (
    String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'untitled'
  )
}

const CENTURY = /(\d{1,2})(?:st|nd|rd|th)\s*(?:century|c\.)/i
const MILLENNIUM = /(\d)(?:st|nd|rd|th)\s*millennium/i

function bcAdjust(year, ctx) {
  return /\b(b\.?c\.?e?\.?)\b/i.test(ctx) ? -year : year
}

// Parse a free-text date display into [start, end] years, or null when unknown.
// Handles: 1850 | ca. 1850 | 1850–1860 | 1850-60 | 1850s | 18th century | late 19th century |
// early 1900s | 1st century B.C. | 500 BCE | before 1900 | after 1850 | 1920/1925 | 19th–20th century
export function parseYears(display) {
  if (!display) return null
  const s = String(display).replace(/–|—|−/g, '-').trim()
  if (!s || /^(n\.?d\.?|undated|unknown|date unknown|no date)$/i.test(s)) return null

  // millennium
  const mm = s.match(MILLENNIUM)
  if (mm) {
    const n = Number(mm[1])
    const bc = /b\.?c/i.test(s)
    return bc ? [-(n * 1000), -((n - 1) * 1000 + 1)] : [(n - 1) * 1000 + 1, n * 1000]
  }

  // centuries (possibly a range of centuries)
  const cents = [...s.matchAll(/(\d{1,2})(?:st|nd|rd|th)\s*(?:-|to|or)?\s*(?:(\d{1,2})(?:st|nd|rd|th))?\s*(?:century|c\b)/gi)]
  if (cents.length) {
    const bc = /\bb\.?c\.?e?\b/i.test(s)
    const c1 = Number(cents[0][1])
    const c2 = Number(cents[0][2] || cents[cents.length - 1][1] || c1)
    let start = (c1 - 1) * 100 + 1
    let end = c2 * 100
    const lower = s.toLowerCase()
    if (c1 === c2) {
      if (/\bearly\b|\bfirst (half|quarter)\b|\bbeginning\b/.test(lower)) end = start + 49
      else if (/\blate\b|\bsecond half\b|\bend\b|\blast quarter\b/.test(lower)) start = end - 49
      else if (/\bmid\b|\bmiddle\b/.test(lower)) {
        start += 25
        end -= 25
      }
    }
    return bc ? [-end, -start] : [start, end]
  }

  // decades: 1850s / 1850's / early 1900s
  const dec = s.match(/\b(\d{3})0['’]?s\b/)
  if (dec) {
    const start = Number(dec[1]) * 10
    const lower = s.toLowerCase()
    if (/\bearly\b/.test(lower)) return [start, start + 4]
    if (/\blate\b/.test(lower)) return [start + 5, start + 9]
    // "1900s" alone usually means the decade; treat 1900s/2000s as the decade too
    return [start, start + 9]
  }

  // explicit 3-4 digit years (also with BC/BCE)
  const yrs = [...s.matchAll(/(?<![\d.])(\d{3,4})(?![\d])/g)].map((m) => Number(m[1])).filter((y) => y > 0 && y <= 2100)
  if (yrs.length) {
    // "1850-60" abbreviation
    const abbr = s.match(/(\d{4})\s*-\s*(\d{2})(?!\d)/)
    let start = Math.min(...yrs)
    let end = Math.max(...yrs)
    if (abbr && yrs.length === 1) {
      start = Number(abbr[1])
      end = Math.floor(start / 100) * 100 + Number(abbr[2])
      if (end < start) end = start
    }
    const lower = s.toLowerCase()
    if (/\bbefore\b|\bby\b|\bprior to\b|\buntil\b/.test(lower) && yrs.length === 1) start = end - 30
    if (/\bafter\b|\bpost\b|\bfrom\b|\bsince\b/.test(lower) && yrs.length === 1) end = start + 30
    if (/\b(ca?\.|circa|c\.|about|approximately)/i.test(s) && start === end) {
      start -= 5
      end += 5
    }
    const bc = /\bb\.?c\.?e?\b/i.test(s)
    if (bc) return [-end, -start]
    if (end - start > 1200) return null // nonsense
    return [start, end]
  }

  // BC single years like "500 B.C." already handled; small numbers ("30 BCE")
  const small = s.match(/(?<![\d.])(\d{1,2})(?![\d])\s*(b\.?c\.?e?|a\.?d\.?|c\.?e\.?)/i)
  if (small) {
    const y = bcAdjust(Number(small[1]), small[2])
    return [y, y]
  }
  return null
}

// Combine numeric fields (when the source provides them) with a display-string fallback.
export function years(start, end, display) {
  let s = toInt(start)
  let e = toInt(end)
  if (s != null && e != null && s !== 0 && e !== 0 && s <= e && e - s <= 1200 && e <= 2100) return [s, e]
  if (s != null && s !== 0 && e == null) return [s, s]
  const p = parseYears(display)
  if (p) return p
  if (s && s !== 0) return [s, e && e >= s ? e : s]
  return [null, null]
}

export function toInt(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

// Standard rights vocabulary. Adapters decide publicDomain = true only when the source states it explicitly.
export const RIGHTS = {
  PD: { publicDomain: true, rightsLabel: 'Public domain', licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/' },
  CC0: { publicDomain: true, rightsLabel: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  CC_BY: { publicDomain: false, rightsLabel: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  CC_BY_SA: { publicDomain: false, rightsLabel: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  CC_BY_NC: { publicDomain: false, rightsLabel: 'CC BY-NC 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/' },
  NASA: { publicDomain: true, rightsLabel: 'Public domain (NASA)', licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' },
  UNCLEAR: { publicDomain: null, rightsLabel: 'Rights unclear — check source', licenseUrl: null },
  RESTRICTED: { publicDomain: false, rightsLabel: 'Restricted — see source', licenseUrl: null },
}

export function extOf(url) {
  const m = String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : null
}
