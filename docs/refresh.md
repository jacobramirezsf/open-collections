# Refreshing the data

Everything runs locally (or in any Node ≥ 22.18 environment) and ends with one file upload.

```bash
# 1. Pull fresh data. Each source writes to data/staging/<source>.sqlite and is resumable.
npm run ingest -- cma nga nasa3d si aic       # ~1–2 h total (aic walks 1,300 pages at 1 req/s)
npm run ingest -- rijks                        # OAI harvest, RIJKS_CAP=80000 by default
MET_RPS=6 MET_CONCURRENCY=3 npm run ingest -- met   # long; stop/restart freely, it resumes

# Options: --fresh (drop the source first), --limit N (stop after N records),
# SI_UNITS=chndm,saam (subset of Smithsonian units), CAPS=rijks=60000 (index caps, see below)

# 2. Build the index (merges staging files, compacts URLs, builds FTS5).
npm run index:build                            # prints per-source counts and file size

# 3. Test locally
node scripts/dev-api.mjs & npm run dev
node scripts/e2e.mjs                           # Playwright smoke test (searches, viewer, boards, 3D, mobile)

# 4. Publish
npm run index:upload                           # gh release upload → stable INDEX_URL_A/B/… assets
git add shared/shards.json && git commit && git push   # commit the manifest if it changed
```

The release-asset URLs are stable, so `INDEX_URL_A`, `INDEX_URL_B`, … only need to be set once per
shard letter (add the next letter's env var when a build first produces it). A redeploy is still
required after each upload: running instances keep their `/tmp` copies, and a deploy recycles them.

Additional inputs: `npm run ingest -- metwiki` refreshes the Met-via-Commons records; its input CSV
(`data/raw/met-wikidata.csv`) is re-fetched with the QLever query in the header of
`scripts/ingest/sources/metwiki.mjs`.

## Size budget — shards

The index is split into shards (`data/index-a.sqlite`, `-b`, …), each ≤ ~360 MB so it fits a Vercel
function's 500 MB `/tmp` with headroom. `build-index.mjs` bin-packs whole sources into as many
shards (up to 4 ≈ 2.5M records) as needed and writes the source→shard map to `shared/shards.json`
(committed; the API routes by it). `met` and `metwiki` always share a shard (same id namespace).
`/api/search` fans out to `/api/shard-a…` and re-merges; each shard function downloads only its own
file on cold start (~2 s). Per-source caps (`DEFAULT_CAPS`, override with `CAPS=`) keep individual
sources reasonable; capped sources keep highlights first, then a stable pseudo-random subset.

## Scheduling

There is no cron yet. A GitHub Action that runs the fast adapters weekly, builds, uploads and
redeploys would fit in a few lines; the Met crawl is the only step that needs many hours.
