import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:5180'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('   PAGEERROR:', e.message))
await p.goto(BASE + '/#/editor', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2000)
const buf = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 1200, 900); g.addColorStop(0, '#f7f2e8'); g.addColorStop(1, '#22303f')
  x.fillStyle = g; x.fillRect(0, 0, 1200, 900)
  x.fillStyle = '#c0522e'; x.beginPath(); x.arc(600, 450, 260, 0, Math.PI * 2); x.fill()
  x.fillStyle = '#eee'; x.beginPath(); x.arc(500, 380, 70, 0, Math.PI * 2); x.fill()
  return c.toDataURL('image/png').split(',')[1]
})
await p.setInputFiles('.dropzone input[type=file]', { name: 'tex.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await p.waitForSelector('.editor', { timeout: 20000 })
await p.waitForTimeout(3000)

// signature across the WHOLE preview, so a local flat region cannot mask a change
const sig = () => p.evaluate(() => {
  const cs = [...document.querySelectorAll('.editor .stage canvas')].filter((c) => c.width > 300)
  const c = cs[cs.length - 1]
  if (!c) return 'nocanvas'
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let a = 0, b = 0
  for (let i = 0; i < d.length; i += 4 * 17) { a = (a + d[i] * 7 + d[i + 1] * 13 + d[i + 2] * 19 + d[i + 3]) >>> 0; b = (b + a) >>> 0 }
  return `${c.width}x${c.height}:${a}:${b}`
})
const settle = async (prev, ms = 30000) => {
  const t0 = Date.now()
  let last = prev
  while (Date.now() - t0 < ms) {
    await p.waitForTimeout(500)
    const s = await sig()
    if (s !== prev) { // changed; now wait for it to stop changing
      if (s === last) return s
      last = s
    }
  }
  return last
}
const base = await sig()
console.log('baseline (no effect):', base.split(':')[0])
const FAMILIES = ['Halftone', 'Dither', 'Riso grain', 'Stipple', 'Glyphs', 'Crosshatch', 'Duotone', 'Pixelate', 'ASCII', 'Riso 2-color', 'Riso 4-color', 'Embroidery', 'Thread paint', 'CMYK halftone']
const seen = new Map()
let ok = 0
for (const fam of FAMILIES) {
  await p.getByRole('button', { name: fam, exact: true }).click()
  const s = await settle(base)
  const changed = s !== base && s !== 'nocanvas'
  const unique = !seen.has(s)
  seen.set(s, fam)
  if (changed && unique) ok++
  console.log(`${changed && unique ? 'PASS' : 'FAIL'}  ${fam.padEnd(14)} ${changed ? 'renders' : 'NO CHANGE'}${unique ? '' : ' (identical to ' + seen.get(s) + ')'}`)
  await p.getByRole('button', { name: fam, exact: true }).click()
  await settle(s)
}
console.log(`\n${ok}/14 texture families render a distinct result`)
await browser.close()
