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
| `harvard` | Harvard Art Museums | Official API (`HARVARD_API_KEY`, 2.5k req/day) | Not open license — labeled “verify rights”, hidden by the default PD filter |
| `smk` | SMK — National Gallery of Denmark | Open API, paged | Public domain / CC0 |
| `europeana` | Europeana (EU aggregator) | Search API (`EUROPEANA_API_KEY`), curated themes: art, photography, archaeology, industrial, fashion, music, manuscripts | PD / CC0 / CC BY / CC BY-SA per record |
| `flickr` | Flickr Commons + Internet Archive Book Images | Flickr API (`FLICKR_API_KEY`), per-account pagination | No known restrictions / CC0 |
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
| `REMOVE_BG_KEY` | Vercel (production) | Optional; enables “Remove background” in the editor (remove.bg API, paid credits, per-IP daily cap) |
| `QUIVERAI_API_KEY` | Vercel (production) | Optional; enables “Vectorize (AI)” in the editor (QuiverAI image→SVG, paid credits, per-IP daily cap) |
| `BLOB_READ_WRITE_TOKEN` | auto (connected store) | Used only to persist remove.bg quota counters |

Refreshing data = run the ingest scripts locally, `npm run index:build`, `npm run index:upload`,
then redeploy (push to `main` or `vercel deploy --prod`).

## Adding more collections

Adding a museum = one adapter file in `scripts/ingest/sources/` returning the shared record shape,
plus (optionally) a URL template in `shared/urls.ts` and a line in `api/_lib/sources.ts`. Evaluated
keyed candidates, ready to build once a (free) key exists as an env var:

| Source | Key signup | Env var | What it adds |
| --- | --- | --- | --- |
| DPLA | https://pro.dp.la/developers/policies#get-a-key (automated email) | `DPLA_API_KEY` | Tens of millions of US library/museum/archive records (the US Europeana) |
| NYPL Digital Collections | https://api.repo.nypl.org/ (instant signup) | `NYPL_API_TOKEN` | ~900k PD images: menus, maps, prints, ephemera |
| Biodiversity Heritage Library | https://www.biodiversitylibrary.org/getapikey.aspx (instant) | `BHL_API_KEY` | Historical botanical/zoological plates |
| Trove (National Library of Australia) | https://trove.nla.gov.au/about/create-something/using-api | `TROVE_API_KEY` | Australian pictures/newspapers |
| Digitalt Museum (Nordics) | https://dimu.org (key by email) | `DIMU_API_KEY` | Large Nordic CC0 collections |
| Paris Musées | https://www.parismusees.paris.fr/en/open-content (form) | `PARIS_MUSEES_TOKEN` | ~400k CC0 images (Carnavalet, Petit Palais…) |
| Finnish National Gallery | https://www.kansallisgalleria.fi/en/api-sale (email) | `FNG_API_KEY` | ~40k CC0 works |

No-key candidates still open: Library of Congress (needs a slow 20 req/min harvester), Getty
(Linked Art/IIIF), Yale LUX, Wikimedia Commons curated categories.

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

## Accounts

Optional accounts (username + password, no email) sync boards and favorites across browsers and
devices. Sessions are 180-day HMAC-signed cookies (`SESSION_SECRET` env); passwords are salted
scrypt hashes; user data is stored in the project's Vercel Blob store as immutable per-save
snapshots (`userdata/{user}/{timestamp}.json` — overwriting a single blob is unsafe because Blob
overwrites can take ~60 s to propagate). Signed-out use keeps everything in localStorage; signing
in union-merges local and cloud. There is no email, so there is no password recovery.

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

## Editor (Edit button on any image)

Every image item has an **Edit** action in the viewer: **background removal**
(remove.bg, `REMOVE_BG_KEY`), a **texture rack** — halftone (with vector SVG export), dither,
riso grain, riso 2-color (misregistered two-ink separation), stipple, glyphs, ASCII (with .txt
export), crosshatch, duotone/cyanotype, CMYK halftone (with 4× vector SVG plate export at classic
screen angles), pixelate, gradient (photo→mesh gradient), paper grain — all classic
print techniques implemented scale-aware in `src/lib/textures.ts` (client-side, transparency-aware,
identical at preview and print resolution), and **AI vectorization** (QuiverAI image→SVG,
`QUIVERAI_API_KEY` from platform.quiver.ai/api-keys, per-IP daily cap, `QUIVER_MODEL` defaults to
arrow-1.1 — works on the original or on the background-removed cutout). The full-resolution image is loaded
through the same-origin proxy, optionally sent through remove.bg (server-side, `/api/removebg`,
needs `REMOVE_BG_KEY`), then screened client-side (rotated dot/line/square grid, adjustable cell,
angle, gain, ink/paper colours, transparency-aware). The preview runs at ≤1800px; exports re-render
the identical screen from the full-res source as a **PNG up to ~8000px** (size picker: source / 1.5× / 2×,
64 MP ceiling) or as a **vector SVG** (each dot a real shape — resolution-independent, ready for
screenprint separations in Illustrator/Inkscape). TIFF-only originals fall back to the largest JPEG rendition.
