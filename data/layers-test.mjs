import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ ...devices['iPhone 13'] })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio')
await page.evaluate(() => {
  const mk = (c) => { const cv = document.createElement('canvas'); cv.width = 200; cv.height = 150
    const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 200, 150); return cv.toDataURL() }
  const docs = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))
  docs[0].pieces = [
    { id: 'a', src: mk('#c33'), x: 450, y: 500, scale: .5, rotation: 0, w: 200, h: 150, title: 'red' },
    { id: 'b', src: mk('#3a6'), x: 550, y: 560, scale: .5, rotation: 0, w: 200, h: 150, title: 'green' },
  ]
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(docs))
  location.reload()
})
await page.waitForTimeout(1500)
console.log('1. layer rows:', await page.locator('.layerrow').count(), '| lock buttons:', await page.locator('.layerlock').count())
// select the back layer via the strip, move it forward
await page.locator('.layerrow').last().locator('.layerthumb').click()
await page.waitForTimeout(400)
console.log('2. reorder controls on selected row:', await page.locator('.layermove button').count())
const orderBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('open-collections:canvases:v1'))[0].pieces.map((p) => p.id).join(','))
await page.locator('.layermove button >> nth=0').click()
await page.waitForTimeout(600)
const orderAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('open-collections:canvases:v1'))[0].pieces.map((p) => p.id).join(','))
console.log('3. bring forward:', orderBefore, '->', orderAfter, orderBefore !== orderAfter ? 'PASS' : 'FAIL')
// lock it, then try to drag it on the artboard
await page.locator('.layerrow').first().locator('.layerlock').click()
await page.waitForTimeout(600)
const locked = await page.evaluate(() => JSON.parse(localStorage.getItem('open-collections:canvases:v1'))[0].pieces.filter((p) => p.locked).length)
console.log('4. locked layers:', locked)
const piece = await page.locator('.piece').last().boundingBox()
const posBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('open-collections:canvases:v1'))[0].pieces.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '))
await page.mouse.move(piece.x + piece.width / 2, piece.y + piece.height / 2)
await page.mouse.down(); await page.mouse.move(piece.x + 120, piece.y + 90, { steps: 8 }); await page.mouse.up()
await page.waitForTimeout(600)
const posAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('open-collections:canvases:v1'))[0].pieces.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '))
console.log('5. drag on a locked layer:', posBefore, '->', posAfter, posBefore === posAfter ? 'PASS (held in place)' : 'moved')
await page.screenshot({ path: 'data/shots/layers.png' })
await browser.close()
