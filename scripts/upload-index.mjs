#!/usr/bin/env node
// Publishes data/index.sqlite as a GitHub release asset (tag `index-latest`). GitHub serves release
// assets with free bandwidth, which matters because every serverless cold start downloads the index.
// The asset URL is stable: set it once as INDEX_URL in Vercel, then just re-run this + redeploy.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve(import.meta.dirname, '../data/index.sqlite')
if (!fs.existsSync(file)) {
  console.error('data/index.sqlite not found. Run `npm run index:build` first.')
  process.exit(1)
}
const TAG = 'index-latest'
const run = (args) => execFileSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
try {
  run(['release', 'view', TAG])
} catch {
  console.log('creating release', TAG)
  run(['release', 'create', TAG, '--title', 'Search index (rolling)', '--notes', 'Rolling build of data/index.sqlite. Uploaded by scripts/upload-index.mjs; see docs/refresh.md.'])
}
console.log(`uploading ${(fs.statSync(file).size / 1e6).toFixed(0)} MB …`)
execFileSync('gh', ['release', 'upload', TAG, file, '--clobber'], { stdio: 'inherit' })
const repo = run(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
console.log(`uploaded: https://github.com/${repo}/releases/download/${TAG}/index.sqlite`)
console.log('Redeploy (git push or `vercel deploy --prod`) so new instances pick it up.')
