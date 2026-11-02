// Tajima DST writer: the plain stitch format nearly every embroidery machine and program reads.
// A 512-byte text header, then one 3-byte record per needle move in 0.1 mm units (±121 per move;
// longer moves are split), y pointing up. The design is written centred on the middle of its
// stitches, which is where the machine starts. Between runs: a trim (three small jumps, the usual DST convention),
// then jumps to the next run's first stitch.
import type { StitchPlan } from './embroidery'

const NORMAL = 0
const JUMP = 1

// Bit layout from the DST spec (y is already flipped to point up by the caller).
function record(dx: number, dy: number, kind: number): [number, number, number] {
  let b0 = 0, b1 = 0, b2 = 0x03
  let x = dx, y = dy
  if (kind === JUMP) b2 |= 0x80
  if (x > 40) { b2 |= 0x04; x -= 81 }
  if (x < -40) { b2 |= 0x08; x += 81 }
  if (x > 13) { b1 |= 0x04; x -= 27 }
  if (x < -13) { b1 |= 0x08; x += 27 }
  if (x > 4) { b0 |= 0x04; x -= 9 }
  if (x < -4) { b0 |= 0x08; x += 9 }
  if (x > 1) { b1 |= 0x01; x -= 3 }
  if (x < -1) { b1 |= 0x02; x += 3 }
  if (x > 0) { b0 |= 0x01; x -= 1 }
  if (x < 0) { b0 |= 0x02; x += 1 }
  if (y > 40) { b2 |= 0x20; y -= 81 }
  if (y < -40) { b2 |= 0x10; y += 81 }
  if (y > 13) { b1 |= 0x20; y -= 27 }
  if (y < -13) { b1 |= 0x10; y += 27 }
  if (y > 4) { b0 |= 0x20; y -= 9 }
  if (y < -4) { b0 |= 0x10; y += 9 }
  if (y > 1) { b1 |= 0x80; y -= 3 }
  if (y < -1) { b1 |= 0x40; y += 3 }
  if (y > 0) { b0 |= 0x80; y -= 1 }
  if (y < 0) { b0 |= 0x40; y += 1 }
  return [b0, b1, b2]
}

export function writeDst(plan: StitchPlan, label: string): Uint8Array {
  const recs: number[] = []
  let cx = 0, cy = 0 // current position, 0.1 mm, y up, origin at the design centre
  let count = 0
  let minX = 0, maxX = 0, minY = 0, maxY = 0
  const moveTo = (tx: number, ty: number, kind: number) => {
    // split long moves into equal steps of at most 121 units
    const dx = tx - cx, dy = ty - cy
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 121))
    for (let i = 1; i <= n; i++) {
      const nx = cx + Math.round((dx * i) / n) - Math.round((dx * (i - 1)) / n)
      const ny = cy + Math.round((dy * i) / n) - Math.round((dy * (i - 1)) / n)
      recs.push(...record(nx - cx, ny - cy, n > 1 && kind === NORMAL ? JUMP : kind))
      cx = nx
      cy = ny
      count++
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy)
    }
  }
  const midX = plan.box.x + plan.box.w / 2, midY = plan.box.y + plan.box.h / 2
  const unit = (x: number, y: number): [number, number] => [Math.round((x - midX) * 10), Math.round((midY - y) * 10)]
  plan.runs.forEach((run, ri) => {
    if (ri > 0) {
      // trim: three tiny jumps that end where they began
      moveTo(cx + 2, cy + 2, JUMP)
      moveTo(cx - 4, cy - 4, JUMP)
      moveTo(cx + 2, cy + 2, JUMP)
    }
    const [sx, sy] = unit(run.pts[0][0], run.pts[0][1])
    if (sx !== cx || sy !== cy) moveTo(sx, sy, JUMP)
    for (let i = 1; i < run.pts.length; i++) {
      const [x, y] = unit(run.pts[i][0], run.pts[i][1])
      moveTo(x, y, NORMAL)
    }
  })
  recs.push(0x00, 0x00, 0xf3) // end
  count++

  const name = label.replace(/[^\x20-\x7e]/g, '').slice(0, 16).padEnd(16, ' ')
  const pad = (n: number, w: number) => String(Math.abs(Math.round(n))).padStart(w, ' ')
  const head =
    `LA:${name}\r` +
    `ST:${pad(count, 7)}\r` +
    `CO:${pad(0, 3)}\r` +
    `+X:${pad(maxX, 5)}\r` +
    `-X:${pad(-minX, 5)}\r` +
    `+Y:${pad(maxY, 5)}\r` +
    `-Y:${pad(-minY, 5)}\r` +
    `AX:${cx < 0 ? '-' : '+'}${pad(cx, 5)}\r` +
    `AY:${cy < 0 ? '-' : '+'}${pad(cy, 5)}\r` +
    `MX:+${pad(0, 5)}\r` +
    `MY:+${pad(0, 5)}\r` +
    `PD:******\r\x1a`
  const out = new Uint8Array(512 + recs.length)
  out.fill(0x20, 0, 512)
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i)
  out.set(recs, 512)
  return out
}

// Reads a DST back into absolute stitch positions (0.1 mm, y up); used to check what we write.
export function readDst(bytes: Uint8Array): { x: number; y: number; jump: boolean }[] {
  const pts: { x: number; y: number; jump: boolean }[] = []
  let x = 0, y = 0
  for (let i = 512; i + 2 < bytes.length; i += 3) {
    const [b0, b1, b2] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    if (b2 === 0xf3) break
    const bit = (b: number, m: number) => (b & m ? 1 : 0)
    x += bit(b0, 0x01) - bit(b0, 0x02) + 9 * (bit(b0, 0x04) - bit(b0, 0x08)) + 3 * (bit(b1, 0x01) - bit(b1, 0x02)) + 27 * (bit(b1, 0x04) - bit(b1, 0x08)) + 81 * (bit(b2, 0x04) - bit(b2, 0x08))
    y += bit(b0, 0x80) - bit(b0, 0x40) + 9 * (bit(b0, 0x20) - bit(b0, 0x10)) + 3 * (bit(b1, 0x80) - bit(b1, 0x40)) + 27 * (bit(b1, 0x20) - bit(b1, 0x10)) + 81 * (bit(b2, 0x20) - bit(b2, 0x10))
    pts.push({ x, y, jump: !!(b2 & 0x80) })
  }
  return pts
}
