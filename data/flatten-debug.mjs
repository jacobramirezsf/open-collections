import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 300)))
await page.goto('http://localhost:5180/#/vectorize', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const RAW = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#eeeeee"/><circle cx="100" cy="100" r="60" fill="#cc3333"/><rect x="30" y="120" width="40" height="20" fill="#00aa00"/><rect x="20" y="100" width="160" height="80" fill="#3355cc"/><g transform="translate(10 0)"><rect x="120" y="20" width="50" height="50" fill="#ffaa00"/></g><line x1="0" y1="0" x2="200" y2="200" stroke="#000" stroke-width="3"/><rect x="60" y="60" width="60" height="100" fill="#00cc88" fill-opacity="0.5"/></svg>'
const out = await page.evaluate(async (raw) => {
  try {
    const m = await import('/src/lib/flattenSvg.ts')
    const r = await m.flattenSvg(raw)
    return { stats: r.stats, svg: r.svg }
  } catch (e) { return { error: e.message, stack: (e.stack || '').slice(0, 600) } }
}, RAW)
console.log(JSON.stringify(out.stats || out.error), '\n', out.stack || '', '\n', (out.svg || '').slice(0, 1500))
await browser.close()
