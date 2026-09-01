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
vercel env pull .env.local                     # once, for BLOB_READ_WRITE_TOKEN
set -a; . ./.env.local; set +a
npm run index:upload                           # → https://…public.blob.vercel-storage.com/index/index.sqlite
git push                                       # or: vercel deploy --prod  (the build downloads INDEX_URL)
```

The Blob URL is stable, so `INDEX_URL` only needs to be set once. A redeploy is required after each
upload because the file is bundled into the functions at build time.

## Size budget

Vercel functions must stay under 250 MB uncompressed. `build-index.mjs` applies per-source caps
(`DEFAULT_CAPS`) — roughly 520 bytes per record including the FTS index, so ~430k records is the
practical ceiling. Capped sources keep highlights (`boost > 0`) first, then a stable pseudo-random
subset, so the sample stays diverse.

## Scheduling

There is no cron yet. A GitHub Action that runs the fast adapters weekly, builds, uploads and
redeploys would fit in a few lines; the Met crawl is the only step that needs many hours.
