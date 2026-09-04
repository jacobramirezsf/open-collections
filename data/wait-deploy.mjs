// Poll production until the JS chunk hash changes from the pre-push value, then exit.
const OLD = process.argv[2]
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 15000))
  try {
    const html = await (await fetch('https://open-collections.com/', { cache: 'no-store' })).text()
    const m = html.match(/assets\/index-[^"]+\.js/)
    if (m && m[0] !== OLD) {
      console.log('DEPLOYED:', m[0])
      process.exit(0)
    }
  } catch {}
}
console.log('TIMEOUT, chunk unchanged:', OLD)
process.exit(1)
