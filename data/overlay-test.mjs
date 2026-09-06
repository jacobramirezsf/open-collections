import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ ...devices['iPhone 13'] })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.fill('input[type="search"], .searchbar input', 'tulip painting')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 30000 })
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 15000 })
await page.click('button:has-text("Edit")')
await page.waitForTimeout(2500)
const opts = await page.$$eval('.ctl.row select option', (o) => o.map((x) => x.value))
console.log('1. editor menu is a select again:', opts.length, '| garments present:', opts.some((v) => v.startsWith('garment:')) ? 'YES (wrong)' : 'no (correct)')
await page.getByRole('button', { name: 'Halftone', exact: true }).click()
await page.waitForTimeout(1500)
await page.selectOption('.ctl.row select', 'img:crumpled-bright')
await page.waitForTimeout(2500)
const grab = () => page.evaluate(() => {
  const c = document.querySelector('.editor .stage canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  // sample variance inside the artwork area to see whether paper texture reads through the ink
  let sum = 0, sum2 = 0, n = 0
  for (let i = 0; i < d.length; i += 4 * 37) { const v = d[i]; sum += v; sum2 += v * v; n++ }
  const mean = sum / n
  return { mean: +mean.toFixed(1), sd: +Math.sqrt(sum2 / n - mean * mean).toFixed(1) }
})
await page.click('.seg button:has-text("background")')
await page.waitForTimeout(2500)
const bg = await grab()
await page.screenshot({ path: 'data/shots/sheet-background.png' })
await page.click('.seg button:has-text("overlay")')
await page.waitForTimeout(2500)
const ov = await grab()
await page.screenshot({ path: 'data/shots/sheet-overlay.png' })
console.log('2. background mode:', bg, '| overlay mode:', ov)
console.log('   overlay differs from background:', Math.abs(ov.mean - bg.mean) > 2 || Math.abs(ov.sd - bg.sd) > 2 ? 'PASS' : 'FAIL (identical)')
await browser.close()
