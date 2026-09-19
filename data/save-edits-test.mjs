import { chromium } from 'playwright'
const BASE = 'http://localhost:5180'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto(BASE + '/#/editor', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
// upload once, save the same treatment twice, then a different one
const buf = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 1100
  const x = c.getContext('2d'); x.fillStyle = '#cfd6e4'; x.fillRect(0, 0, 1400, 1100)
  x.fillStyle = '#333'; x.beginPath(); x.arc(700, 550, 380, 0, Math.PI * 2); x.fill()
  return c.toDataURL('image/png').split(',')[1]
})
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.fill('input[type="search"], .searchbar input', 'cat portrait')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 40000 })
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 20000 })
await page.click('button:has-text("Edit")')
await page.waitForTimeout(3500)
const save = async (label) => {
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  await page.click('.export-actions button:has-text("Save to Edits")')
  const t = await page.waitForSelector('.toast', { timeout: 60000 }).then((e) => e.textContent()).catch(() => 'none')
  await page.waitForTimeout(1500)
  const n = await page.evaluate(() => (JSON.parse(localStorage.getItem('open-collections:boards:v1') || '[]').find((b) => b.id === 'edits')?.items || []).length)
  console.log(`  ${label}: "${(t || '').trim()}" -> ${n} item(s) on Edits`)
}
await page.getByRole('button', { name: 'Halftone', exact: true }).click(); await page.waitForTimeout(3000)
await save('save halftone')
await save('save halftone AGAIN (same treatment)')
await page.getByRole('button', { name: 'Dither', exact: true }).click(); await page.waitForTimeout(3000)
await save('save halftone+dither (new treatment)')
// does the saved image survive a reload?
await page.goto(BASE + '/#/board/edits', { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const ok = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.card img')]
  return { cards: document.querySelectorAll('.card').length, loaded: imgs.filter((i) => i.naturalWidth > 0).length, srcs: imgs.map((i) => i.currentSrc.slice(0, 12)) }
})
console.log('  after reload: cards=' + ok.cards, 'images rendered=' + ok.loaded, 'src kind=' + [...new Set(ok.srcs)].join(','))
const stored = await page.evaluate(() => {
  const raw = localStorage.getItem('open-collections:boards:v1') || ''
  return { kb: Math.round(raw.length / 1024), refs: (raw.match(/idb:/g) || []).length, blobUrls: (raw.match(/blob:/g) || []).length }
})
console.log('  storage:', stored.kb + 'KB,', stored.refs, 'idb refs,', stored.blobUrls, 'stale blob URLs (should be 0)')
await browser.close()
