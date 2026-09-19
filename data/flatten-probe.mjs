import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/#/vectorize', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const RAW = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#eeeeee"/><circle cx="100" cy="100" r="60" fill="#cc3333"/><g transform="translate(10 0)"><rect x="120" y="20" width="50" height="50" fill="#ffaa00"/></g><line x1="0" y1="0" x2="200" y2="200" stroke="#000" stroke-width="3"/></svg>'
const probe = await page.evaluate(async (raw) => {
  const candidates = ['/node_modules/.vite/deps/paper.js', '/node_modules/paper/dist/paper-core.js', '/@id/paper']
  let paper = null, used = null
  for (const c of candidates) { try { const m = await import(c); paper = m.default ?? m; used = c; if (paper?.PaperScope) break } catch (e) { /* next */ } }
  if (!paper?.PaperScope) return { error: 'no paper', used }
  const scope = new paper.PaperScope(); scope.setup(new paper.Size(200, 200))
  const root = scope.project.importSVG(raw, { expandShapes: true, insert: true, applyMatrix: true })
  const walk = (it, d = 0) => [{ d, cls: it.className, clipped: it.clipped, clipMask: it.clipMask, closed: it.closed, fill: it.fillColor ? it.fillColor.toCSS(true) : null, area: Math.round(it.area || 0), isPathItem: it instanceof paper.PathItem, isPath: it instanceof paper.Path }, ...(it.children || []).flatMap((c) => walk(c, d + 1))]
  return { used, rootCls: root.className, tree: walk(root), nPathItem: root.getItems({ class: paper.PathItem }).length, nPath: root.getItems({ class: paper.Path }).length, nClipped: root.getItems({ clipped: true }).length, nAll: root.getItems({}).length, nFn: root.getItems({ match: (it) => it instanceof paper.PathItem }).length }
}, RAW)
console.log(JSON.stringify(probe, null, 1))
await browser.close()
