#!/usr/bin/env node
// Uploads data/index.sqlite to Vercel Blob (needs BLOB_READ_WRITE_TOKEN, e.g. via `vercel env pull`).
// Prints the public URL to set as INDEX_URL. The URL is stable across uploads (addRandomSuffix: false).
import fs from 'node:fs'
import path from 'node:path'
import { put } from '@vercel/blob'

const file = path.resolve(import.meta.dirname, '../data/index.sqlite')
if (!fs.existsSync(file)) {
  console.error('data/index.sqlite not found. Run `npm run index:build` first.')
  process.exit(1)
}
const token = process.env.BLOB_READ_WRITE_TOKEN
if (!token) {
  console.error('BLOB_READ_WRITE_TOKEN missing (run `vercel env pull .env.local` and `source`/dotenv it).')
  process.exit(1)
}
const size = fs.statSync(file).size
console.log(`uploading ${(size / 1e6).toFixed(1)} MB …`)
const blob = await put('index/index.sqlite', fs.createReadStream(file), {
  access: 'public',
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType: 'application/vnd.sqlite3',
  multipart: true,
  token,
})
console.log(`uploaded: ${blob.url}`)
console.log('Set INDEX_URL to this URL in Vercel (production + preview) and redeploy.')
