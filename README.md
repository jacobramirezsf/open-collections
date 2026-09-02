# Open Collections

An umbrella of fast, image-first browsers for open visual archives, sharing one interface (dense
masonry grid, viewer, boards, multi-select, batch downloads, contact sheets, similarity, halftone
editor):

- **Museums** (`/`) — 671k open-access objects and 3D models from 9 institutions, searched against
  our own SQLite/FTS5 index. Search “chair”, get a screen full of chairs from The Met, the
  Rijksmuseum, the Smithsonian, the National Gallery of Art, Cleveland, Chicago and NASA.
- **Patents** (`/patents`) — live image-first Google Patents browsing (the successor to the
  Patent Images Chrome extension): every result is a drawing sheet, with per-figure PNG and full
  PDF downloads.

**Live:** https://open-collections.vercel.app

## How it works

The museum APIs are *not* queried at search time. Instead, an ingestion pipeline pulls each
institution's open data (bulk dumps, OAI-PMH, public S3 buckets, or paged APIs), normalizes every
record into one common shape, and writes a single SQLite file with an FTS5 full-text index. That
file (`data/index.sqlite`, ~150–250 MB) is bundled into the Vercel serverless functions, so a search
is one local SQLite query — typically 10–100 ms — and a flaky museum API can never break search.
Images and downloads are served from the museums' own servers (proxied by `/api/download` so the
browser gets a real file with the right type and name).

```
scripts/ingest/sources/*.mjs   one adapter per institution  →  data/staging/<source>.sqlite
scripts/ingest/build-index.mjs merges + compacts + FTS5      →  data/index.sqlite
scripts/upload-index.mjs       publishes the index as a GitHub release asset (INDEX_URL)
scripts/fetch-index.mjs        convenience: download INDEX_URL locally instead of ingesting
api/*.ts                       Vercel Node functions (search, item, status, download, image)
src/                           Vite + React front end (no framework beyond React)
shared/                        types + per-source URL templates shared by API, app and scripts
```

See [docs/architecture.md](docs/architecture.md), [docs/sources.md](docs/sources.md) and
[docs/refresh.md](docs/refresh.md).

## Sources

| Key | Institution | Mechanism | Rights in index |
| --- | --- | --- | --- |
| `met` | The Metropolitan Museum of Art | Open Access CSV (GitHub) + object API for image URLs, plus Wikidata→Wikimedia Commons images for objects the crawl hasn't reached (`metwiki` adapter) | CC0 |
| `aic` | Art Institute of Chicago | Public API listing (`/artworks`, 1 req/s) | CC0 (public-domain works only) |
| `cma` | Cleveland Museum of Art | Open Access API, paged | CC0 |
| `nga` | National Gallery of Art | Open data CSVs (GitHub) + IIIF | CC0 (open-access images only) |
| `rijks` | Rijksmuseum | OAI-PMH (`oai_dc`) from data.rijksmuseum.nl + IIIF | Public Domain Mark / CC0 only |
| `wellcome` | Wellcome Collection | Official catalogue snapshot (works.json.gz) + IIIF | PDM / CC0 / CC BY (per work) |
| `nih3d` | NIH 3D | Per-entry JSON API scan | Public domain / CC0 / CC BY (per model) |
| `si` | Smithsonian (Cooper Hewitt, NMAH, SAAM, NPG, NASM, Freer, Hirshhorn, NMAAHC, NMAI, NMNH Anthropology, Postal Museum, Smithsonian 3D) | Open Access bulk metadata (public S3) + IDS images + Voyager 3D packages | CC0 |
| `nasa3d` | NASA 3D Resources | science.nasa.gov WordPress REST | Public domain (NASA) |

No API keys are required for any source. The only optional key is `REMOVE_BG_KEY` (remove.bg) for
the halftone editor's background-removal step. Records whose rights cannot be confirmed are labeled
“Rights unclear — check source”, and the “Public domain / open access only” filter (on by default)
excludes them. Every item links to its original institutional record.

## Development

```bash
npm install
npm run ingest -- cma nga nasa3d      # small, fast sources to start with (minutes)
npm run index:build                   # → data/index.sqlite
node scripts/dev-api.mjs              # API on :3999 (uses Node's built-in node:sqlite, needs Node ≥ 22.13)
npm run dev                           # Vite on :5180, proxies /api → :3999
```

`npm run ingest -- all` runs every adapter; the Met (per-object API calls) and Rijksmuseum (OAI)
harvests are long-running and resumable — see docs/refresh.md.

## Deployment

The project is a plain Vite site plus `api/*.ts` Vercel functions. The index is *not* bundled
(it outgrew Vercel's 250 MB function limit): `api/_lib/db.ts` streams `INDEX_URL` into `/tmp` on the
first request of each instance.

Environment variables:

| Name | Where | Purpose |
| --- | --- | --- |
| `INDEX_URL` | Vercel (all envs) | URL of the built `index.sqlite` — a GitHub release asset (from `npm run index:upload`); downloaded into `/tmp` on cold start |
| `REMOVE_BG_KEY` | Vercel (production) | Optional; enables “Remove background” in the halftone editor (remove.bg API, paid credits, per-IP daily cap) |
| `BLOB_READ_WRITE_TOKEN` | auto (connected store) | Used only to persist remove.bg quota counters |

Refreshing data = run the ingest scripts locally, `npm run index:build`, `npm run index:upload`,
then redeploy (push to `main` or `vercel deploy --prod`).

## Known limitations

- **The Met is partially indexed** (~73k of ~248k public-domain objects: a slow resumable API crawl —
  the Met's Imperva WAF rate-bans crawlers — plus ~33k objects whose images come via Wikidata/Wikimedia
  Commons). Re-running `npm run ingest -- met` keeps filling it in.
- **AIC's image host blocks Vercel's IPs**, so `/api/download` answers 302 for AIC files and the
  browser fetches the original directly (AIC allows CORS); the UI handles this transparently.
- Rijksmuseum, Smithsonian and AIC are capped (70k / 100k / all PD) to keep the index under Vercel's
  250 MB function limit; the Rijksmuseum sample is a random public-domain subset of ~600k eligible works.
- Rijksmuseum metadata is Dutch; common terms are translated for search but titles stay Dutch.
- “Similar” compares only the results already loaded (client-side image signatures), not the whole index.

## Boards, selection, downloads

Boards are stored in the browser (localStorage) behind a small `BoardStore` interface
(`src/lib/boards.ts`) so a synced backend can be added without touching the UI. Multi-select
supports click, shift-range, drag marquee, and “select all loaded”; selections can be downloaded as a
ZIP (assembled in the browser from `/api/download` streams), saved to a board, or printed as a
contact sheet. “Similar” ranks the already-loaded results by a small perceptual image signature
computed client-side.

## Patents tool

`/api/patents` proxies the same `/xhr/query` JSON endpoint patents.google.com uses internally (no
key) and normalizes results into the shared `Item` shape, so the whole UI works unchanged — boards
can mix museum objects and patents. Filters: date field (priority/filing/publication) + year range,
inventor, assignee, country, utility vs design, granted vs application, sort; Google Patents
operators (`inventor:`, `assignee:`, `cpc:`, `before:`/`after:`…) can also be typed straight into
the search box. Images come from the public `patentimages.storage.googleapis.com` CDN; because
patent items aren't in our index, `/api/download` and `/api/image` accept an allowlisted raw
`?url=` (that CDN only). Responses are edge-cached for an hour; if Google briefly rate-limits, the
UI shows a friendly retry message. US patent documents are treated as public record; other
jurisdictions are labeled “check jurisdiction”.

## Halftone editor

Every image item has a **Halftone** action in the viewer: the full-resolution image is loaded
through the same-origin proxy, optionally sent through remove.bg (server-side, `/api/removebg`,
needs `REMOVE_BG_KEY`), then screened client-side (rotated dot/line/square grid, adjustable cell,
angle, gain, ink/paper colours, transparency-aware). The preview runs at ≤1800px; exports re-render
the identical screen from the full-res source as a **PNG up to ~8000px** (size picker: source / 1.5× / 2×,
64 MP ceiling) or as a **vector SVG** (each dot a real shape — resolution-independent, ready for
screenprint separations in Illustrator/Inkscape). TIFF-only originals fall back to the largest JPEG rendition.
