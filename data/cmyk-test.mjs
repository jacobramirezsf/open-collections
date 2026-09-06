import { chromium, devices } from 'playwright'
import fs from 'node:fs'
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
await page.click('button:has-text("CMYK halftone")')
await page.waitForTimeout(2500)
await page.selectOption('.ctl.row select', 'transparent')
await page.waitForTimeout(2500)
const r = await page.evaluate(() => {
  const c = document.querySelector('.editor .stage canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let clear = 0, opaque = 0
  for (let i = 3; i < d.length; i += 4) { if (d[i] < 8) clear++; else if (d[i] > 200) opaque++ }
  const n = d.length / 4
  return { transparentPct: +(clear / n).toFixed(3), opaquePct: +(opaque / n).toFixed(3) }
})
console.log('CMYK with transparent selected:', r, r.transparentPct > 0.2 ? 'PASS (background is transparent)' : 'FAIL (still filled)')
await page.screenshot({ path: 'data/shots/cmyk-transparent.png' })
await browser.close()
