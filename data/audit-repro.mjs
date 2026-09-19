import { chromium, devices } from 'playwright'
const BASE = process.argv[2] || 'https://open-collections.com'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

// seed a board with an item so we can drive the contact sheet deterministically
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  localStorage.setItem('open-collections:intro-seen:v1', '1')
  const c = document.createElement('canvas'); c.width = 300; c.height = 300
  const x = c.getContext('2d'); x.fillStyle = '#2a6'; x.fillRect(0, 0, 300, 300)
  const url = c.toDataURL('image/png')
  const mk = (n) => ({ id: `edits:${n}`, source: 'edits', sourceName: 'My edits', sourceUrl: '', title: `Saved ${n}`,
    creator: 'Edited', dateDisplay: '', yearStart: null, yearEnd: null, objectType: 'Edit', medium: '',
    culture: null, place: null, publicDomain: null, rightsLabel: '', licenseUrl: null,
    thumbnailUrl: url, imageUrl: url, originalImageUrl: url, width: null, height: null, contentType: 'image', files: [] })
  localStorage.setItem('open-collections:boards:v1', JSON.stringify([{ id: 'edits', name: 'Edits', createdAt: 1, updatedAt: 1, items: [mk(1), mk(2)] }]))
})

console.log('--- OC-01: contact sheet Back ---')
await page.goto(BASE + '/#/board/edits', { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
console.log('on board, cards:', await page.locator('.card').count(), '| hash:', await page.evaluate(() => location.hash))
await page.click('button:has-text("Select all")')
await page.waitForTimeout(500)
console.log('selected:', await page.locator('.batchbar b').textContent().catch(() => 'n/a'))
await page.click('.batchbar button:has-text("Contact sheet")')
await page.waitForTimeout(1500)
console.log('sheet open:', await page.locator('.sheet').count(), '| hash now:', await page.evaluate(() => location.hash))
await page.click('button:has-text("Back")')
await page.waitForTimeout(1800)
const after = await page.evaluate(() => ({ hash: location.hash, cards: document.querySelectorAll('.card').length }))
const onBoard = await page.locator('.crumb, .statusline').first().textContent().catch(() => '')
console.log('after Back -> hash:', after.hash, '| cards:', after.cards, '| status:', (onBoard || '').trim().slice(0, 60))
console.log('selection still active:', await page.locator('.batchbar').count() ? 'YES' : 'no')

console.log('--- OC-02: reversed date range ---')
await page.goto(BASE + '/?q=cat&from=2000&to=1800', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const body = await page.locator('.empty, .statusline').first().textContent().catch(() => '')
console.log('reversed range URL accepted; shown:', (body || '').trim().slice(0, 90))
await page.click('button:has-text("Filters")')
await page.waitForTimeout(800)
const warn = await page.locator('.filters, .panel').first().innerText().catch(() => '')
console.log('any inline warning near date inputs:', /reversed|swap|after|before|earlier|later/i.test(warn) ? 'yes' : 'NONE')
await browser.close()
