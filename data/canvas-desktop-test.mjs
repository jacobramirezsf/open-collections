import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio', { timeout: 8000 })
// add an upload piece twice via data URL injection is complex; use picker only if boards exist.
// Instead simulate: seed pieces directly through the store.
await page.evaluate(() => new Promise((res) => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 200
  const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 300, 200)
  x.fillStyle = '#fff'; x.font = '40px serif'; x.fillText('A', 130, 120)
  const raw = localStorage.getItem('open-collections:canvases:v1')
  const docs = JSON.parse(raw || '[]')
  const d = docs[0]
  d.pieces = [
    { id: 'p1', src: c.toDataURL(), x: 400, y: 400, scale: 0.8, rotation: 0, w: 300, h: 200 },
    { id: 'p2', src: c.toDataURL(), x: 650, y: 600, scale: 0.5, rotation: 15, w: 300, h: 200 },
  ]
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(docs))
  location.reload()
  res(null)
}))
await page.waitForTimeout(1200)
await page.waitForSelector('.piece', { timeout: 8000 })
console.log('pieces:', await page.locator('.piece').count())
// select first piece, wheel-scale it
const p1 = page.locator('.piece').first()
await p1.click()
const before = await p1.evaluate((el) => el.getBoundingClientRect().width)
await p1.hover()
await page.mouse.wheel(0, -400)
await page.waitForTimeout(500)
const after = await p1.evaluate((el) => el.getBoundingClientRect().width)
console.log('wheel scale:', before.toFixed(0), '→', after.toFixed(0), after > before ? 'OK' : 'FAIL')
// arrow nudge
const bx = await p1.evaluate((el) => el.getBoundingClientRect().x)
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
const ax = await p1.evaluate((el) => el.getBoundingClientRect().x)
console.log('nudge x:', bx.toFixed(0), '→', ax.toFixed(0), ax > bx ? 'OK' : 'FAIL')
// delete second piece
await page.locator('.piece').nth(1).click()
await page.keyboard.press('Backspace')
await page.waitForTimeout(300)
console.log('after delete pieces:', await page.locator('.piece').count())
// undo (cmd+z)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
console.log('after undo pieces:', await page.locator('.piece').count())
await page.screenshot({ path: 'data/shots/canvas-desktop.png' })
await browser.close()
