import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
const sent = []
await page.route('**/api/vectorize', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}')
  // measure what the client sent: size, and whether the erased corner is transparent
  const m = body.image.match(/^data:image\/png;base64,(.+)$/)
  sent.push({ model: body.model, bytes: m ? Buffer.from(m[1], 'base64').length : 0 })
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c33"/></svg>', model: body.model, sandbox: false }) })
})
await page.goto('http://localhost:5180/#/vectorize', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
const buf = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 2400; c.height = 1600
  const x = c.getContext('2d'); x.fillStyle = '#eee'; x.fillRect(0, 0, 2400, 1600)
  x.fillStyle = '#c33'; x.beginPath(); x.arc(1200, 800, 500, 0, Math.PI * 2); x.fill()
  return c.toDataURL('image/png').split(',')[1]
})
await page.setInputFiles('.dropzone input[type=file]', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await page.waitForSelector('.vt-compare')
console.log('1. picked:', await page.locator('.vt-pane figcaption').first().textContent(), '| prep buttons:', await page.$$eval('.vt-prep button', (b) => b.map((x) => x.textContent.trim()).join(', ')))
// crop
await page.click('.vt-prep button:has-text("Crop")')
await page.waitForSelector('.crop-tool')
console.log('2. crop tool open:', await page.locator('.crop-tool').count())
await page.click('.crop-tool button.primary:has-text("Crop")')
await page.waitForSelector('.crop-tool', { state: 'detached' })
console.log('3. after crop:', await page.locator('.vt-pane figcaption').first().textContent(), '| prep buttons:', await page.$$eval('.vt-prep button', (b) => b.map((x) => x.textContent.trim()).join(', ')))
// erase: paint a stroke across the middle
await page.click('.vt-prep button:has-text("Erase")')
await page.waitForSelector('.mask-tool')
console.log('4. mask tool open:', await page.locator('.mask-tool').count())
const st = await page.locator('.mask-stage').boundingBox()
await page.mouse.move(st.x + st.width * 0.3, st.y + st.height * 0.5)
await page.mouse.down()
for (let i = 0; i <= 20; i++) await page.mouse.move(st.x + st.width * (0.3 + 0.4 * i / 20), st.y + st.height * 0.5)
await page.mouse.up()
await page.waitForTimeout(300)
await page.click('.mask-tool button:has-text("Apply")')
await page.waitForSelector('.mask-tool', { state: 'detached' })
console.log('5. after erase:', await page.locator('.vt-pane figcaption').first().textContent())
// is the preview transparent where we painted?
const alpha = await page.evaluate(async () => {
  const img = document.querySelector('.vt-pane img'); await new Promise((r) => (img.complete ? r() : (img.onload = r)))
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
  const x = c.getContext('2d'); x.drawImage(img, 0, 0)
  const mid = x.getImageData(c.width / 2 | 0, c.height / 2 | 0, 1, 1).data[3]
  const corner = x.getImageData(2, 2, 1, 1).data[3]
  return { mid, corner }
})
console.log('6. preview alpha centre (erased):', alpha.mid, '| corner (kept):', alpha.corner)
await page.click('.vt-actions button.primary:has-text("Vectorize")')
await page.waitForSelector('img[alt="Vectorized"]', { timeout: 20000 })
console.log('7. sent to API:', JSON.stringify(sent[0]), '| result caption:', await page.locator('.vt-pane figcaption').nth(1).textContent())
await page.screenshot({ path: 'data/shots/vectorize-tools.png' })
// undo edits clears the vector and restores the upload
await page.click('.vt-prep button:has-text("Undo edits")')
await page.waitForTimeout(300)
console.log('8. after undo:', await page.locator('.vt-pane figcaption').first().textContent(), '| vector cleared:', (await page.locator('.vt-compare.two').count()) === 0)
await browser.close()
