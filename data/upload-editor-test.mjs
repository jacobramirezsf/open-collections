import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/#/editor', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
console.log('1. dropzone:', await page.locator('.dropzone').count(), '| heading:', await page.locator('.intro-title').textContent())
// make a test image and upload it
const buf = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 700
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 900, 700); g.addColorStop(0, '#eee'); g.addColorStop(1, '#334')
  x.fillStyle = g; x.fillRect(0, 0, 900, 700)
  x.fillStyle = '#c33'; x.beginPath(); x.arc(450, 350, 200, 0, Math.PI * 2); x.fill()
  return c.toDataURL('image/png').split(',')[1]
})
await page.setInputFiles('.dropzone input[type=file]', { name: 'my-photo.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await page.waitForSelector('.editor', { timeout: 15000 })
await page.waitForTimeout(2500)
console.log('2. editor opened on the upload:', await page.locator('.editor').count())
const chips = await page.$$eval('.editor .chips button', (b) => b.map((x) => x.textContent.trim()))
console.log('   tools:', chips.slice(0, 8).join(', '))
const actions = await page.$$eval('.export-actions button', (b) => b.map((x) => x.textContent.trim()))
console.log('3. export row:', actions.join(', '), '| Save to Edits hidden:', actions.some((a) => /Save to Edits/.test(a)) ? 'NO (wrong)' : 'yes')
// an effect works
await page.getByRole('button', { name: 'Halftone', exact: true }).click()
await page.waitForTimeout(2500)
const drawn = await page.evaluate(() => { const c = document.querySelector('.editor .stage canvas'); return c.width + 'x' + c.height })
console.log('4. effect renders on the upload:', drawn)
await page.screenshot({ path: 'data/shots/upload-editor.png' })
// export downloads
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.export-actions button:has-text("Download")')])
console.log('5. export:', dl.suggestedFilename())
await browser.close()
