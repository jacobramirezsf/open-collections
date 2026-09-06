import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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
await page.getByRole('button', { name: 'Halftone', exact: true }).click()
await page.waitForTimeout(2000)
const slider = page.locator('.ctl input[type="range"]').first()
console.log('1. dot size range:', await slider.getAttribute('min'), '→', await slider.getAttribute('max'), 'step', await slider.getAttribute('step'))
for (const v of ['8', '4', '2', '1.5']) {
  const t0 = Date.now()
  await slider.fill(v)
  await page.waitForTimeout(300)
  // wait for the debounced render to settle
  let prev = ''
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250)
    const sig = await page.evaluate(() => {
      const c = document.querySelector('.editor .stage canvas')
      return c.getContext('2d').getImageData(c.width / 2 | 0, c.height / 2 | 0, 40, 40).data.join(',').slice(0, 80)
    })
    if (sig === prev) break
    prev = sig
  }
  const ms = Date.now() - t0
  const ink = await page.evaluate(() => {
    const c = document.querySelector('.editor .stage canvas')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let dark = 0, n = 0
    for (let i = 0; i < d.length; i += 4 * 7) { if (d[i] < 100) dark++; n++ }
    return +(dark / n).toFixed(3)
  })
  console.log(`   cell ${v}px → settled in ~${ms}ms, ink coverage ${ink}`)
  await page.screenshot({ path: `data/shots/ht-${v.replace('.', '_')}.png` })
}
await browser.close()
