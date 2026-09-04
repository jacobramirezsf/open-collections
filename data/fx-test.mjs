// Visual check: embroidery upgrade, thread paint, deckle sheet, fabric swatch (dev :5180)
import { chromium } from 'playwright'

const OUT = '/Users/Jacob/Documents/Makery/projects/open-collections/data/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.fill('input[type="search"], .searchbar input', 'tulip painting')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 30000 })
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 15000 })
await page.click('button:has-text("Edit")')
await page.waitForTimeout(2500)

const shoot = async (name) => {
  await page.waitForTimeout(2200)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}

// drop the default halftone, then single effects
const opts = await page.$$eval('select option', (os) => os.map((o) => o.value))
console.log('select options:', opts.filter((v) => v.startsWith('img:')).join(','))
await page.getByRole('button', { name: 'None', exact: true }).click()
await page.waitForTimeout(400)
// 1. embroidery
await page.click('button:has-text("Embroidery")')
await page.waitForTimeout(200)
console.log('stack1:', await page.locator('.stackline').textContent().catch(() => '(single)'))
await shoot('fx-stitch')

// 2. thread paint (deselect embroidery first)
await page.click('button:has-text("Embroidery")')
await page.click('button:has-text("Thread paint")')
await shoot('fx-threadpaint')

// 3. thread paint + deckle sheet surface (overlay)
await page.selectOption('select:has(option[value="img:ripped-kraft"])', 'img:ripped-kraft')
await shoot('fx-deckle')

// 4. fabric swatch background mode
await page.selectOption('select:has(option[value="img:swatch-navy"])', 'img:swatch-navy')
await page.waitForTimeout(500)
const seg = page.locator('.seg button:has-text("background")')
if (await seg.count()) await seg.click()
await shoot('fx-swatch')

await browser.close()
