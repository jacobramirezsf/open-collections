import { chromium } from 'playwright'
import fs from 'node:fs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/#/studio', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
// a photo-like scene: sky, skin-tone face, red scarf, dark coat, a tree, some text
const buf = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 700
  const x = c.getContext('2d')
  const sky = x.createLinearGradient(0, 0, 0, 400); sky.addColorStop(0, '#6fa3d8'); sky.addColorStop(1, '#d7e4ef')
  x.fillStyle = sky; x.fillRect(0, 0, 900, 420)
  x.fillStyle = '#7d8f5a'; x.fillRect(0, 420, 900, 280)
  x.fillStyle = '#3d4a2a'; x.beginPath(); x.arc(760, 300, 130, 0, Math.PI * 2); x.fill(); x.fillRect(745, 380, 30, 120)
  x.fillStyle = '#2a2622'; x.fillRect(250, 380, 300, 320)
  x.fillStyle = '#c8322b'; x.fillRect(250, 380, 300, 60)
  const face = x.createRadialGradient(400, 250, 20, 400, 250, 120); face.addColorStop(0, '#f0c9a8'); face.addColorStop(1, '#b9835f')
  x.fillStyle = face; x.beginPath(); x.ellipse(400, 250, 100, 125, 0, 0, Math.PI * 2); x.fill()
  x.fillStyle = '#2b1d14'; x.beginPath(); x.ellipse(400, 150, 105, 45, 0, 0, Math.PI * 2); x.fill()
  x.fillStyle = '#fff'; x.fillRect(60, 560, 140, 90)
  x.fillStyle = '#111'; x.font = 'bold 42px Georgia'; x.fillText('1854', 70, 620)
  return c.toDataURL('image/png').split(',')[1]
})
await page.setInputFiles('.studio-tile:nth-child(1) input[type=file]', { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await page.waitForSelector('.editor', { timeout: 15000 })
await page.waitForTimeout(1200)
const names = process.argv[2] ? process.argv[2].split(',') : ['Salt print', 'Cyanotype', 'Lith print', 'Gum bichromate']
const shots = []
for (const n of names) {
  const t0 = Date.now()
  await page.getByRole('button', { name: n, exact: true }).click()
  await page.waitForTimeout(300)
  await page.waitForFunction(() => !document.querySelector('.editor .busy, .editor .spinner'), null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const info = await page.evaluate(() => {
    const c = document.querySelector('.editor .stage canvas')
    const labels = [...document.querySelectorAll('.controls-wrap .label')].map((l) => l.textContent.split('·')[0].trim())
    return { url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height, labels }
  })
  shots.push({ n, url: info.url })
  console.log(`${n}: ${info.w}x${info.h} in ${Date.now() - t0}ms | ${info.labels.join(', ')}`)
  await page.getByRole('button', { name: n, exact: true }).click() // remove
  await page.waitForTimeout(300)
}
// contact sheet
const sheet = await page.evaluate(async (shots) => {
  const cw = 450, ch = 350, cols = 4
  const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch * 2 + 30 * 2
  const x = c.getContext('2d'); x.fillStyle = '#ddd'; x.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < shots.length; i++) {
    const img = new Image(); await new Promise((r) => { img.onload = r; img.src = shots[i].url })
    const col = i % cols, row = (i / cols) | 0
    x.drawImage(img, col * cw, row * (ch + 30), cw, ch)
    x.fillStyle = '#000'; x.font = 'bold 18px sans-serif'; x.fillText(shots[i].n, col * cw + 8, row * (ch + 30) + ch + 22)
  }
  return c.toDataURL('image/png').split(',')[1]
}, shots)
fs.writeFileSync(process.argv[3] || 'data/shots/altphoto-sheet.png', Buffer.from(sheet, 'base64'))
await browser.close()
