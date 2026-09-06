import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ ...devices['iPhone 13'] })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
const missing = []
page.on('response', (r) => { if (r.url().includes('/paper/') && r.status() >= 400) missing.push(r.url().split('/').pop()) })
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio')
await page.click('.canvas-dock .bg-swatch')
await page.waitForSelector('.bg-pop')
const secs = await page.$$eval('.bg-pop .picker-h', (h) => h.map((x) => x.textContent))
console.log('sections:', secs.join(' / '))
console.log('sheet tiles:', await page.locator('.bg-pop .bg-tile').count())
// scroll the whole picker so every thumbnail loads, then check for 404s
await page.evaluate(async () => {
  const el = document.querySelector('.bg-scroll')
  for (let y = 0; y < el.scrollHeight; y += 200) { el.scrollTop = y; await new Promise((r) => setTimeout(r, 90)) }
})
await page.waitForTimeout(2500)
console.log('missing image files:', missing.length ? missing.join(', ') : 'none')
await page.screenshot({ path: 'data/shots/picker-new.png', fullPage: false })
// apply a couple of the new ones
for (const label of ['Kraft envelope', 'Plywood', 'Graph paper']) {
  await page.locator(`.bg-tile[title="${label}"]`).scrollIntoViewIfNeeded()
  await page.click(`.bg-tile[title="${label}"]`)
  await page.waitForTimeout(1200)
  const ok = await page.locator('.artboard-bg').evaluate((el) => el.naturalWidth > 0).catch(() => false)
  console.log(`applied ${label}:`, ok ? 'loads' : 'FAILED')
  if (label !== 'Graph paper') { await page.click('.canvas-dock .bg-swatch'); await page.waitForSelector('.bg-pop') }
}
await page.screenshot({ path: 'data/shots/canvas-new-sheet.png' })
await browser.close()
