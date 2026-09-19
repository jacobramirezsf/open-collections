import { chromium, devices } from 'playwright'
import fs from 'node:fs'
const BASE = process.argv[2] || 'http://localhost:5180'
const OUT = '/tmp/oc-canvas'; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }
for (const mobile of [false, true]) {
  const label = mobile ? 'mobile' : 'desktop'
  const ctx = await browser.newContext(mobile ? { ...devices['iPhone 13'], acceptDownloads: true } : { viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('   PAGEERROR:', e.message))
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1200)
  await p.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200)
  await p.click('button:has-text("Canvas")')
  await p.waitForSelector('.canvas-studio', { timeout: 15000 })
  await p.evaluate(() => {
    const mk = (c) => { const cv = document.createElement('canvas'); cv.width = 300; cv.height = 220
      const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 300, 220); return cv.toDataURL() }
    const d = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))
    d[0].pieces = [{ id: 'a', src: mk('#c33'), x: 430, y: 520, scale: .6, rotation: 0, w: 300, h: 220 },
                   { id: 'b', src: mk('#36c'), x: 620, y: 700, scale: .6, rotation: 8, w: 300, h: 220 }]
    localStorage.setItem('open-collections:canvases:v1', JSON.stringify(d)); location.reload()
  })
  await p.waitForTimeout(2500)
  check(`${label}: canvas renders pieces`, (await p.locator('.piece').count()) === 2)
  // text
  await p.click('button:has-text("+ Add text")')
  await p.waitForSelector('.text-pop', { timeout: 10000 })
  await p.fill('.text-pop textarea', 'REGRESSION')
  await p.click('.text-pop button:has-text("Add to canvas")')
  await p.waitForTimeout(4000)
  check(`${label}: text piece added`, (await p.locator('.piece').count()) === 3)
  // save to edits
  await p.locator('.toast').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
  await p.click('.canvas-dock button:has-text("Save to Edits")')
  const toast = await p.waitForSelector('.toast', { timeout: 90000 }).then((e) => e.textContent()).catch(() => 'none')
  await p.waitForTimeout(2000)
  const saved = await p.evaluate(() => (JSON.parse(localStorage.getItem('open-collections:boards:v1') || '[]').find((b) => b.id === 'edits')?.items || []).length)
  check(`${label}: canvas Save to Edits persists`, saved >= 1 && !/fail|full|not kept/i.test(toast || ''), `${saved} item(s), "${(toast || '').trim().slice(0, 46)}"`)
  // export
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }).catch(() => null), p.click('.vtop button:has-text("Download"), .vtop button:has-text("Save")')])
  if (dl) {
    const path = `${OUT}/${label}-${dl.suggestedFilename()}`
    await dl.saveAs(path)
    const { execSync } = await import('node:child_process')
    const out = execSync(`python3 -c "from PIL import Image;im=Image.open('${path}');im.load();print(im.size[0],im.size[1],im.mode)"`).toString().trim()
    check(`${label}: canvas export is a valid image`, /\d+ \d+/.test(out), `${out}, ${(fs.statSync(path).size / 1e6).toFixed(1)}MB`)
  } else check(`${label}: canvas export`, mobile, mobile ? 'share sheet path (no file event expected)' : 'no download')
  await ctx.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
