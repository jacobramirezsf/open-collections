import { chromium, devices } from 'playwright'
const BASE = process.argv[2] || 'https://open-collections.com'
const browser = await chromium.launch()

console.log('--- Save to Edits: repeat saves (signed out) ---')
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error' || /quota|storage/i.test(m.text())) console.log('CONSOLE:', m.text().slice(0, 160)) })
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.fill('input[type="search"], .searchbar input', 'cat portrait')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 40000 })
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 20000 })
await page.click('button:has-text("Edit")')
await page.waitForTimeout(3500)
const saveOnce = async (label, effect) => {
  if (effect) { await page.getByRole('button', { name: effect, exact: true }).click(); await page.waitForTimeout(3000) }
  await page.click('.export-actions button:has-text("Save to Edits")')
  const toast = await page.waitForSelector('.toast', { timeout: 60000 }).then((el) => el.textContent()).catch(() => 'NO TOAST')
  await page.waitForTimeout(1200)
  const state = await page.evaluate(() => {
    const raw = localStorage.getItem('open-collections:boards:v1') || '[]'
    const boards = JSON.parse(raw)
    const edits = boards.find((b) => b.id === 'edits')
    return { bytes: raw.length, editCount: edits ? edits.items.length : 0, titles: edits ? edits.items.map((i) => i.title.slice(0, 40)) : [] }
  })
  console.log(`  ${label}: toast="${(toast || '').trim()}" edits=${state.editCount} storage=${(state.bytes / 1e6).toFixed(2)}MB`)
  return state
}
await saveOnce('save 1 (halftone)', 'Halftone')
await saveOnce('save 2 (+CMYK)', 'CMYK halftone')
await saveOnce('save 3 (+dither)', 'Dither')
const fin = await saveOnce('save 4 (+stipple)', 'Stipple')
console.log('  final titles:', fin.titles.join(' | '))
await page.close()

console.log('--- Patent alternate file download ---')
const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
p2.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
const responses = []
p2.on('response', (r) => { if (/\/api\/(download|image)/.test(r.url())) responses.push(`${r.status()} ${r.url().slice(0, 120)}`) })
await p2.goto(BASE + '/patents?q=sewing+machine', { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(6000)
console.log('  patent cards:', await p2.locator('.card').count())
if (await p2.locator('.card').count()) {
  await p2.click('.card >> nth=0')
  await p2.waitForSelector('.viewer', { timeout: 20000 })
  await p2.waitForTimeout(2000)
  const files = await p2.$$eval('.viewer .files button, .viewer .files a, .viewer button', (b) => b.map((x) => x.textContent.trim()).filter((t) => /figure|sheet|pdf|drawing/i.test(t)))
  console.log('  alternate file buttons:', files.slice(0, 6).join(' | ') || 'none found')
  const target = p2.locator('.viewer button, .viewer a').filter({ hasText: /Figure|sheet/i }).first()
  if (await target.count()) {
    const dl = await Promise.all([
      p2.waitForEvent('download', { timeout: 45000 }).catch(() => null),
      target.click(),
    ])
    console.log('  download event:', dl[0] ? dl[0].suggestedFilename() : 'NONE')
    await p2.waitForTimeout(3000)
    const err = await p2.locator('.viewer').innerText()
    const errLine = err.split('\n').find((l) => /fail|error|blocked|unavailable|timed out/i.test(l))
    console.log('  inline error:', errLine || 'none')
  }
}
console.log('  api responses:', responses.join('\n    ') || 'none')
await browser.close()
