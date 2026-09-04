// Reproduce the Save-to-Edits hangs on production (iPhone emulation, throwaway account).
import { chromium, devices } from 'playwright'

const USER = 'octest-' + Math.random().toString(36).slice(2, 8)
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)) })
page.on('requestfailed', (r) => console.log('REQFAIL:', r.url().slice(0, 110), r.failure()?.errorText))
page.on('response', (r) => {
  if (r.url().includes('/api/upload-edit') || r.url().includes('/api/userdata')) console.log('RES', r.status(), r.url().slice(-40))
})

await page.goto('https://open-collections.com/', { waitUntil: 'domcontentloaded' })
const signup = await page.evaluate(async (u) => {
  const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'signup', username: u, password: 'testtest123' }) })
  return { status: r.status, body: await r.text() }
}, USER)
console.log('signup:', signup.status, signup.body.slice(0, 80))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

// --- A. editor save with riso grain on a large image ---
await page.fill('input[type="search"], .searchbar input', 'tulip painting')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 30000 })
// favorite the first item for the canvas step
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 15000 })
const fav = page.locator('button:has-text("Favorite"), button[aria-label*="avorite"], .fav')
if (await fav.count()) { await fav.first().click(); console.log('favorited') } else console.log('WARN no favorite button')
await page.click('button:has-text("Edit")')
await page.waitForTimeout(2500)
await page.getByRole('button', { name: 'None', exact: true }).click().catch(() => {})
await page.waitForTimeout(300)
await page.click('button:has-text("Riso grain")')
await page.waitForTimeout(2500)
console.log('editor: clicking Save to Edits at', new Date().toISOString())
const t0 = Date.now()
await page.click('button:has-text("Save to Edits")')
// wait for toast or 90s
const done = await Promise.race([
  page.waitForSelector('.toast', { timeout: 90000 }).then(async (el) => 'toast: ' + (await el.textContent())),
  page.waitForTimeout(90000).then(() => 'TIMEOUT 90s — still busy: ' + (page.locator('.busy-pill').count())),
])
console.log('editor save result after', ((Date.now() - t0) / 1000).toFixed(1) + 's →', done)
await page.screenshot({ path: 'data/shots/repro-editor-save.png' })

// --- B. canvas save with a favorited (proxied) piece + paper bg ---
await page.click('button:has-text("Back")').catch(() => {})
await page.waitForTimeout(400)
await page.click('.viewer button:has-text("Back"), button:has-text("← Back")').catch(() => {})
await page.waitForTimeout(600)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio', { timeout: 8000 })
await page.click('button:has-text("+ Add image")')
await page.waitForTimeout(800)
const cell = page.locator('.picker-cell')
console.log('picker cells:', await cell.count())
if (await cell.count()) {
  await cell.first().click()
  await page.waitForTimeout(1500)
}
console.log('canvas pieces:', await page.locator('.piece').count())
const bgSel = page.locator('select:has(option[value="paper:crumpled-bright"])')
await bgSel.selectOption('paper:crumpled-bright')
await page.waitForTimeout(500)
console.log('canvas: clicking Save to Edits at', new Date().toISOString())
const t1 = Date.now()
await page.click('button:has-text("Save to Edits")')
const done2 = await Promise.race([
  page.waitForSelector('.toast', { timeout: 90000 }).then(async (el) => 'toast: ' + (await el.textContent())),
  page.waitForTimeout(90000).then(() => 'TIMEOUT 90s'),
])
console.log('canvas save result after', ((Date.now() - t1) / 1000).toFixed(1) + 's →', done2)
await page.screenshot({ path: 'data/shots/repro-canvas-save.png' })
await browser.close()
