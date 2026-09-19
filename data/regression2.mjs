import { chromium, devices } from 'playwright'
import fs from 'node:fs'
const BASE = process.argv[2] || 'http://localhost:5180'
const OUT = '/tmp/oc-regression'
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('   PAGEERROR:', e.message))
// use the standalone editor so a known image drives every effect deterministically
await p.goto(BASE + '/#/editor', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2000)
const buf = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1600; c.height = 1200
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 1600, 1200); g.addColorStop(0, '#f2ede2'); g.addColorStop(1, '#243447')
  x.fillStyle = g; x.fillRect(0, 0, 1600, 1200)
  x.fillStyle = '#b4472e'; x.beginPath(); x.arc(800, 600, 340, 0, Math.PI * 2); x.fill()
  x.fillStyle = '#1d1d1d'; x.fillRect(200, 980, 1200, 90)
  return c.toDataURL('image/png').split(',')[1]
})
await p.setInputFiles('.dropzone input[type=file]', { name: 'regress.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await p.waitForSelector('.editor', { timeout: 20000 })
await p.waitForTimeout(3000)

const FAMILIES = ['Halftone', 'Dither', 'Riso grain', 'Stipple', 'Glyphs', 'Crosshatch', 'Duotone', 'Pixelate', 'ASCII', 'Riso 2-color', 'Riso 4-color', 'Embroidery', 'Thread paint', 'CMYK halftone']
const sample = () => p.evaluate(() => {
  const cs = [...document.querySelectorAll('.editor .stage canvas')].filter((c) => c.width > 300)
  const c = cs[cs.length - 1]
  if (!c) return null
  const d = c.getContext('2d').getImageData(0, 0, Math.min(c.width, 200), Math.min(c.height, 200)).data
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] * 2 + d[i + 2] * 3
  return { w: c.width, h: c.height, sig: sum }
})
let prev = null, distinct = 0
for (const fam of FAMILIES) {
  await p.getByRole('button', { name: fam, exact: true }).click()
  await p.waitForTimeout(3200)
  const s = await sample()
  const ok = !!s && (!prev || s.sig !== prev.sig)
  if (ok) distinct++
  if (!ok) console.log(`   ${fam}: signature unchanged`)
  prev = s
  await p.getByRole('button', { name: fam, exact: true }).click() // unstack for the next one
  await p.waitForTimeout(1200)
}
check('all 14 texture families render distinctly', distinct === 14, `${distinct}/14`)

// stacking
await p.getByRole('button', { name: 'Halftone', exact: true }).click(); await p.waitForTimeout(2500)
const one = await sample()
await p.getByRole('button', { name: 'Riso grain', exact: true }).click(); await p.waitForTimeout(3000)
const two = await sample()
const stackLine = await p.locator('.stackline').innerText().catch(() => '')
check('effect stacking changes the render and is announced', one.sig !== two.sig && /halftone/i.test(stackLine), stackLine.replace(/\s+/g, ' ').slice(0, 60))

// exports: PNG
const grab = async (label, clicker, name) => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }).catch(() => null), clicker()])
  if (!dl) { check(label, false, 'no download'); return null }
  const path = `${OUT}/${name || dl.suggestedFilename()}`
  await dl.saveAs(path)
  return path
}
await p.getByRole('button', { name: 'Riso grain', exact: true }).click(); await p.waitForTimeout(2500) // back to halftone only
const png = await grab('PNG export downloads', () => p.click('.export-actions button:has-text("Download")'))
if (png) {
  const { execSync } = await import('node:child_process')
  const info = execSync(`python3 -c "from PIL import Image;im=Image.open('${png}');im.load();print(im.size[0],im.size[1],im.mode)"`).toString().trim()
  const [w, h] = info.split(' ').map(Number)
  check('PNG export is a valid image at source size', w === 1600 && h === 1200, `${info}, ${fs.statSync(png).size} bytes`)
}
// SVG
const svg = await grab('SVG export downloads', () => p.click('.export-actions button:has-text("SVG")'))
if (svg) {
  const text = fs.readFileSync(svg, 'utf8')
  const circles = (text.match(/<circle/g) || []).length
  check('SVG export is well-formed vector', text.startsWith('<svg') && text.trim().endsWith('</svg>') && circles > 100, `${circles} circles, ${(fs.statSync(svg).size / 1e3).toFixed(0)}KB`)
}
// CMYK plates
await p.getByRole('button', { name: 'Halftone', exact: true }).click(); await p.waitForTimeout(1500)
await p.getByRole('button', { name: 'CMYK halftone', exact: true }).click(); await p.waitForTimeout(3500)
const plates = []
for (let i = 0; i < 4; i++) {
  const dl = await p.waitForEvent('download', { timeout: 120000 }).catch(() => null)
  if (dl) { const pth = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(pth); plates.push(pth) }
  if (i === 0) continue
}
const platesPromise = (async () => {})()
await platesPromise
check('CMYK plate export produced files', plates.length >= 1, plates.map((x) => x.split('/').pop()).join(', '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
