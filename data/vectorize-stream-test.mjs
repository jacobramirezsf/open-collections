import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
// replace fetch for /api/vectorize with a slow chunked SSE stream, as the real proxy would deliver it
await page.addInitScript(() => {
  const real = window.fetch.bind(window)
  window.__sent = []
  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.includes('/api/vectorize')) return real(url, init)
    const body = JSON.parse(init.body)
    window.__sent.push({ model: body.model, stream: body.stream, hasImage: body.image.startsWith('data:image/png') })
    const enc = new TextEncoder()
    const parts = ['<rect width="100" height="100" fill="#eee"/>', '<circle cx="50" cy="50" r="30" fill="#c33"/>', '<path d="M10 90 L90 90 L50 60 Z" fill="#333"/>']
    const frames = [
      'event: generating\ndata: {"type":"generating","text":"Tracing shapes"}\n\n',
      'event: draft\ndata: {"type":"draft","id":"x","update_type":"delta","svg":"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 100 100\\">"}\n\n',
      ...parts.map((p) => `event: draft\ndata: ${JSON.stringify({ type: 'draft', id: 'x', update_type: 'delta', svg: p.slice(0, 12) })}\n\nevent: draft\ndata: ${JSON.stringify({ type: 'draft', id: 'x', update_type: 'delta', svg: p.slice(12) })}\n\n`),
      `event: content\ndata: ${JSON.stringify({ type: 'content', id: 'x', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${parts.join('')}</svg>`, credits: 1 })}\n\n`,
      'data: [DONE]\n\n',
    ]
    const stream = new ReadableStream({
      async start(c) {
        for (const f of frames) { await new Promise((r) => setTimeout(r, 350)); c.enqueue(enc.encode(f)); if (init.signal?.aborted) break }
        c.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'x-quiver-model': body.model, 'x-quiver-environment': 'live' } })
  }
})
await page.goto('http://localhost:5180/#/vectorize', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
const buf = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(100, 100, 400, 400); return c.toDataURL('image/png').split(',')[1] })
await page.setInputFiles('.dropzone input[type=file]', { name: 'shape.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await page.waitForSelector('.vt-compare')
await page.click('.vt-actions button.primary:has-text("Vectorize")')
await page.waitForSelector('.vt-live', { timeout: 5000 })
console.log('1. live pane appears:', await page.locator('.vt-live figcaption').textContent())
await page.waitForFunction(() => document.querySelector('.vt-live figcaption')?.textContent.includes('Tracing'), null, { timeout: 5000 })
console.log('2. phase text from generating event:', await page.locator('.vt-live figcaption').textContent())
await page.waitForSelector('.vt-live img', { timeout: 8000 })
const shots = []
let midShot = false
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(150)
  const s = await page.evaluate(async () => {
    const img = document.querySelector('.vt-live img'); if (!img) return null
    try { const r = await fetch(img.src); const t = await r.text(); return { closed: t.endsWith('</svg>'), shapes: (t.match(/<(rect|circle|path)\b/g) || []).length } } catch (e) { return { err: e.message } }
  })
  if (s) shots.push(s)
  if (s && s.shapes >= 2 && !midShot) { midShot = true; await page.screenshot({ path: 'data/shots/vectorize-stream-live.png' }) }
}
console.log('3. drafts drawn while streaming (each is a valid closed SVG, shapes grow):', JSON.stringify(shots))
await page.waitForSelector('.vt-pane:not(.vt-live) img[alt="Vectorized"]', { timeout: 15000 })
console.log('4. final:', await page.locator('.vt-pane figcaption').nth(1).textContent(), '| live pane gone:', (await page.locator('.vt-live').count()) === 0, '| request:', JSON.stringify(await page.evaluate(() => window.__sent[0])))
const final = await page.evaluate(async () => { const img = document.querySelector('img[alt="Vectorized"]'); return (await (await fetch(img.src)).text()) })
console.log('5. final svg is the content event:', final.endsWith('</svg>') && (final.match(/<(rect|circle|path)\b/g) || []).length === 3)
await page.screenshot({ path: 'data/shots/vectorize-stream.png' })
// stop mid-run
await page.click('.vt-actions button:has-text("Redo")')
await page.waitForSelector('.vt-live')
await page.click('.vt-actions ~ p button:has-text("Stop"), p button:has-text("Stop")')
await page.waitForTimeout(400)
console.log('6. after Stop: live pane gone:', (await page.locator('.vt-live').count()) === 0, '| error shown:', await page.locator('p[style*="danger"]').count(), '| previous result kept:', await page.locator('img[alt="Vectorized"]').count())
await browser.close()
