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

## metwiki — The Met via Wikimedia Commons
- Wikidata items carry a Met object ID (P3634) and a Commons image (P18); QLever (`qlever.dev/api/wikidata`) returns all ~46k pairs in one query (`data/raw/met-wikidata.csv`).
- Joined against the public-domain rows of MetObjects.csv (`met_csv` table); objects the API crawl already covered are skipped, and the crawl overwrites these records later (same `met:{id}` namespace, better images).
- Images via `commons.wikimedia.org/wiki/Special:FilePath/{name}?width=…` (redirects to upload.wikimedia.org).
- Dead end, documented so nobody retries it: the other ~340k Met files on Commons have no machine-readable object-ID/accession mapping (P217 qualifiers ≈ 0, P6243 ≈ 14k).

## wellcome — Wellcome Collection
- Official snapshot `data.wellcomecollection.org/catalogue/v2/works.json.gz` (~485 MB gz NDJSON, refreshed regularly) — the live API caps any query at 10k works, the snapshot has no such limit.
- Kept: works with a `iiif-image` location and license `pdm`, `cc0` or `cc-by` (~75k). License is per work and stored per record; `pdm`/`cc0` count as public domain, `cc-by` does not (hidden by the default PD filter).
- Images: `iiif.wellcomecollection.org/thumbs/{id}/full/!{600,600|1024,1024}/0/default.jpg`. The `/image/` endpoint silently returns EMPTY 200 responses for sizes beyond each image's pre-generated list (max ~1024px); `/thumbs/` confines over-asks to the largest available. Full resolution is only reachable via 512px tiles, so 1024px is the effective cap.

## nih3d — NIH 3D
- No listing API: entry ids are scanned sequentially (`3d.nih.gov/api/entries/{id}`, `NIH_MAX_ID` = 23000, ~45 min). ~14k entries keep a published submission with an open license (Public Domain / CC0 / CC BY, per entry) and model files.
- Downloads must go through the site proxy `3d.nih.gov/api/submissions/{sid}/runs/{runId}/output-files/{fileId}` (S3 URLs are private); responses have no content-type, our `/api/download` fixes that by extension. Formats: STL, GLB, WRL, X3D.
- Thumbnails use the same proxy (`*_thumb_*.jpg` output files).

## smk — SMK, National Gallery of Denmark
- `api.smk.dk/api/v1/art/search/?keys=*&filters=[has_image:true],[public_domain:true]&offset=N&rows=500` (no key, ~39k PD works).
- IIIF: `iip-thumb.smk.dk/iiif/jp2/{jp2 id}/full/!600,600|!1600,1600|max/0/default.jpg` (max = native, multi-MB). `image_native` is an official download URL kept as a file.
- Danish metadata; `DA_EN` map adds English search terms (like the Rijksmuseum adapter).
- Record URL: `open.smk.dk/en/artwork/image/{object_number}`.

## europeana — Europeana
- Search API with cursor paging (`EUROPEANA_API_KEY`), 100 rows/request. 21M open images exist but are dominated by natural-history specimen scans, so the adapter harvests curated `collection:` themes (art 160k, photography 80k, archaeology 45k, industrial 40k, fashion 40k, music 20k, manuscript 15k) with per-provider caps (diversity) and excludes providers indexed directly (Rijksmuseum, SMK, Wellcome).
- Thumbnails via Europeana's caching proxy (`api.europeana.eu/thumbnail/v2/url.json?uri=…&size=w400`); view/original = the provider's `edmIsShownBy` URL (variable hosts; the viewer's fallback chain handles failures).
- Rights per record (PD Mark / CC0 / CC BY / CC BY-SA via `reusability=open`); provider shown in the rights label. Titles are often in the source language.

## flickr — Flickr Commons + Internet Archive Book Images
- `flickr.people.getPublicPhotos` pages deep without the ~4,000-result cap that `flickr.photos.search` has — plain resumable pagination even on the 5.3M-photo IA account. Date-window partitioning was tried first and abandoned: wide-window `photos.search` probes on huge accounts hang for minutes.
- IA Book Images (CC0 plates from scanned books) capped at 150k; titles are rewritten from “Image from page N of …” to `Book title (year) — p. N`, which also yields a search year. Commons institutions capped at 10k each (British Library and Library of Congress 40k, NASA 20k; Smithsonian skipped — indexed directly).
- Licenses kept: 7 (no known copyright restrictions), 9 (CC0), 10 (PD mark).
- Image sizes: `live.staticflickr.com/{path}.jpg` = 500px, `_b` = 1024px, `url_o` (when present) stored as the original.

## Candidates evaluated but not (yet) included
- **Library of Congress** — JSON API works without a key but is limited to 20 requests/min with hour-long blocks; rights are free text (“No known restrictions…”).
- **Sketchfab / MorphoSource** — downloads require login.
- **British Museum** — no public JSON API (the old SPARQL endpoint was retired); collection pages sit behind Cloudflare and images are CC BY-NC-SA (non-commercial). Only viable route would be the subset photographed/uploaded to Wikimedia Commons.
- **threedscans.com** — direct STL zips but no license statement on the site.
