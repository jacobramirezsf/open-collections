import { chromium, devices } from 'playwright'
import fs from 'node:fs'
const BASE = process.argv[2] || 'http://localhost:5180'
const OUT = '/tmp/oc-regression'
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

const newPage = async (mobile) => {
  const ctx = await browser.newContext(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('   PAGEERROR:', e.message))
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1200)
  await p.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1200)
  return p
}

// ---------- search, filters, recovery, pagination ----------
{
  const p = await newPage(false)
  await p.fill('input[type="search"], .searchbar input', 'cat')
  await p.keyboard.press('Enter')
  await p.waitForSelector('.card', { timeout: 40000 })
  const n1 = await p.locator('.card').count()
  check('search returns results', n1 > 0, `${n1} cards`)
  await p.fill('input[type="search"], .searchbar input', 'zzzqqxnonsense')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(5000)
  const empty = await p.locator('.empty').count()
  check('nonsense query gives a clear empty state', empty > 0)
  await p.fill('input[type="search"], .searchbar input', 'cat')
  await p.keyboard.press('Enter')
  await p.waitForSelector('.card', { timeout: 40000 })
  check('recovers from empty state', (await p.locator('.card').count()) > 0)
  // valid range + pagination
  await p.goto(BASE + '/?q=cat&from=1800&to=1900', { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.card', { timeout: 40000 })
  const before = await p.locator('.card').count()
  const more = p.locator('button:has-text("Load")').first()
  if (await more.count()) { await more.click(); await p.waitForTimeout(6000) }
  const after = await p.locator('.card').count()
  check('valid date range + pagination', before > 0 && after >= before, `${before} → ${after}`)
  // reversed range
  await p.goto(BASE + '/?q=cat&from=2000&to=1800', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(5000)
  check('reversed range is explained, not generic advice', (await p.locator('.year-warning').count()) > 0)
  await p.click('.empty .year-warning button:has-text("Swap")')
  await p.waitForTimeout(6000)
  check('swap fixes the range', (await p.evaluate(() => location.search)).includes('from=1800&to=2000') && (await p.locator('.card').count()) > 0)
  await p.context().close()
}

// ---------- favorites, boards, contact sheet ----------
{
  const p = await newPage(false)
  await p.fill('input[type="search"], .searchbar input', 'cat')
  await p.keyboard.press('Enter')
  await p.waitForSelector('.card img.loaded', { timeout: 40000 })
  await p.click('.card >> nth=0')
  await p.waitForSelector('.viewer', { timeout: 20000 })
  await p.click('button:has-text("Favorite")')
  await p.waitForTimeout(800)
  await p.locator('.viewer button:has-text("Back")').first().click()
  await p.waitForTimeout(1000)
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(3000)
  const favs = await p.evaluate(() => (JSON.parse(localStorage.getItem('open-collections:boards:v1') || '[]').find((b) => b.id === 'favorites')?.items || []).length)
  check('favorite persists across reload', favs === 1, `${favs} favorite(s)`)
  // board contact sheet round trip with scroll + selection
  await p.goto(BASE + '/#/board/favorites', { waitUntil: 'domcontentloaded' })
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(3000)
  await p.click('button:has-text("Select all")')
  await p.waitForTimeout(600)
  await p.click('.batchbar button:has-text("Contact sheet")')
  await p.waitForTimeout(1500)
  const sheetHash = await p.evaluate(() => location.hash)
  check('contact sheet URL matches the view', sheetHash === '#/sheet', sheetHash)
  await p.click('button:has-text("Back")')
  await p.waitForTimeout(2000)
  const back = await p.evaluate(() => ({ hash: location.hash, cards: document.querySelectorAll('.card').length, sel: !!document.querySelector('.batchbar') }))
  check('Back restores the board', back.hash === '#/board/favorites' && back.cards === 1, JSON.stringify(back))
  check('Back restores the selection', back.sel)
  // board-level entry point too
  await p.click('button:has-text("Contact sheet")')
  await p.waitForTimeout(1500)
  await p.click('button:has-text("Back")')
  await p.waitForTimeout(1800)
  check('board-level contact sheet returns to the board', (await p.evaluate(() => location.hash)) === '#/board/favorites')
  await p.context().close()
}
console.log(`\n${pass} passed, ${fail} failed`)
