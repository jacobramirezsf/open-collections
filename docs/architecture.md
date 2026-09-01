# Architecture

## Goals

1. Search always works and is fast, regardless of any museum API's health.
2. Hundreds of results per query, balanced across institutions.
3. Cheap to run (Vercel Hobby + one public Blob file), simple to understand.

## Data flow

```
institution open data ──(adapter)──▶ data/staging/<src>.sqlite ──(build-index)──▶ data/index.sqlite
                                                                                       │
                                                       Vercel Blob ◀──(index:upload)───┘
                                                            │
                     Vercel build: fetch-index.mjs ◀────────┘  →  bundled into api/* functions
```

### Adapters (`scripts/ingest/sources/*.mjs`)

Each adapter exports `{ key, name, ingest(store, opts) }` and writes normalized records via
`store.put(record)`. The record shape is `shared/types.ts` `Item` plus `text` (extra searchable
text: tags, department, description snippet) and `boost` (small ranking nudge for highlights).
Adapters are resumable (`store.getProgress/setProgress`) and never throw on a single bad record.

Normalization helpers (`scripts/ingest/lib/normalize.mjs`):

- `years(start, end, display)` — numeric fields when the source has them, otherwise a parser for
  free-text dates (`ca. 1850`, `1850–60`, `late 19th century`, `1st century B.C.`, `1920s`…).
  Anything unparseable stays `null` and is excluded when a year filter is active.
- `RIGHTS.*` — a fixed vocabulary (Public domain, CC0, CC BY…, “Rights unclear — check source”).
  `publicDomain` is `true` only when the institution explicitly says so.

### Index (`scripts/ingest/build-index.mjs`)

- `items` table: one row per object with compacted image URLs. `shared/urls.ts` holds a per-source
  template (e.g. NGA: a IIIF uuid; Met: `dept/file.jpg`) so three long URLs collapse to one key;
  the API expands them again. Default rights and record URLs per source are also elided.
- `fts` virtual table (FTS5, contentless, porter stemming, `detail=full`) over title, creator,
  object type, medium, culture, place and text. Contentless + `detail=column` breaks `bm25()`
  (returns 0) — keep `detail=full`.
- Per-source caps keep the file under Vercel's 250 MB function limit (`CAPS=` env to override).

### Search (`api/_lib/search.ts`)

For each enabled source: `fts MATCH` + filters, ranked by weighted `bm25` (title 12, object type
10, creator 4, culture/place 4, medium 3, text 1) plus a small boost. The per-source candidate
lists are merged with a diversity-aware greedy merge (score discounted by how many items that
source already contributed), so one big collection can't dominate. Multi-word queries are AND
first; if that is thin, OR results are appended. Empty query = browse mode (highlights first,
seeded shuffle). Always `FROM fts CROSS JOIN items` — letting SQLite pick `items` as the outer
loop makes the query ~100× slower.

### Downloads / images

`/api/download?id=&file=` looks the item up in the index (only indexed URLs are ever fetched),
streams the upstream body, fixes the content-type from the extension when the host sends
`octet-stream`/`text/plain`, and sets `Content-Disposition` with `<source>-<id>-<title>.<ext>`.
Batch ZIPs are assembled in the browser with fflate from those streams. `/api/image` is the same
proxy without the attachment header, used as a fallback when a CDN throttles and for canvas access
in the similarity feature.

### Front end (`src/`)

Single React app, no router: search state lives in the query string, boards in the hash. Masonry
is a shortest-column layout using stored width/height ratios. Cards that fail to load (or load a
tiny placeholder) retry once via the proxy, then disappear.
