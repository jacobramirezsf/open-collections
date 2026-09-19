import { chromium, devices } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:5180'
const browser = await chromium.launch()
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }
for (const dev of ['iPhone 13', 'Pixel 7']) {
  const ctx = await browser.newContext({ ...devices[dev] })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1500)
  await p.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.fill('input[type="search"], .searchbar input', 'cat')
  await p.keyboard.press('Enter')
  await p.waitForSelector('.card img.loaded', { timeout: 40000 })
  await p.click('.card >> nth=0')
  await p.waitForSelector('.viewer', { timeout: 20000 })
  await p.click('button:has-text("Edit")')
  await p.waitForTimeout(4500)
  check(`${dev}: editor opens`, (await p.locator('.editor').count()) === 1)
  // preview is visible and inside the viewport
  const vp = p.viewportSize()
  const box = await p.evaluate(() => {
    const cs = [...document.querySelectorAll('.editor .stage canvas')].filter((c) => c.width > 300)
    const c = cs[cs.length - 1]
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }
  })
  check(`${dev}: preview visible on screen`, !!box && box.w > 100 && box.h > 100 && box.top >= 0 && box.bottom <= vp.height + 2, box ? `${box.w}x${box.h} top=${box.top} bottom=${box.bottom}/${vp.height}` : 'no canvas')
  // apply an effect
  await p.getByRole('button', { name: 'Halftone', exact: true }).click()
  await p.waitForTimeout(4000)
  const inked = await p.evaluate(() => {
    const cs = [...document.querySelectorAll('.editor .stage canvas')].filter((c) => c.width > 300)
    const c = cs[cs.length - 1]
    const d = c.getContext('2d').getImageData(0, 0, 120, 120).data
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 160) dark++
    return dark
  })
  check(`${dev}: effect renders in the preview`, inked > 50, `${inked} dark px in sample`)
  // controls reachable
  const bar = await p.locator('.export-actions').boundingBox()
  check(`${dev}: export row on screen`, bar && bar.y + bar.height <= vp.height + 2, bar ? `bottom ${Math.round(bar.y + bar.height)}/${vp.height}` : 'missing')
  const names = await p.$$eval('.export-actions button', (b) => b.map((x) => x.textContent.trim()))
  check(`${dev}: save + export present`, names.some((n) => /Save image/i.test(n)) && names.some((n) => /Save to Edits/i.test(n)), names.join(', '))
  // background control and sliders reachable
  const ctl = await p.locator('.ctl.row').first().boundingBox().catch(() => null)
  check(`${dev}: background control reachable`, !!ctl && ctl.x >= -1 && ctl.x + ctl.width <= vp.width + 1)
  check(`${dev}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '))
  await ctx.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
