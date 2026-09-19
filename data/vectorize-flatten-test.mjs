import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)) })
// stacked shapes the way Telos draws them: full circle under a rect, a shape fully hidden, a stroke-only line, a translucent overlay
const RAW = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
  + '<rect width="200" height="200" fill="#eeeeee"/>'
  + '<circle cx="100" cy="100" r="60" fill="#cc3333"/>'
  + '<rect x="30" y="120" width="40" height="20" fill="#00aa00"/>'   // fully hidden under the blue rect
  + '<rect x="20" y="100" width="160" height="80" fill="#3355cc"/>'
  + '<g transform="translate(10 0)"><rect x="120" y="20" width="50" height="50" fill="#ffaa00"/></g>'
  + '<line x1="0" y1="0" x2="200" y2="200" stroke="#000" stroke-width="3"/>'
  + '<rect x="60" y="60" width="60" height="100" fill="#00cc88" fill-opacity="0.5"/>'
  + '</svg>'
await page.route('**/api/vectorize', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ svg: RAW, model: 'arrow-2-telos', sandbox: false }) })
})
await page.goto('http://localhost:5180/#/vectorize', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
const buf = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 200; c.height = 200; return c.toDataURL('image/png').split(',')[1] })
await page.setInputFiles('.dropzone input[type=file]', { name: 'stack.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await page.waitForSelector('.vt-compare')
console.log('1. flatten checkbox default on:', await page.isChecked('.vt-model input[type=checkbox]'))
await page.click('.vt-actions button.primary:has-text("Vectorize")')
await page.waitForSelector('img[alt="Vectorized"]', { timeout: 30000 })
console.log('2. caption:', await page.locator('.vt-pane figcaption').nth(1).textContent())
const cmp = await page.evaluate(async (raw) => {
  const img = document.querySelector('img[alt="Vectorized"]')
  const flat = await (await fetch(img.src)).text()
  const draw = (svg) => new Promise((res) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = 400; c.height = 400; const x = c.getContext('2d'); x.drawImage(i, 0, 0, 400, 400); res(x.getImageData(0, 0, 400, 400).data) }; i.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) })
  const a = await draw(raw), b = await draw(flat)
  let bad = 0, sum = 0
  for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); sum += d; if (d > 60) bad++ }
  const px = a.length / 4
  const count = (s, re) => (s.match(re) || []).length
  return { flatLen: flat.length, rawShapes: count(raw, /<(rect|circle|path|line)\b/g), flatShapes: count(flat, /<(rect|circle|path|line)\b/g), hasCircle: /<circle/.test(flat), pctBad: +(100 * bad / px).toFixed(2), meanDiff: +(sum / px).toFixed(2), head: flat.slice(0, 120), stillHasLine: /stroke/.test(flat) }
}, RAW)
console.log('3. render match raw vs flattened: pixels differing >60:', cmp.pctBad + '%', '| mean diff/px:', cmp.meanDiff)
console.log('4. shapes raw → flat:', cmp.rawShapes, '→', cmp.flatShapes, '| circle now a cut path:', !cmp.hasCircle, '| stroke line kept:', cmp.stillHasLine)
console.log('   head:', cmp.head)
// hidden geometry really gone: the red region must not extend under the blue rect. Take the flattened svg, remove the blue fill, render, and check a pixel that was under it is now background not red
const gone = await page.evaluate(async () => {
  const img = document.querySelector('img[alt="Vectorized"]')
  let flat = await (await fetch(img.src)).text()
  flat = flat.replace(/fill="#3355cc"/g, 'fill="none"').replace(/fill:#3355cc/g, 'fill:none')
  const i = new Image(); await new Promise((r) => { i.onload = r; i.src = URL.createObjectURL(new Blob([flat], { type: 'image/svg+xml' })) })
  const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d'); x.drawImage(i, 0, 0)
  const p = x.getImageData(100, 150, 1, 1).data // centre-bottom of the circle, which was under the blue rect
  const q = x.getImageData(50, 130, 1, 1).data // where the fully hidden green rect was
  return { underBlue: [...p].slice(0, 3), hiddenGreenSpot: [...q].slice(0, 3) }
})
console.log('5. with the blue rect made transparent, what was under it: circle spot', gone.underBlue, '(should be #eee background, not red) | hidden green spot', gone.hiddenGreenSpot, '(should be #eee)')
// toggle off → as drawn (no API call), toggle on → flattened again
await page.click('.vt-model input[type=checkbox]')
await page.waitForFunction(() => document.querySelectorAll('.vt-pane figcaption')[1]?.textContent.includes('as drawn'), null, { timeout: 10000 })
console.log('6. toggle off:', await page.locator('.vt-pane figcaption').nth(1).textContent())
await page.click('.vt-model input[type=checkbox]')
await page.waitForFunction(() => document.querySelectorAll('.vt-pane figcaption')[1]?.textContent.includes('cut'), null, { timeout: 10000 })
console.log('7. toggle on:', await page.locator('.vt-pane figcaption').nth(1).textContent())
await page.screenshot({ path: 'data/shots/vectorize-flatten.png' })
await browser.close()
