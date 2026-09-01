#!/usr/bin/env node
// Build step: make sure data/index.sqlite exists. On Vercel, downloads it from INDEX_URL (a Vercel Blob URL
// produced by `npm run index:upload`). Locally, a freshly built index is left alone.
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const out = path.resolve(import.meta.dirname, '../data/index.sqlite')
const url = process.env.INDEX_URL
if (fs.existsSync(out) && !process.env.VERCEL) {
  console.log(`index: using local ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`)
  process.exit(0)
}
if (!url) {
  console.warn('index: INDEX_URL not set and no local data/index.sqlite — the API will start with an empty index.')
  process.exit(0)
}
console.log(`index: downloading ${url}`)
const res = await fetch(url)
if (!res.ok) {
  console.error(`index: download failed: HTTP ${res.status}`)
  process.exit(1)
}
fs.mkdirSync(path.dirname(out), { recursive: true })
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(out))
console.log(`index: saved ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`)
