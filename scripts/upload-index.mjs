#!/usr/bin/env node
// Publishes the index shards (data/index-*.sqlite) as GitHub release assets on the rolling
// `index-latest` tag. Each shard is a stable URL: set INDEX_URL_A / INDEX_URL_B / … once in Vercel,
// then just re-run this + redeploy. Commit shared/shards.json alongside (the API routes by it).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const dataDir = path.resolve(import.meta.dirname, '../data')
const shards = fs.readdirSync(dataDir).filter((f) => /^index-[a-d]\.sqlite$/.test(f)).sort()
if (!shards.length) {
  console.error('No data/index-*.sqlite shards. Run `npm run index:build` first.')
  process.exit(1)
}
const TAG = 'index-latest'
const run = (args) => execFileSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
try {
  run(['release', 'view', TAG])
} catch {
  run(['release', 'create', TAG, '--title', 'Search index (rolling)', '--notes', 'Rolling build of the search index shards. Uploaded by scripts/upload-index.mjs; see docs/refresh.md.'])
}
const repo = run(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
for (const f of shards) {
  const full = path.join(dataDir, f)
  console.log(`uploading ${f} (${(fs.statSync(full).size / 1e6).toFixed(0)} MB)…`)
  execFileSync('gh', ['release', 'upload', TAG, full, '--clobber'], { stdio: 'inherit' })
  const letter = f.match(/^index-([a-d])/)[1].toUpperCase()
  console.log(`  INDEX_URL_${letter} = https://github.com/${repo}/releases/download/${TAG}/${f}`)
}
console.log('Commit shared/shards.json if it changed, then redeploy (git push).')
