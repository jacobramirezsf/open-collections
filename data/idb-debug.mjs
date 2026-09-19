import { chromium } from 'playwright'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 150)) })
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.fill('input[type="search"], .searchbar input', 'cat portrait')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 40000 })
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 20000 })
await page.click('button:has-text("Edit")')
await page.waitForTimeout(3500)
const keys = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('open-collections-edits', 1)
  r.onsuccess = () => { try { const t = r.result.transaction('edit-blobs', 'readonly').objectStore('edit-blobs').getAllKeys(); t.onsuccess = () => res(t.result); t.onerror = () => res(['ERR']) } catch (e) { res(['NOSTORE']) } }
  r.onerror = () => res(['OPENERR'])
}))
const refs = () => page.evaluate(() => {
  const b = JSON.parse(localStorage.getItem('open-collections:boards:v1') || '[]').find((x) => x.id === 'edits')
  return (b?.items || []).map((i) => `${i.id.slice(0, 28)} => ${String(i.originalImageUrl).slice(0, 26)}`)
})
await page.getByRole('button', { name: 'Halftone', exact: true }).click(); await page.waitForTimeout(3000)
await page.click('.export-actions button:has-text("Save to Edits")'); await page.waitForTimeout(4000)
console.log('after save 1 — idb keys:', JSON.stringify(await keys()))
console.log('             board refs:', JSON.stringify(await refs()))
await page.getByRole('button', { name: 'Dither', exact: true }).click(); await page.waitForTimeout(3000)
await page.click('.export-actions button:has-text("Save to Edits")'); await page.waitForTimeout(4000)
console.log('after save 2 — idb keys:', JSON.stringify(await keys()))
console.log('             board refs:', JSON.stringify(await refs()))

await page.goto('http://localhost:5180/#/board/edits', { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
console.log('after reload — idb keys:', JSON.stringify(await keys()))
const got = await page.evaluate(async () => {
  const raw = JSON.parse(localStorage.getItem('open-collections:boards:v1') || '[]').find((x) => x.id === 'edits')
  const out = []
  for (const it of raw.items) {
    const ref = String(it.originalImageUrl)
    const key = ref.startsWith('idb:') ? ref.slice(4) : null
    const present = key ? await new Promise((res) => { const r = indexedDB.open('open-collections-edits', 1); r.onsuccess = () => { const t = r.result.transaction('edit-blobs','readonly').objectStore('edit-blobs').get(key); t.onsuccess = () => res(!!t.result); t.onerror = () => res(false) } ; r.onerror = () => res(false) }) : 'not-a-ref'
    out.push(key + ' present=' + present)
  }
  const imgs = [...document.querySelectorAll('.card img')].map((i) => (i.getAttribute('src') || '').slice(0, 22))
  return { out, imgs }
})
console.log('  per-item blob present:', JSON.stringify(got.out))
console.log('  rendered srcs:', JSON.stringify(got.imgs))
await browser.close()
