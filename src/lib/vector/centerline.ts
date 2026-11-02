// Centerline (skeleton) tracing: line art becomes single strokes down the middle of each line,
// the way a plotter pen, a CNC engraving bit or an embroidery running stitch wants it, instead of
// an outline around both edges of every line.
//
//   ink mask → distance transform (line width) → Zhang–Suen thinning + staircase cleanup
//   → skeleton graph (endpoints, junctions, edges, loops) → prune short spurs
//   → join edges through junctions where the line carries straight on → RDP simplify
//   → optional Catmull–Rom smoothing → order paths to cut pen-up travel → SVG strokes.
//
// Coordinates are pixel centres of the traced bitmap. Pure TypeScript, runs in the vector worker.
import type { Mask } from './bitmap'

export interface CenterlineParams {
  prune: number // dead-end branches shorter than this (px) are removed: hair, serifs, noise
  minLength: number // finished paths shorter than this (px) are dropped
  joinAngle: number // carry a line straight through a junction if it bends less than this (deg); 0 = never
  simplify: number // Ramer–Douglas–Peucker tolerance in px
  smooth: number // 0 = straight segments; up to 1 = round Catmull–Rom curves through the points
}

type Pt = [number, number]

export interface Stroke {
  pts: Pt[]
  closed: boolean
  width: number // mean traced line width along the stroke, px
}

export interface CenterlineResult {
  strokes: Stroke[]
  stats: { paths: number; points: number; length: number; travel: number; lineWidth: number }
}

// Chamfer (3,4) distance from each ink pixel to the nearest paper, in px.
function distanceTransform(m: Mask): Float32Array {
  const { w, h, ink } = m
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = ink[i] ? INF : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x])
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4)
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3
  return d
}

// Neighbour offsets clockwise from north: P2..P9 in Zhang–Suen's notation.
const DX = [0, 1, 1, 1, 0, -1, -1, -1]
const DY = [-1, -1, 0, 1, 1, 1, 0, -1]

// Zhang–Suen thinning on a copy padded by one pixel of paper, so neighbour reads never go out of
// bounds. Only pixels still ink are revisited each pass.
function thin(m: Mask): { sk: Uint8Array; W: number; H: number } {
  const W = m.w + 2
  const H = m.h + 2
  const sk = new Uint8Array(W * H)
  let live: number[] = []
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (m.ink[y * m.w + x]) {
        const i = (y + 1) * W + x + 1
        sk[i] = 1
        live.push(i)
      }
  const off = DX.map((dx, k) => DY[k] * W + dx)
  const del: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let step = 0; step < 2; step++) {
      del.length = 0
      for (const i of live) {
        if (!sk[i]) continue
        let b = 0
        let a = 0
        for (let k = 0; k < 8; k++) {
          const v = sk[i + off[k]]
          b += v
          if (!v && sk[i + off[(k + 1) & 7]]) a++
        }
        if (b < 2 || b > 6 || a !== 1) continue
        const p2 = sk[i + off[0]], p4 = sk[i + off[2]], p6 = sk[i + off[4]], p8 = sk[i + off[6]]
        if (step === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0) del.push(i)
      }
      if (del.length) {
        changed = true
        for (const i of del) sk[i] = 0
      }
    }
    live = live.filter((i) => sk[i])
  }
  // Staircase cleanup: Zhang–Suen leaves corner pixels where a diagonal step would do; each one
  // reads as a false junction. A corner pixel whose neighbours form a single arc can go without
  // breaking the line.
  for (const i of live) {
    if (!sk[i]) continue
    const n = off.map((o) => sk[i + o])
    const corner = (n[0] && n[2]) || (n[2] && n[4]) || (n[4] && n[6]) || (n[6] && n[0])
    if (!corner) continue
    let a = 0
    let b = 0
    for (let k = 0; k < 8; k++) {
      b += n[k]
      if (!n[k] && n[(k + 1) & 7]) a++
    }
    if (a === 1 && b >= 2 && b <= 4) sk[i] = 0
  }
  return { sk, W, H }
}

interface Edge {
  a: number // node id at pts[0]
  b: number // node id at the last point (-1 for a closed loop)
  pts: Pt[]
  alive: boolean
}

// Breaks the skeleton into nodes (endpoints and junction clusters) and the edges between them.
function graph(sk: Uint8Array, W: number, H: number): { edges: Edge[]; nodePos: Pt[] } {
  const off = DX.map((dx, k) => DY[k] * W + dx)
  const deg = new Uint8Array(sk.length)
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i]) continue
    let n = 0
    for (const o of off) n += sk[i + o]
    deg[i] = n
  }
  // node id per pixel; adjacent junction pixels share one node at their centroid
  const node = new Int32Array(sk.length).fill(-1)
  const nodePos: Pt[] = []
  const xy = (i: number): Pt => [(i % W) - 1, ((i / W) | 0) - 1]
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || deg[i] === 2 || node[i] >= 0) continue
    const id = nodePos.length
    if (deg[i] < 2) {
      node[i] = id
      nodePos.push(xy(i))
      continue
    }
    const stack = [i]
    node[i] = id
    let sx = 0, sy = 0, n = 0
    while (stack.length) {
      const p = stack.pop()!
      const [x, y] = xy(p)
      sx += x
      sy += y
      n++
      for (const o of off) {
        const q = p + o
        if (sk[q] && deg[q] > 2 && node[q] < 0) {
          node[q] = id
          stack.push(q)
        }
      }
    }
    nodePos.push([sx / n, sy / n])
  }

  const edges: Edge[] = []
  const used = new Uint8Array(sk.length) // interior (degree-2) pixels already on an edge
  const direct = new Set<string>() // node-to-node steps with no interior, seen from either side
  const walk = (from: number, first: number): Edge | null => {
    const a = node[from]
    const pts: Pt[] = [nodePos[a]]
    let prev = from
    let cur = first
    for (;;) {
      if (node[cur] >= 0) {
        if (node[cur] === a && pts.length === 1) return null // a step inside the same junction
        pts.push(nodePos[node[cur]])
        return { a, b: node[cur], pts, alive: true }
      }
      used[cur] = 1
      pts.push(xy(cur))
      let next = -1
      for (const o of off) {
        const q = cur + o
        if (q === prev || !sk[q]) continue
        if (node[q] >= 0 && node[q] !== a) { next = q; break }
        if (node[q] >= 0 && pts.length > 2) { next = q; break }
        if (node[q] < 0 && !used[q]) next = q
      }
      if (next < 0) return pts.length > 1 ? { a, b: a, pts, alive: true } : null // dead end in a junction's shadow
      prev = cur
      cur = next
    }
  }
  for (let i = 0; i < sk.length; i++) {
    if (node[i] < 0) continue
    for (const o of off) {
      const q = i + o
      if (!sk[q]) continue
      if (node[q] >= 0) {
        if (node[q] === node[i]) continue
        const key = node[i] < node[q] ? `${node[i]}-${node[q]}` : `${node[q]}-${node[i]}`
        if (direct.has(key)) continue
        direct.add(key)
        edges.push({ a: node[i], b: node[q], pts: [nodePos[node[i]], nodePos[node[q]]], alive: true })
      } else if (!used[q]) {
        const e = walk(i, q)
        if (e) edges.push(e)
      }
    }
  }
  // what is left are rings with no endpoint or junction: an O, a circle
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || used[i] || node[i] >= 0) continue
    const pts: Pt[] = []
    let prev = -1
    let cur = i
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1
      pts.push(xy(cur))
      let next = -1
      for (const o of off) {
        const q = cur + o
        if (q !== prev && sk[q] && !used[q]) { next = q; break }
      }
      prev = cur
      cur = next
    }
    if (pts.length > 2) edges.push({ a: -1, b: -1, pts: [...pts, pts[0]], alive: true })
  }
  return { edges, nodePos }
}

const len = (pts: Pt[]) => {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return s
}

function degrees(edges: Edge[], n: number): Int32Array {
  const d = new Int32Array(n)
  for (const e of edges) {
    if (!e.alive || e.a < 0) continue
    d[e.a]++
    d[e.b]++
  }
  return d
}

// Removes dead-end branches shorter than `prune` that hang off a junction; twice, since removing
// one spur can leave another exposed.
function pruneSpurs(edges: Edge[], n: number, prune: number): void {
  if (prune <= 0) return
  for (let pass = 0; pass < 2; pass++) {
    const d = degrees(edges, n)
    for (const e of edges) {
      if (!e.alive || e.a < 0 || e.a === e.b) continue
      const spur = (d[e.a] === 1 && d[e.b] >= 3) || (d[e.b] === 1 && d[e.a] >= 3)
      if (spur && len(e.pts) < prune) {
        e.alive = false
        d[e.a]--
        d[e.b]--
      }
    }
  }
}

// Direction a line leaves node `at` along edge e, measured a few px out so pixel steps don't count.
function leaving(e: Edge, at: 'a' | 'b'): Pt {
  const pts = at === 'a' ? e.pts : [...e.pts].reverse()
  const o = pts[0]
  let far = pts[pts.length - 1]
  for (const p of pts) if (Math.hypot(p[0] - o[0], p[1] - o[1]) >= 6) { far = p; break }
  const dx = far[0] - o[0]
  const dy = far[1] - o[1]
  const l = Math.hypot(dx, dy) || 1
  return [dx / l, dy / l]
}

// Chains edges into long strokes: through every node where exactly two edges meet, and through
// junctions where a pair of edges continues within `joinAngle` of straight (the straightest pairs
// first). Fewer, longer strokes mean fewer pen lifts, jumps and trims.
function chain(edges: Edge[], nNodes: number, joinAngle: number): { pts: Pt[]; closed: boolean }[] {
  const live = edges.filter((e) => e.alive)
  const rings = live.filter((e) => e.a < 0).map((e) => ({ pts: e.pts, closed: true }))
  const open = live.filter((e) => e.a >= 0)
  // link[edge*2 + end] = the other (edge*2 + end) it continues into, or -1
  const link = new Int32Array(open.length * 2).fill(-1)
  const ends: number[][] = Array.from({ length: nNodes }, () => [])
  open.forEach((e, i) => {
    ends[e.a].push(i * 2)
    ends[e.b].push(i * 2 + 1)
  })
  const maxBend = (joinAngle * Math.PI) / 180
  for (const list of ends) {
    if (list.length < 2) continue
    const dir = list.map((k) => leaving(open[k >> 1], k & 1 ? 'b' : 'a'))
    if (list.length === 2) {
      link[list[0]] = list[1]
      link[list[1]] = list[0]
      continue
    }
    if (maxBend <= 0) continue
    const pairs: [number, number, number][] = []
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        // straight through = the two leave in opposite directions
        const dot = -(dir[i][0] * dir[j][0] + dir[i][1] * dir[j][1])
        const bend = Math.acos(Math.max(-1, Math.min(1, dot)))
        if (bend <= maxBend) pairs.push([bend, i, j])
      }
    pairs.sort((p, q) => p[0] - q[0])
    const taken = new Set<number>()
    for (const [, i, j] of pairs) {
      if (taken.has(i) || taken.has(j)) continue
      taken.add(i)
      taken.add(j)
      link[list[i]] = list[j]
      link[list[j]] = list[i]
    }
  }
  const done = new Uint8Array(open.length)
  const out: { pts: Pt[]; closed: boolean }[] = []
  const follow = (startEnd: number): { pts: Pt[]; closed: boolean } => {
    // enter edge at `startEnd`, leave by its other end, continue through links
    const pts: Pt[] = []
    let k = startEnd
    let closed = false
    for (;;) {
      const ei = k >> 1
      if (done[ei]) { closed = true; break }
      done[ei] = 1
      const e = open[ei]
      const seg = k & 1 ? [...e.pts].reverse() : e.pts
      pts.push(...(pts.length ? seg.slice(1) : seg))
      const exit = k ^ 1
      const nxt = link[exit]
      if (nxt < 0) break
      k = nxt
    }
    return { pts, closed }
  }
  // open chains start from an unlinked end; whatever remains is a closed chain
  for (let k = 0; k < link.length; k++) if (link[k] < 0 && !done[k >> 1]) out.push(follow(k))
  for (let i = 0; i < open.length; i++) if (!done[i]) out.push(follow(i * 2))
  return [...out, ...rings]
}

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3 || eps <= 0) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    const [ax, ay] = pts[s]
    const [bx, by] = pts[e]
    const dx = bx - ax
    const dy = by - ay
    const l = Math.hypot(dx, dy)
    let best = -1
    let bi = -1
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i]
      const d = l ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / l : Math.hypot(px - ax, py - ay)
      if (d > best) { best = d; bi = i }
    }
    if (best > eps) {
      keep[bi] = 1
      stack.push([s, bi], [bi, e])
    }
  }
  return pts.filter((_, i) => keep[i])
}

// A closed ring's first and last points coincide, so RDP would see a zero-length baseline; split
// it at the point farthest from the start and simplify the two halves.
function simplifyStroke(pts: Pt[], closed: boolean, eps: number): Pt[] {
  if (!closed || pts.length < 4) return rdp(pts, eps)
  let far = 1
  let best = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1])
    if (d > best) { best = d; far = i }
  }
  const a = rdp(pts.slice(0, far + 1), eps)
  const b = rdp(pts.slice(far), eps)
  return [...a, ...b.slice(1)]
}

// Greedy nearest-neighbour ordering, reversing open strokes when their far end is closer, so the
// pen (or needle) jumps as little as possible between strokes.
function order(strokes: Stroke[]): { strokes: Stroke[]; travel: number } {
  const left = strokes.slice()
  const out: Stroke[] = []
  let at: Pt = [0, 0]
  let travel = 0
  while (left.length) {
    let bi = 0
    let bd = Infinity
    let rev = false
    for (let i = 0; i < left.length; i++) {
      const s = left[i]
      const d0 = Math.hypot(s.pts[0][0] - at[0], s.pts[0][1] - at[1])
      if (d0 < bd) { bd = d0; bi = i; rev = false }
      if (!s.closed) {
        const e = s.pts[s.pts.length - 1]
        const d1 = Math.hypot(e[0] - at[0], e[1] - at[1])
        if (d1 < bd) { bd = d1; bi = i; rev = true }
      }
    }
    const s = left.splice(bi, 1)[0]
    if (rev) s.pts.reverse()
    if (out.length) travel += bd
    out.push(s)
    at = s.pts[s.pts.length - 1]
  }
  return { strokes: out, travel }
}

export function traceCenterline(m: Mask, p: CenterlineParams): CenterlineResult {
  const dist = distanceTransform(m)
  const { sk, W, H } = thin(m)
  const { edges, nodePos } = graph(sk, W, H)
  pruneSpurs(edges, nodePos.length, p.prune)
  const chains = chain(edges, nodePos.length, p.joinAngle)
  const widthAt = (pt: Pt) => {
    const x = Math.min(m.w - 1, Math.max(0, Math.round(pt[0])))
    const y = Math.min(m.h - 1, Math.max(0, Math.round(pt[1])))
    return Math.max(1, dist[y * m.w + x] * 2 - 1)
  }
  let strokes: Stroke[] = []
  const widths: number[] = []
  for (const c of chains) {
    if (len(c.pts) < Math.max(1, p.minLength)) continue
    let wsum = 0
    for (const pt of c.pts) wsum += widthAt(pt)
    const width = wsum / c.pts.length
    widths.push(width)
    strokes.push({ pts: simplifyStroke(c.pts, c.closed, p.simplify), closed: c.closed, width })
  }
  const ordered = order(strokes)
  strokes = ordered.strokes
  widths.sort((a, b) => a - b)
  return {
    strokes,
    stats: {
      paths: strokes.length,
      points: strokes.reduce((s, k) => s + k.pts.length, 0),
      length: strokes.reduce((s, k) => s + len(k.pts), 0),
      travel: ordered.travel,
      lineWidth: widths.length ? widths[widths.length >> 1] : 1,
    },
  }
}

const f = (n: number) => (Math.round(n * 100) / 100).toString()

// Path data for a stroke: straight segments, or Catmull–Rom curves turned into cubic Béziers
// (passing through every point; `smooth` scales the tangents, 1 = classic Catmull–Rom).
export function strokePath(s: Stroke, smooth: number): string {
  const pts = s.closed && s.pts.length > 2 && s.pts[0][0] === s.pts[s.pts.length - 1][0] && s.pts[0][1] === s.pts[s.pts.length - 1][1] ? s.pts.slice(0, -1) : s.pts
  if (pts.length < 2) return ''
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  if (smooth <= 0 || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) d += `L${f(pts[i][0])} ${f(pts[i][1])}`
    return s.closed ? d + 'Z' : d
  }
  const n = pts.length
  const get = (i: number): Pt => (s.closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  const k = smooth / 6
  const segs = s.closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k]
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`
  }
  return s.closed ? d + 'Z' : d
}

export function centerlineSvg(r: CenterlineResult, w: number, h: number, smooth: number): string {
  const sw = f(Math.max(1, r.stats.lineWidth))
  const paths = r.strokes.map((s) => `<path d="${strokePath(s, smooth)}" data-width="${f(s.width)}"/>`).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n<g fill="none" stroke="#000" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">\n${paths}\n</g>\n</svg>\n`
}
