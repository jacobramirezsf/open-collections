import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
// stand in for a banked precise cutout: a transparent PNG on a Cutouts board
await page.evaluate(() => {
  localStorage.setItem('open-collections:intro-seen:v1', '1')
  const c = document.createElement('canvas'); c.width = 400; c.height = 400
  const x = c.getContext('2d')
  x.fillStyle = '#2a6'; x.beginPath(); x.arc(200, 200, 150, 0, Math.PI * 2); x.fill()
  const url = c.toDataURL('image/png')
  const item = { id: 'cutouts:1', source: 'edits', sourceName: 'My cutouts', sourceUrl: '', title: 'Vase · cutout',
    creator: 'Cut out', dateDisplay: '', yearStart: null, yearEnd: null, objectType: 'Cutout', medium: 'precise cutout',
    culture: null, place: null, publicDomain: null, rightsLabel: '', licenseUrl: null,
    thumbnailUrl: url, imageUrl: url, originalImageUrl: url, width: null, height: null, contentType: 'image', files: [] }
  const boards = [{ id: 'cutouts', name: 'Cutouts', createdAt: 1, updatedAt: 1, items: [item] }]
  localStorage.setItem('open-collections:boards:v1', JSON.stringify(boards))
  location.hash = '#/board/cutouts'
  location.reload()
})
await page.waitForTimeout(2500)
console.log('1. Cutouts board opens with:', await page.locator('.card').count(), 'item(s)')
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 10000 })
await page.click('button:has-text("Edit")')
await page.waitForTimeout(3000)
const state = await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.editor .chips button')].find((b) => /Cutout|Background removed/.test(b.textContent))
  return { cutoutChip: chip?.textContent?.trim() || 'none', chipActive: chip?.className.includes('active') || false }
})
console.log('2. reopened cutout recognised as already cut out:', JSON.stringify(state), state.chipActive ? 'PASS' : 'check')
// and the alpha survives an effect
await page.getByRole('button', { name: 'Halftone', exact: true }).click()
await page.waitForTimeout(2500)
const alpha = await page.evaluate(() => {
  const c = document.querySelector('.editor .stage canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 8) clear++
  return +(clear / (d.length / 4)).toFixed(2)
})
console.log('3. transparency kept through an effect:', alpha, alpha > 0.2 ? 'PASS' : 'FAIL')
await page.screenshot({ path: 'data/shots/cutout-reopen.png' })
await browser.close()
