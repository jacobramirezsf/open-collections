import { chromium } from 'playwright'
import fs from 'node:fs'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => localStorage.setItem('open-collections:intro-seen:v1', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.click('button:has-text("Canvas")')
await page.waitForSelector('.canvas-studio')
await page.evaluate(() => {
  const mk = (c) => { const cv = document.createElement('canvas'); cv.width = 300; cv.height = 220
    const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 300, 220); return cv.toDataURL() }
  const docs = JSON.parse(localStorage.getItem('open-collections:canvases:v1'))
  docs[0].background = '#ffffff'; docs[0].aspect = 1
  docs[0].pieces = [
    { id: 'a', src: mk('#3366cc'), x: 500, y: 500, scale: 1.2, rotation: 0, w: 300, h: 220 },
    { id: 'b', src: mk('#cc4433'), x: 500, y: 500, scale: 1.2, rotation: 0, w: 300, h: 220, blend: 'multiply' },
  ]
  localStorage.setItem('open-collections:canvases:v1', JSON.stringify(docs)); location.reload()
})
await page.waitForTimeout(1500)
await page.selectOption('.canvas-dock select:has(option[value="1"])', '1').catch(() => {})
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.vtop button:has-text("Download")')])
const path = '/tmp/blend-export.png'
await dl.saveAs(path)
console.log('exported', fs.statSync(path).size, 'bytes')
await browser.close()
