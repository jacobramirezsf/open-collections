import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
// pretend to be iOS: canShare(files) true, share() throws NotAllowedError the first time
await ctx.addInitScript(() => {
  window.__shares = []
  window.__failNext = true
  navigator.canShare = (d) => !!d?.files?.length
  navigator.share = async (d) => {
    if (window.__failNext) { window.__failNext = false; const e = new Error('activation'); e.name = 'NotAllowedError'; throw e }
    window.__shares.push(d.files.map((f) => `${f.name} ${f.type} ${(f.size / 1e6).toFixed(2)}MB`))
  }
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.fill('input[type="search"], .searchbar input', 'tulip painting')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 30000 })
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 15000 })

// 1. MAIN PAGE viewer download → should prompt (activation expired), then share to Photos
await page.click('.viewer button:has-text("Download")')
await page.waitForSelector('.save-prompt', { timeout: 40000 })
console.log('1. viewer download offers Photos:', await page.locator('.save-prompt button:has-text("Save to Photos")').count() ? 'PASS' : 'FAIL')
console.log('   prompt says:', (await page.locator('.save-prompt-title').textContent()) + ' / ' + (await page.locator('.save-prompt .faint').textContent()).slice(0, 60))
await page.click('.save-prompt button:has-text("Save to Photos")')
await page.waitForTimeout(800)
console.log('2. shared to Photos:', await page.evaluate(() => window.__shares), await page.locator('.save-prompt').count() === 0 ? '(prompt closed)' : '(STILL OPEN)')

// 2. EDITOR export → opaque should be JPEG and share directly (activation no longer failing)
await page.click('button:has-text("Edit")')
await page.waitForTimeout(2500)
await page.click('.export-actions button:has-text("Save image")')
await page.waitForTimeout(6000)
if (await page.locator('.save-prompt').count()) { await page.click('.save-prompt button:has-text("Save to Photos")'); await page.waitForTimeout(600) }
const shares = await page.evaluate(() => window.__shares)
console.log('3. editor export:', shares[shares.length - 1])
// 3. with a cutout-style transparent result it must stay PNG
await page.getByRole('button', { name: 'Halftone', exact: true }).click()
await page.waitForTimeout(2000)
const transparentCb = page.locator('.editor input[type="checkbox"]').first()
await page.selectOption('.ctl.row select', 'transparent').catch(() => {})
await page.waitForTimeout(2000)
await page.click('.export-actions button:has-text("Save image")')
await page.waitForTimeout(6000)
if (await page.locator('.save-prompt').count()) { await page.click('.save-prompt button:has-text("Save to Photos")'); await page.waitForTimeout(600) }
const shares2 = await page.evaluate(() => window.__shares)
console.log('4. transparent export:', shares2[shares2.length - 1])
await browser.close()
