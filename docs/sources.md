# Source adapters

Verified against the live endpoints on 2026-08-31. Each adapter lives in `scripts/ingest/sources/<key>.mjs`.

## met — The Metropolitan Museum of Art
- Metadata: `MetObjects.csv` (Git LFS, ~300 MB) from github.com/metmuseum/openaccess, filtered to `Is Public Domain = True` (~248k rows), loaded into a `met_csv` table in the staging file.
- Images: not in the CSV; `GET collectionapi.metmuseum.org/public/collection/v1/objects/{id}` per object (`primaryImageSmall` = web-large, `primaryImage` = original).
- Gotcha: the API sits behind Imperva, which blocks the IP (HTTP 403 + JS challenge page) after sustained crawling. `MET_RPS` (default 12) and `MET_CONCURRENCY` control the rate; the crawl is resumable (`met_done` table) and prioritizes highlights then round-robins departments so partial crawls stay diverse.
- Incremental refresh: `/objects?metadataDate=YYYY-MM-DD` lists changed IDs.

## aic — Art Institute of Chicago
- `GET api.artic.edu/api/v1/artworks?fields=…&limit=100&page=N` walks the whole collection (1,328 pages) at 1 req/s, as the docs request. Only `is_public_domain && image_id` records are kept.
- IIIF: `www.artic.edu/iiif/2/{image_id}/full/{600,|1686,|3000,}/0/default.jpg` (3000 px is the max for public-domain works). The image host 403s requests with an `http://localhost` referer — the site sends no referrer.
- Alternative: the monthly data dump (`artic-api-data.tar.bz2`, ~114 MB).

## cma — Cleveland Museum of Art
- `GET openaccess-api.clevelandart.org/api/artworks/?has_image=1&cc0=1&limit=1000&skip=N` (~42 pages).
- Images: `openaccess-cdn.clevelandart.org/{acc}/{acc}_web.jpg | _print.jpg | _full.tif`.

## nga — National Gallery of Art
- CSVs from github.com/NationalGalleryOfArt/opendata: `published_images.csv` (`openaccess = 1` only), `objects_terms.csv` (keywords/places), `objects.csv`.
- IIIF: `api.nga.gov/iiif/{uuid}/full/{!600,600|!1600,1600|max}/0/default.jpg`.
- Record URL pattern `www.nga.gov/collection/art-object-page.{id}.html` (nga.gov blocks curl, so it is unverified live).

## rijks — Rijksmuseum
- OAI-PMH `data.rijksmuseum.nl/oai?verb=ListRecords&metadataPrefix=oai_dc` (no key, 50 records/page). Kept only when `dc:rights` is a public-domain mark/CC0 and a `dc:relation` IIIF URL exists.
- Parallelism: the harvest is split into datestamp windows (`from`/`until`, hourly around the June 2026 bulk update) so several streams run at once; each window is resumable via its resumption token. `RIJKS_CAP` (default 80k) stops early.
- Metadata is Dutch. `NL_EN` in the adapter maps common types/materials/subjects to English search terms, appended to the searchable text; object types are shown translated where known.
- IIIF: `iiif.micr.io/{id}/full/{500,|1600,|max}/0/default.jpg`.
- Human record: `www.rijksmuseum.nl/en/collection/{objectNumber}` (redirects to the slugged page).

## si — Smithsonian Open Access
- Bulk NDJSON from the public S3 bucket `smithsonian-open-access.s3-us-west-2.amazonaws.com/metadata/edan/{unit}/{00..ff}.txt` (no key). `UNITS` in the adapter lists which units and per-unit caps; `SI_UNITS=chndm,saam` limits a run.
- Kept: `type == "edanmdm"`, `metadata_usage.access == "CC0"`, with an IDS image (`online_media.media[].type == "Images"`) or a Voyager 3D package (`type == "3d_voyager"`).
- Images: `ids.si.edu/ids/deliveryService?id={idsId}[&max=600|1600]`.
- 3D: `media.resources[]` → `3d-api.si.edu/content/document/3d_package:{uuid}/resources/{file}` (`.glb`, `.usdz`, OBJ/STL zips); format inferred from `MODEL_FILE_TYPE` or the filename.
- `ocio_dpo3d` has no `index.txt`; the adapter falls back to listing the S3 prefix.

## nasa3d — NASA 3D Resources
- `science.nasa.gov/wp-json/wp/v2/topic?parent=447593&per_page=100&page=N` (~380 models). Download links are regexed out of `content.rendered` (`assets.science.nasa.gov/content/dam/...`), formats: STL, GLB, zips of STL/OBJ, FBX, Blender…
- `featured_image_url` is the preview; the `?w=&fit=clip` params resize it.

## Candidates evaluated but not (yet) included
- **Wellcome Collection** — good API (no key, CORS, IIIF, license per item: `pdm`, `cc-by`), but capped at 10k works per query; would need query partitioning or the snapshot dataset.
- **Library of Congress** — JSON API works without a key but is limited to 20 requests/min with hour-long blocks; rights are free text (“No known restrictions…”).
- **NIH 3D** — per-entry JSON (`3d.nih.gov/api/entries/{id}`, ~22k entries, license per entry) with a working file proxy; sequential enumeration is feasible as a later adapter.
- **Sketchfab / MorphoSource** — downloads require login.
- **threedscans.com** — direct STL zips but no license statement on the site.
