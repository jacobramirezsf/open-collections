import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ ...devices['iPhone 13'] })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio', { timeout: 8000 })
console.log('1. opens a canvas:', await page.locator('.vtop .btn.link').textContent())
// seed three pieces
await page.evaluate(() => {
  const mk = (c) => { const cv = document.createElement('canvas'); cv.width = 240; cv.height = 180
    const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 240, 180); return cv.toDataURL() }
  const docs = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))
  docs[0].pieces = [
    { id: 'a', src: mk('#c33'), x: 300, y: 400, scale: 0.4, rotation: 0, w: 240, h: 180 },
    { id: 'b', src: mk('#3a6'), x: 700, y: 400, scale: 0.4, rotation: 0, w: 240, h: 180 },
    { id: 'c', src: mk('#36c'), x: 500, y: 1000, scale: 0.4, rotation: 0, w: 240, h: 180 },
  ]
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(docs))
  location.reload()
})
await page.waitForTimeout(1500)
await page.waitForSelector('.piece')
console.log('2. pieces:', await page.locator('.piece').count())
// marquee-drag across the top two
const ab = await page.locator('.artboard').boundingBox()
await page.mouse.move(ab.x + 6, ab.y + 6)
await page.mouse.down()
await page.mouse.move(ab.x + ab.width - 6, ab.y + ab.height * 0.45, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(500)
console.log('3. marquee selected:', await page.locator('.piece.sel').count(), '(expect 2)')
// move the group together
const before = await page.locator('.piece').first().boundingBox()
const sel0 = await page.locator('.piece.sel').first().boundingBox()
await page.mouse.move(sel0.x + sel0.width / 2, sel0.y + sel0.height / 2)
await page.mouse.down()
await page.mouse.move(sel0.x + sel0.width / 2 + 60, sel0.y + sel0.height / 2 + 30, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(400)
const after = await page.locator('.piece').first().boundingBox()
console.log('4. group moved together:', Math.abs(after.x - before.x) > 30 ? 'PASS' : 'FAIL', '| still selected:', await page.locator('.piece.sel').count())
await page.screenshot({ path: 'data/shots/canvas-multi.png' })
// select all + remove
await page.click('button:has-text("Select all")')
await page.waitForTimeout(300)
console.log('5. select all:', await page.locator('.piece.sel').count(), '(expect 3)')
// export resolution options
const res = await page.$$eval('.canvas-dock select', (ss) => ss.map((s) => [...s.options].map((o) => o.textContent)).find((o) => o[0]?.includes('×')))
console.log('6. export sizes:', res?.join(' / '))
await browser.close()
