#!/usr/bin/env node
// Local API server for development: serves api/*.ts handlers (Web Request/Response style) on :3999.
// Uses Node's built-in TypeScript type stripping (Node >= 22.18 / 23.6).
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'

const root = path.resolve(import.meta.dirname, '..')
const port = Number(process.env.PORT || 3999)
const cache = new Map()

async function load(name) {
  const file = path.join(root, 'api', name + '.ts')
  if (!fs.existsSync(file)) return null
  if (!cache.has(file)) cache.set(file, (await import(file)).default)
  return cache.get(file)
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const m = url.pathname.match(/^\/api\/([a-z0-9_-]+)$/)
    const fn = m && (await load(m[1]))
    if (!fn) {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}')
      return
    }
    try {
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req)
      const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' })
      const t0 = Date.now()
      const response = await fn(request)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body) Readable.fromWeb(response.body).pipe(res)
      else res.end()
      console.log(`${response.status} ${url.pathname}${url.search} ${Date.now() - t0}ms`)
    } catch (e) {
      console.error(e)
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message || e) }))
    }
  })
  .listen(port, () => console.log(`api dev server http://localhost:${port}`))
