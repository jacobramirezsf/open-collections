import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
for (const [name, opts] of [['mobile', devices['iPhone 13']], ['desktop', { viewport: { width: 1280, height: 860 } }]]) {
  const ctx = await browser.newContext(opts)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)
  console.log(name, 'intro shown:', await page.locator('.intro').count())
  await page.screenshot({ path: `data/shots/intro-${name}.png` })
  const btn = await page.locator('.intro-actions .btn').boundingBox()
  const vh = page.viewportSize().height
  console.log(name, 'CTA fully on screen:', btn && btn.y + btn.height <= vh + 1)
  await page.click('.intro-actions .btn')
  await page.waitForTimeout(600)
  console.log(name, 'after dismiss:', await page.locator('.intro').count())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  console.log(name, 'shown again after reload (should be 0):', await page.locator('.intro').count())
  await ctx.close()
}
await browser.close()
