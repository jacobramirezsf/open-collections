// Production verification on mobile emulation: Canvas studio, thread paint, deckle surface.
import { chromium, devices } from 'playwright'

const OUT = 'data/shots'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 160)) })

await page.goto('https://open-collections.com/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

// 1. Canvas studio opens
const canvasBtn = page.locator('button:has-text("Canvas")')
console.log('canvas button count:', await canvasBtn.count())
if (await canvasBtn.count()) {
  await canvasBtn.first().click()
  await page.waitForTimeout(1200)
  const studio = await page.locator('.canvas-studio').count()
  console.log('canvas studio open:', studio > 0)
  await page.screenshot({ path: `${OUT}/prod-canvas.png` })
  await page.click('button:has-text("Back")').catch(() => {})
  await page.waitForTimeout(600)
}

// 2. editor: thread paint + deckle surface
await page.fill('input[type="search"], .searchbar input', 'tulip painting')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 30000 })
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 15000 })
await page.click('button:has-text("Edit")')
await page.waitForTimeout(2500)
await page.getByRole('button', { name: 'None', exact: true }).click().catch(() => {})
await page.waitForTimeout(400)
await page.click('button:has-text("Thread paint")')
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/prod-threadpaint.png` })
const sel = page.locator('select:has(option[value="img:deckle-white"])')
if (await sel.count()) {
  await sel.selectOption('img:deckle-white')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/prod-deckle.png` })
  console.log('deckle surface applied')
} else {
  console.log('WARN: deckle option not found on prod')
}
await browser.close()
console.log('done')
