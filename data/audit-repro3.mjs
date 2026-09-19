import { chromium } from 'playwright'
const BASE = process.argv[2] || 'https://open-collections.com'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
const api = []
p.on('response', (r) => { if (/\/api\/(download|image)/.test(r.url())) api.push(`${r.status()} ${decodeURIComponent(r.url()).slice(0, 150)}`) })
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1200)
await p.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await p.goto(BASE + '/patents?q=sewing+machine', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6000)
// open the exact patent from the audit
const target = p.locator('.card[data-id="patents:US7848842B2"]')
console.log('US7848842B2 present:', await target.count())
await (await target.count() ? target : p.locator('.card').first()).click()
await p.waitForSelector('.viewer', { timeout: 20000 })
await p.waitForTimeout(2500)
const txt = await p.locator('.viewer').innerText()
console.log('viewer file section:', txt.split('\n').filter((l) => /figure|sheet|pdf|download/i.test(l)).slice(0, 8).join(' | '))
const fileBtns = p.locator('.viewer .files button, .viewer .files a')
console.log('file buttons:', await fileBtns.count())
for (let i = 0; i < Math.min(3, await fileBtns.count()); i++) {
  const label = (await fileBtns.nth(i).textContent()).trim()
  const [dl] = await Promise.all([
    p.waitForEvent('download', { timeout: 40000 }).catch(() => null),
    fileBtns.nth(i).click(),
  ])
  await p.waitForTimeout(2500)
  const errs = (await p.locator('.viewer').innerText()).split('\n').filter((l) => /fail|error|blocked|unavailable|timed out|could not/i.test(l))
  console.log(`  [${label}] download=${dl ? dl.suggestedFilename() : 'NONE'} err=${errs[0] || 'none'}`)
  if (dl) { const path = '/tmp/' + dl.suggestedFilename(); await dl.saveAs(path); const fs = await import('node:fs'); console.log('     saved bytes:', fs.statSync(path).size) }
}
console.log('api calls:\n  ' + (api.join('\n  ') || 'none'))
await browser.close()
