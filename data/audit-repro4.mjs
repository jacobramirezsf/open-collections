import { chromium, devices } from 'playwright'
const BASE = process.argv[2] || 'https://open-collections.com'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1500)
await p.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await p.reload({ waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1500)

const offscreen = async (sel, label) => {
  const els = p.locator(sel)
  const n = await els.count()
  const vw = p.viewportSize().width
  let hidden = []
  for (let i = 0; i < n; i++) {
    const b = await els.nth(i).boundingBox().catch(() => null)
    if (b && (b.x + b.width > vw + 1 || b.x < -1)) hidden.push((await els.nth(i).textContent()).trim().slice(0, 22))
  }
  console.log(`  ${label}: ${n} controls, ${hidden.length}需 sideways scroll -> ${hidden.join(' | ') || 'none'}`)
}

console.log('--- UX-01: mobile canvas dock ---')
await p.click('button:has-text("Canvas")')
await p.waitForSelector('.canvas-studio')
await p.evaluate(() => {
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = 150
  const x = cv.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 200, 150)
  const d = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))
  d[0].pieces = [{ id: 'a', src: cv.toDataURL(), x: 500, y: 600, scale: .6, rotation: 0, w: 200, h: 150 }]
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(d)); location.reload()
})
await p.waitForTimeout(2000)
await offscreen('.canvas-dock .chips > *', 'canvas dock row 1')
await p.click('.piece'); await p.waitForTimeout(500)
await offscreen('.canvas-dock .chips:nth-of-type(2) > *', 'canvas selected row')
const saveBtn = await p.locator('.canvas-dock button:has-text("Save to Edits")').boundingBox().catch(() => null)
console.log('  Save to Edits x-position:', saveBtn ? Math.round(saveBtn.x) + ' (viewport ' + p.viewportSize().width + ')' : 'not found')
await p.screenshot({ path: 'data/shots/audit-mobile-canvas.png' })

console.log('--- UX-01: mobile editor dock ---')
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await p.fill('input[type="search"], .searchbar input', 'cat portrait')
await p.keyboard.press('Enter')
await p.waitForSelector('.card img.loaded', { timeout: 40000 })
await p.click('.card >> nth=0')
await p.waitForSelector('.viewer', { timeout: 20000 })
await p.click('button:has-text("Edit")')
await p.waitForTimeout(3000)
await offscreen('.editor .chips > *', 'editor chips')
await offscreen('.export-actions > *', 'editor export row')
await p.screenshot({ path: 'data/shots/audit-mobile-editor.png' })
await browser.close()
