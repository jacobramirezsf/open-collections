import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ ...devices['iPhone 13'] })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

// A. canvas button opens NEW, and new canvas resets state
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio')
await page.evaluate(() => {
  const docs = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = 150
  cv.getContext('2d').fillRect(0, 0, 200, 150)
  docs[0].pieces = [{ id: 'z', src: cv.toDataURL(), x: 500, y: 600, scale: .5, rotation: 0, w: 200, h: 150 }]
  docs[0].background = 'paper:kraft'
  docs[0].updatedAt = Date.now() + 1
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(docs))
})
await page.click('.vtop button:has-text("Back")')
await page.waitForTimeout(700)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio')
await page.waitForTimeout(700)
const name = await page.locator('.vtop .btn.link').textContent()
const pieces = await page.locator('.piece').count()
const bg = await page.locator('.canvas-dock select').first().inputValue()
console.log('A. opens NEW canvas:', name, '| pieces:', pieces, '| background reset:', bg, pieces === 0 && bg !== 'paper:kraft' ? 'PASS' : 'FAIL')
await page.click('.vtop button:has-text("Back")')
await page.waitForTimeout(600)

// B. editor opens with no effect
await page.fill('input[type="search"], .searchbar input', 'tulip painting')
await page.keyboard.press('Enter')
await page.waitForSelector('.card img.loaded', { timeout: 30000 })
await page.click('.card >> nth=0')
await page.waitForSelector('.viewer', { timeout: 15000 })
// C. favourite it so we have a board item to remove
const fav = page.locator('button:has-text("Favorite")')
if (await fav.count()) await fav.first().click()
await page.click('button:has-text("Edit")')
await page.waitForTimeout(2500)
const active = await page.$$eval('.editor .chips button', (bs) => bs.filter((b) => b.className.includes('active')).map((b) => b.textContent))
console.log('B. editor opens with effects:', active.length ? active.join(',') : 'none', active.includes('Halftone') ? 'FAIL' : 'PASS')
for (let i = 0; i < 4 && (await page.locator('.viewer').count()); i++) {
  await page.locator('.viewer').last().locator('button:has-text("Back")').first().click().catch(() => {})
  await page.waitForTimeout(700)
}

// C. remove from board via batchbar
await page.evaluate(() => { location.hash = '#/board/favorites'; location.reload() })
await page.waitForTimeout(2500)
console.log('   board items:', await page.locator('.card').count())
await page.click('button:has-text("Select all")')
await page.waitForTimeout(600)
const removeBtn = page.locator('.batchbar button:has-text("Remove from")')
console.log('C. remove-from-board in batchbar:', await removeBtn.count() ? 'PASS' : 'FAIL')
if (await removeBtn.count()) {
  await removeBtn.click()
  await page.waitForTimeout(800)
  console.log('   items after removal:', await page.locator('.card').count())
}
await page.screenshot({ path: 'data/shots/notes-check.png' })
await browser.close()
