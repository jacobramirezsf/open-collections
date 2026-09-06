import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
// A) touch device where share() works immediately: no prompt should appear
const ctxA = await browser.newContext({ ...devices['iPhone 13'] })
await ctxA.addInitScript(() => {
  window.__shares = []
  navigator.canShare = (d) => !!d?.files?.length
  navigator.share = async (d) => { window.__shares.push(d.files[0].name) }
})
const a = await ctxA.newPage()
await a.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await a.waitForTimeout(1200)
await a.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await a.reload({ waitUntil: 'domcontentloaded' })
await a.fill('input[type="search"], .searchbar input', 'tulip painting')
await a.keyboard.press('Enter')
await a.waitForSelector('.card img.loaded', { timeout: 30000 })
await a.click('.card >> nth=0')
await a.waitForSelector('.viewer')
await a.click('.viewer button:has-text("Download")')
await a.waitForTimeout(6000)
console.log('A. direct share (no prompt):', await a.evaluate(() => window.__shares), '| prompt shown:', await a.locator('.save-prompt').count() === 0 ? 'no (correct)' : 'YES (wrong)')
await ctxA.close()

// B) desktop: plain download, never a prompt
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const b = await ctxB.newPage()
const dl = []
b.on('download', (d) => dl.push(d.suggestedFilename()))
await b.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await b.waitForTimeout(1200)
await b.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await b.reload({ waitUntil: 'domcontentloaded' })
await b.fill('input[type="search"], .searchbar input', 'tulip painting')
await b.keyboard.press('Enter')
await b.waitForSelector('.card img.loaded', { timeout: 30000 })
await b.click('.card >> nth=0')
await b.waitForSelector('.viewer')
await b.click('.viewer button:has-text("Download")')
await b.waitForTimeout(6000)
console.log('B. desktop download:', dl, '| prompt shown:', await b.locator('.save-prompt').count() === 0 ? 'no (correct)' : 'YES (wrong)')
await browser.close()
