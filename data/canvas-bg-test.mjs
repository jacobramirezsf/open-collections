import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ ...devices['iPhone 13'] })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio', { timeout: 8000 })
// seed a piece so the export is meaningful
await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 220
  const x = c.getContext('2d'); x.fillStyle = '#1c4c9c'; x.fillRect(20, 20, 260, 180)
  const raw = JSON.parse(localStorage.getItem('open-collections:canvases:v1') || '[]')
  raw[0].pieces = [{ id: 'p1', src: c.toDataURL(), x: 500, y: 550, scale: 0.6, rotation: -6, w: 300, h: 220 }]
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(raw))
  location.reload()
})
await page.waitForTimeout(1200)
const sel = page.locator('select:has(option[value="paper:deckle-white"])')
console.log('deckle option present:', await sel.count())
await sel.selectOption('paper:deckle-white')
await page.waitForTimeout(1000)
await page.screenshot({ path: 'data/shots/canvas-edge-bg.png' })
// export and inspect corner alpha
const info = await page.evaluate(async () => {
  // replicate export quickly via the page's own renderer isn't exposed; just verify style applied
  const el = document.querySelector('.artboard')
  return getComputedStyle(el).backgroundImage.slice(0, 120)
})
console.log('artboard bg:', info)
await browser.close()
