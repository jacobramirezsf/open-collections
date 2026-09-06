import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio')
await page.evaluate(() => {
  const cv = document.createElement('canvas'); cv.width = 300; cv.height = 220
  const x = cv.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 300, 220)
  const docs = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))
  docs[0].pieces = [{ id: 'a', src: cv.toDataURL(), x: 500, y: 600, scale: .8, rotation: 0, w: 300, h: 220 }]
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(docs)); location.reload()
})
await page.waitForTimeout(1500)
await page.click('.piece')
await page.waitForTimeout(400)
console.log('1. Erase action on a selected piece:', await page.locator('.canvas-dock button:has-text("Erase")').count())
await page.click('.canvas-dock button:has-text("Erase")')
await page.waitForSelector('.mask-tool', { timeout: 10000 })
await page.waitForTimeout(800)
const st = await page.locator('.mask-stage').boundingBox()
await page.mouse.move(st.x + st.width / 2 - 90, st.y + st.height / 2)
await page.mouse.down()
for (let i = -90; i < 90; i += 12) await page.mouse.move(st.x + st.width / 2 + i, st.y + st.height / 2)
await page.mouse.up()
await page.waitForTimeout(500)
await page.screenshot({ path: 'data/shots/canvas-erase.png' })
await page.click('.mask-tool button:has-text("Apply")')
await page.waitForTimeout(1500)
const transparent = await page.locator('.piece img').evaluate((el) => new Promise((r) => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64
  const x = c.getContext('2d'); x.drawImage(el, 0, 0, 64, 64)
  const d = x.getImageData(0, 0, 64, 64).data
  let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 8) clear++
  r(+(clear / 4096).toFixed(2))
}))
console.log('2. piece now has erased area:', transparent, transparent > 0.02 ? 'PASS' : 'FAIL')
await page.screenshot({ path: 'data/shots/canvas-erased.png' })
await browser.close()
