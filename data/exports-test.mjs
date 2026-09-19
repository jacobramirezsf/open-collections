import { chromium } from 'playwright'
import fs from 'node:fs'
const BASE = process.argv[2] || 'http://localhost:5180'
const OUT = '/tmp/oc-exports'
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('   PAGEERROR:', e.message))
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }
const saveAll = async (clicker, expect, ms = 150000) => {
  const got = []
  const onDl = async (dl) => { const path = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(path); got.push(path) }
  p.on('download', onDl)
  await clicker()
  const t0 = Date.now()
  while (got.length < expect && Date.now() - t0 < ms) await p.waitForTimeout(500)
  await p.waitForTimeout(1500)
  p.off('download', onDl)
  return got
}
await p.goto(BASE + '/#/editor', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2000)
const buf = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900
  const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1200, 900)
  g.addColorStop(0, '#f7f2e8'); g.addColorStop(1, '#22303f'); x.fillStyle = g; x.fillRect(0, 0, 1200, 900)
  x.fillStyle = '#c0522e'; x.beginPath(); x.arc(600, 450, 260, 0, Math.PI * 2); x.fill()
  return c.toDataURL('image/png').split(',')[1]
})
await p.setInputFiles('.dropzone input[type=file]', { name: 'exp.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await p.waitForSelector('.editor', { timeout: 20000 })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: 'Halftone', exact: true }).click()
await p.waitForTimeout(4000)

const img = await saveAll(() => p.click('.export-actions button:has-text("Download")'), 1)
if (img[0]) {
  const { execSync } = await import('node:child_process')
  const out = execSync(`python3 -c "from PIL import Image;im=Image.open('${img[0]}');im.load();print(im.size[0],im.size[1],im.mode)"`).toString().trim()
  const [w, h] = out.split(' ').map(Number)
  check('image export: valid file at source size', w === 1200 && h === 900, `${out}, ${(fs.statSync(img[0]).size / 1e3).toFixed(0)}KB`)
} else check('image export', false, 'no file')

const svgs = await saveAll(() => p.click('.export-actions button:has-text("SVG")'), 1)
if (svgs[0]) {
  const t = fs.readFileSync(svgs[0], 'utf8')
  const circles = (t.match(/<circle/g) || []).length
  const vb = (t.match(/viewBox="([^"]+)"/) || [])[1]
  check('SVG export: well-formed vector', t.startsWith('<svg') && t.trim().endsWith('</svg>') && circles > 500, `${circles} circles, viewBox ${vb}`)
} else check('SVG export', false, 'no file')

// CMYK plates: 4 separate SVGs
await p.getByRole('button', { name: 'Halftone', exact: true }).click(); await p.waitForTimeout(2000)
await p.getByRole('button', { name: 'CMYK halftone', exact: true }).click(); await p.waitForTimeout(5000)
const plates = await saveAll(() => p.click('.export-actions button:has-text("Plates")'), 4)
const names = plates.map((x) => x.split('/').pop())
let platesOk = plates.length === 4
for (const f of plates) {
  const t = fs.readFileSync(f, 'utf8')
  if (!t.startsWith('<svg') || !t.trim().endsWith('</svg>')) platesOk = false
}
check('CMYK: four well-formed plate files', platesOk, names.join(', '))
const angles = names.join(' ')
check('CMYK: plates identify their screen angles', /c-cyan-15deg|15deg/.test(angles) && /75deg/.test(angles) && /45deg/.test(angles), angles.slice(0, 110))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
