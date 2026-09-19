import { chromium } from 'playwright'
import fs from 'node:fs'
const BASE = process.argv[2] || 'http://localhost:5180'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto(BASE + '/#/editor', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
// a large source, like the audit's 3572x4096 original
const buf = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 3000; c.height = 3400
  const x = c.getContext('2d')
  x.fillStyle = '#dfe3ea'; x.fillRect(0, 0, 3000, 3400)
  x.fillStyle = '#7a4b2a'; x.beginPath(); x.ellipse(1500, 1700, 900, 1200, 0, 0, Math.PI * 2); x.fill()
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * .25})`; x.fillRect(Math.random() * 3000, Math.random() * 3400, 2, 2) }
  return c.toDataURL('image/png').split(',')[1]
})
await page.setInputFiles('.dropzone input[type=file]', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
await page.waitForSelector('.editor', { timeout: 20000 })
await page.waitForTimeout(3000)
const dims = () => page.evaluate(() => {
  const sel = document.querySelector('.editor select')
  const opt = [...document.querySelectorAll('.editor select option')].find((o) => /×/.test(o.textContent))
  return opt ? opt.textContent.trim() : 'n/a'
})
console.log('1. after upload, export size option:', await dims())
console.log('   disclosure:', (await page.locator('.editor .faint').first().innerText()).replace(/\s+/g, ' ').slice(0, 190))
console.log('2. running standard cutout (on-device model)…')
await page.click('.editor button:has-text("Remove background")')
await page.waitForSelector('button:has-text("Background removed"), .editor .chips button.active', { timeout: 240000 }).catch(() => {})
for (let i = 0; i < 60; i++) { await page.waitForTimeout(3000); const t = await page.locator('.busy-pill').count(); if (!t) break }
await page.waitForTimeout(2000)
console.log('   after cutout, export size option:', await dims())
// now erase
await page.click('.editor button:has-text("Erase / restore")')
await page.waitForSelector('.mask-tool', { timeout: 20000 })
await page.waitForTimeout(1500)
console.log('   mask tool note:', (await page.locator('.mask-dock .faint').last().innerText()).replace(/\s+/g, ' ').slice(0, 150))
const st = await page.locator('.mask-stage').boundingBox()
await page.mouse.move(st.x + st.width / 2 - 60, st.y + st.height / 2)
await page.mouse.down(); for (let i = -60; i < 60; i += 10) await page.mouse.move(st.x + st.width / 2 + i, st.y + st.height / 2); await page.mouse.up()
await page.waitForTimeout(600)
await page.click('.mask-tool button:has-text("Apply")')
await page.waitForTimeout(3000)
console.log('3. after erase, export size option:', await dims())
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('.export-actions button:has-text("Download")')])
const path = '/tmp/res-chain.png'
await dl.saveAs(path)
console.log('4. downloaded:', dl.suggestedFilename(), fs.statSync(path).size, 'bytes')
await browser.close()
