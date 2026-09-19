import { chromium } from 'playwright'
const browser = await chromium.launch()
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport: vp })
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  const seen = []
  // mock QuiverAI so the test spends no credits; echo back the model the client sent
  await page.route('**/api/vectorize', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    seen.push({ model: body.model, hasImage: typeof body.image === 'string' && body.image.startsWith('data:image/png'), imgLen: (body.image || '').length })
    await new Promise((r) => setTimeout(r, 400))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 700"><rect width="900" height="700" fill="#eee"/><circle cx="450" cy="350" r="200" fill="#c33"/><text x="20" y="60" font-size="40">${body.model}</text></svg>`
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ svg, model: body.model, sandbox: false }) })
  })
  await page.goto('http://localhost:5180/#/vectorize', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  console.log(`\n== ${vp.width}px ==`)
  console.log('1. landing:', await page.locator('.intro-title').textContent(), '| dropzone:', await page.locator('.dropzone').count(), '| title:', await page.title())
  const buf = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1800; c.height = 1400
    const x = c.getContext('2d'); x.fillStyle = '#eee'; x.fillRect(0, 0, 1800, 1400)
    x.fillStyle = '#c33'; x.beginPath(); x.arc(900, 700, 400, 0, Math.PI * 2); x.fill()
    return c.toDataURL('image/png').split(',')[1]
  })
  await page.setInputFiles('.dropzone input[type=file]', { name: 'my logo.png', mimeType: 'image/png', buffer: Buffer.from(buf, 'base64') })
  await page.waitForSelector('.vt-compare', { timeout: 10000 })
  console.log('2. picked:', await page.locator('.vt-pane figcaption').first().textContent(), '| model options:', await page.$$eval('.vt-model option', (o) => o.map((x) => x.value).join(',')), '| default:', await page.inputValue('.vt-model select'))
  await page.selectOption('.vt-model select', 'arrow-2')
  await page.click('.vt-actions button.primary:has-text("Vectorize")')
  await page.waitForSelector('img[alt="Vectorized"]', { timeout: 20000 })
  console.log('3. result:', await page.locator('.vt-pane figcaption').nth(1).textContent(), '| request:', JSON.stringify(seen[0]))
  const actions = await page.$$eval('.vt-actions button', (b) => b.map((x) => x.textContent.trim()))
  console.log('4. actions:', actions.join(' | '))
  await page.selectOption('.vt-model select', 'arrow-2-telos')
  console.log('5. redo label after switching model:', await page.locator('.vt-actions button:has-text("Redo")').textContent())
  await page.click('.vt-actions button:has-text("Redo")')
  await page.waitForFunction(() => document.querySelector('img[alt="Vectorized"]') && document.querySelectorAll('.vt-pane figcaption')[1]?.textContent.includes('Telos'), null, { timeout: 20000 })
  console.log('6. redo request:', JSON.stringify(seen[1]), '| caption:', await page.locator('.vt-pane figcaption').nth(1).textContent())
  await page.screenshot({ path: `data/shots/vectorize-tool-${vp.width}.png`, fullPage: vp.width < 500 })
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('.vt-actions button:has-text("Download SVG")')])
  const path = await dl.path(); const txt = (await import('node:fs')).readFileSync(path, 'utf8')
  console.log('7. download:', dl.suggestedFilename(), '| starts with <svg:', txt.startsWith('<svg'), '| model in svg:', /arrow-2-telos/.test(txt))
  console.log('8. remembered model:', await page.evaluate(() => localStorage.getItem('oc:quiver-model')))
  await page.click('.vt-actions button:has-text("Another image")')
  console.log('9. back to dropzone:', await page.locator('.dropzone').count())
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  console.log('10. horizontal overflow:', overflow)
  await page.close()
}
await browser.close()
