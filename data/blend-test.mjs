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
  const mk = (c) => { const cv = document.createElement('canvas'); cv.width = 300; cv.height = 220
    const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 300, 220); return cv.toDataURL() }
  const docs = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))
  docs[0].background = '#e8dcc8'
  docs[0].pieces = [
    { id: 'a', src: mk('#3366cc'), x: 470, y: 600, scale: .8, rotation: 0, w: 300, h: 220 },
    { id: 'b', src: mk('#cc4433'), x: 560, y: 660, scale: .8, rotation: 0, w: 300, h: 220 },
  ]
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(docs)); location.reload()
})
await page.waitForTimeout(1500)
await page.click('.piece >> nth=1')
await page.waitForTimeout(400)
const sel = page.locator('.canvas-dock select:has(option[value="multiply"])')
console.log('1. blend control present:', await sel.count(), '| modes:', await sel.evaluate((s) => s.options.length))
const sample = () => page.locator('.piece >> nth=0').evaluate(() => {
  const el = document.querySelectorAll('.piece')[1]
  return getComputedStyle(el).mixBlendMode + ' / opacity ' + getComputedStyle(el).opacity
})
console.log('2. before:', await sample())
await sel.selectOption('multiply')
await page.waitForTimeout(500)
console.log('   after multiply:', await sample())
await page.locator('.opacity-ctl input').fill('0.5')
await page.waitForTimeout(500)
console.log('3. opacity:', await sample())
await page.screenshot({ path: 'data/shots/canvas-blend.png' })
// export honours it
const px = await page.evaluate(async () => {
  const doc = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))[0]
  return doc.pieces.map((p) => `${p.id}:${p.blend || 'normal'}@${p.opacity ?? 1}`).join(' ')
})
console.log('4. stored on the piece:', px)
await browser.close()
