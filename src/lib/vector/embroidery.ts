// Running-stitch embroidery from the centerline skeleton: turns traced line art into a stitch plan a
// machine can sew quickly and cleanly.
//
//   skeleton graph (px) → merge pass-through nodes → drop details too small to sew → close small
//   gaps between line ends → per connected shape: double back along the cheapest lines so the whole
//   shape is one continuous run (Chinese postman, greedy pairing of odd junctions) → Euler trail,
//   preferring the straightest way on at each junction → running stitches per line (shorter only
//   where a curve needs it; doubled-back passes reuse the same needle holes) → runs ordered to keep
//   jumps short → lock stitches at the start and end of every run.
//
// Every trim costs machine time and a thread tail; a shape sewn in one run has none. Output units
// are mm, y down, origin at the design's top-left.
import { leaving, len, rdp, type Edge, type Pt } from './centerline'

export interface StitchParams {
  widthMm: number // width of the stitched design (not the image around it); everything is measured at this size
  stitchMm: number // running stitch length on straight lines
  minStitchMm: number // shortest stitch allowed on tight curves
  tolMm: number // how far a stitch may cut across a curve
  smoothMm: number // average each line over this distance before stitching (takes out scan wobble)
  linkMm: number // join line ends closer than this, so broken lines sew as one
  minDetailMm: number // drop shapes whose total line length is under this
  route: 'continuous' | 'strokes' // one run per shape (doubling back), or one run per stroke
  ties: boolean // lock stitches at the start and end of each run
}

export interface StitchRun {
  pts: Pt[] // needle points in mm, including lock stitches
}

export interface StitchPlan {
  frameW: number // the whole traced image, mm (what the preview shows, so it lines up with the original)
  frameH: number
  box: { x: number; y: number; w: number; h: number } // the stitched design within it, mm
  runs: StitchRun[]
  stats: { stitches: number; runs: number; trims: number; threadMm: number; doubledMm: number; jumpMm: number }
}

interface GEdge {
  a: number
  b: number
  pts: Pt[] // px
  len: number
}

// ---- graph cleanup -------------------------------------------------------------------------

// Builds a working graph from the skeleton: rings get a node of their own, junctions closer
// together than `minEdge` px collapse into one (thinning turns a single crossing into a cluster
// of junctions a pixel or two apart, and each would force its own needle point), and every node
// where exactly two lines meet is dissolved so each edge runs junction to junction.
function buildGraph(edges: Edge[], nodePos: Pt[], minEdge: number): { nodes: Pt[]; edges: GEdge[] } {
  const nodes = nodePos.slice()
  const out: GEdge[] = []
  for (const e of edges) {
    if (e.a < 0) {
      const id = nodes.length
      nodes.push(e.pts[0])
      out.push({ a: id, b: id, pts: e.pts, len: len(e.pts) })
    } else out.push({ a: e.a, b: e.b, pts: e.pts, len: len(e.pts) })
  }
  return { nodes, edges: mergeThrough(nodes, contractShort(nodes, out, minEdge)) }
}

// Merges the two ends of every edge shorter than `minEdge` into one node at their average, moving
// the ends of the other edges there too. Rings are left alone.
function contractShort(nodes: Pt[], edges: GEdge[], minEdge: number): GEdge[] {
  const parent = nodes.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  let any = false
  for (const e of edges) {
    if (e.a !== e.b && e.len < minEdge) {
      parent[find(e.a)] = find(e.b)
      any = true
    }
  }
  if (!any) return edges
  const sum = new Map<number, [number, number, number]>()
  nodes.forEach((p, i) => {
    const r = find(i)
    const t = sum.get(r) || [0, 0, 0]
    sum.set(r, [t[0] + p[0], t[1] + p[1], t[2] + 1])
  })
  for (const [r, [x, y, c]] of sum) nodes[r] = [x / c, y / c]
  const out: GEdge[] = []
  for (const e of edges) {
    const ring = e.a === e.b
    const a = find(e.a)
    const b = find(e.b)
    if (!ring && a === b && e.len < minEdge) continue // the contracted edge itself
    const pts = e.pts.slice()
    pts[0] = nodes[a]
    pts[pts.length - 1] = nodes[b]
    const l = len(pts)
    if (a === b && l < 3 * minEdge) continue // a loop too small to sew, left over from merging
    out.push({ a, b, pts, len: l })
  }
  return out
}

function mergeThrough(nodes: Pt[], edges: GEdge[]): GEdge[] {
  const inc: number[][] = nodes.map(() => [])
  edges.forEach((e, i) => {
    inc[e.a].push(i)
    if (e.b !== e.a) inc[e.b].push(i)
  })
  const dead = new Uint8Array(edges.length)
  const list = edges.map((e) => ({ ...e }))
  for (let n = 0; n < nodes.length; n++) {
    const live = inc[n].filter((i) => !dead[i])
    if (live.length !== 2 || live[0] === live[1]) continue
    const [i, j] = live
    const ei = list[i]
    const ej = list[j]
    if (ei.a === ei.b || ej.a === ej.b) continue
    // orient both so ei ends at n and ej starts at n
    const pi = ei.b === n ? ei.pts : [...ei.pts].reverse()
    const ai = ei.b === n ? ei.a : ei.b
    const pj = ej.a === n ? ej.pts : [...ej.pts].reverse()
    const bj = ej.a === n ? ej.b : ej.a
    const merged: GEdge = { a: ai, b: bj, pts: [...pi, ...pj.slice(1)], len: ei.len + ej.len }
    dead[j] = 1
    list[i] = merged
    // ej's far node now points at i instead of j
    inc[bj] = inc[bj].map((k) => (k === j ? i : k))
    inc[n] = []
  }
  return list.filter((_, i) => !dead[i])
}

function components(nNodes: number, edges: GEdge[]): number[][] {
  const parent = Array.from({ length: nNodes }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (const e of edges) parent[find(e.a)] = find(e.b)
  const groups = new Map<number, number[]>()
  edges.forEach((e, i) => {
    const r = find(e.a)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(i)
  })
  return [...groups.values()]
}

// Adds a straight edge between line ends closer than `gap` px where the gap looks like a break in
// a line (it carries on in the direction one of the ends was heading), or is very short anyway.
// Each end is joined at most once, nearest pairs first.
function linkGaps(nodes: Pt[], edges: GEdge[], gap: number): GEdge[] {
  if (gap <= 0) return edges
  const deg = new Int32Array(nodes.length)
  const endEdge = new Int32Array(nodes.length).fill(-1)
  edges.forEach((e, i) => {
    deg[e.a]++
    deg[e.b]++
    endEdge[e.a] = i
    endEdge[e.b] = i
  })
  const ends = nodes.map((_, i) => i).filter((i) => deg[i] === 1)
  // direction pointing out of the line at each end
  const outDir = new Map<number, Pt>()
  for (const n of ends) {
    const e = edges[endEdge[n]]
    const d = leaving({ a: e.a, b: e.b, pts: e.pts, alive: true }, e.a === n ? 'a' : 'b')
    outDir.set(n, [-d[0], -d[1]])
  }
  const cell = Math.max(1, gap)
  const grid = new Map<string, number[]>()
  for (const n of ends) {
    const k = `${Math.floor(nodes[n][0] / cell)},${Math.floor(nodes[n][1] / cell)}`
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k)!.push(n)
  }
  const cands: [number, number, number][] = []
  const cos60 = 0.5
  for (const u of ends) {
    const cx = Math.floor(nodes[u][0] / cell)
    const cy = Math.floor(nodes[u][1] / cell)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const v of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (v <= u || endEdge[u] === endEdge[v] && edges[endEdge[u]].len < gap * 2) continue
          const gx = nodes[v][0] - nodes[u][0]
          const gy = nodes[v][1] - nodes[u][1]
          const d = Math.hypot(gx, gy)
          if (d > gap || d === 0) continue
          const du = outDir.get(u)!
          const dv = outDir.get(v)!
          const aligned = (gx * du[0] + gy * du[1]) / d > cos60 || (-gx * dv[0] - gy * dv[1]) / d > cos60
          if (aligned || d <= gap / 2) cands.push([d, u, v])
        }
  }
  cands.sort((p, q) => p[0] - q[0])
  const used = new Set<number>()
  const added: GEdge[] = []
  for (const [d, u, v] of cands) {
    if (used.has(u) || used.has(v)) continue
    used.add(u)
    used.add(v)
    added.push({ a: u, b: v, pts: [nodes[u], nodes[v]], len: d })
  }
  return added.length ? mergeThrough(nodes, [...edges, ...added]) : edges
}

// ---- routing -------------------------------------------------------------------------------

interface Step {
  edge: number // index into the component's edge list (duplicates point at their original)
  fwd: boolean // traversed a → b
  doubled: boolean // a second pass along a line already sewn
}

class Heap {
  private k: number[] = []
  private v: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= k[i]) break
      ;[k[p], k[i]] = [k[i], k[p]]
      ;[v[p], v[i]] = [v[i], v[p]]
      i = p
    }
  }
  pop(): [number, number] {
    const k = this.k, v = this.v
    const top: [number, number] = [k[0], v[0]]
    const lk = k.pop()!, lv = v.pop()!
    if (k.length) {
      k[0] = lk
      v[0] = lv
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < k.length && k[l] < k[m]) m = l
        if (r < k.length && k[r] < k[m]) m = r
        if (m === i) break
        ;[k[m], k[i]] = [k[i], k[m]]
        ;[v[m], v[i]] = [v[i], v[m]]
        i = m
      }
    }
    return top
  }
}

// One continuous trail through a connected shape. Odd junctions are paired up (all but two, which
// become the trail's ends) along shortest paths, nearest pairs first; those paths are sewn twice.
// The trail itself is Hierholzer's, taking the straightest unused line at each junction.
function routeComponent(nodes: Pt[], edges: GEdge[], ids: number[]): Step[] {
  const local = ids.map((i) => edges[i])
  const adj = new Map<number, { e: number; to: number }[]>()
  const addAdj = (n: number, e: number, to: number) => {
    if (!adj.has(n)) adj.set(n, [])
    adj.get(n)!.push({ e, to })
  }
  local.forEach((e, i) => {
    addAdj(e.a, i, e.b)
    if (e.b !== e.a) addAdj(e.b, i, e.a)
  })
  const degree = (n: number) => adj.get(n)!.reduce((s, x) => s + (local[x.e].a === local[x.e].b ? 2 : 1), 0)
  const odd = new Set([...adj.keys()].filter((n) => degree(n) % 2 === 1))

  // multigraph for the trail: originals plus duplicated lines
  const multi: { src: number; a: number; b: number; doubled: boolean }[] = local.map((e, i) => ({ src: i, a: e.a, b: e.b, doubled: false }))
  const nearestOdd = (s: number): { to: number; path: number[]; d: number } | null => {
    const dist = new Map<number, number>([[s, 0]])
    const via = new Map<number, number>()
    const h = new Heap()
    h.push(0, s)
    while (h.size) {
      const [d, n] = h.pop()
      if (d > (dist.get(n) ?? Infinity)) continue
      if (n !== s && odd.has(n)) {
        const path: number[] = []
        for (let x = n; x !== s; ) {
          const e = via.get(x)!
          path.push(e)
          x = local[e].a === x ? local[e].b : local[e].a
        }
        return { to: n, path, d }
      }
      for (const { e, to } of adj.get(n)!) {
        if (to === n) continue
        const nd = d + local[e].len
        if (nd < (dist.get(to) ?? Infinity)) {
          dist.set(to, nd)
          via.set(to, e)
          h.push(nd, to)
        }
      }
    }
    return null
  }
  while (odd.size > 2) {
    const cands: { from: number; to: number; path: number[]; d: number }[] = []
    for (const s of odd) {
      const r = nearestOdd(s)
      if (r) cands.push({ from: s, ...r })
    }
    if (!cands.length) break
    cands.sort((p, q) => p.d - q.d)
    let matched = false
    for (const c of cands) {
      if (odd.size <= 2) break
      if (!odd.has(c.from) || !odd.has(c.to)) continue
      odd.delete(c.from)
      odd.delete(c.to)
      for (const e of c.path) multi.push({ src: e, a: local[e].a, b: local[e].b, doubled: true })
      matched = true
    }
    if (!matched) break
  }

  // Hierholzer over the multigraph
  const madj = new Map<number, number[]>()
  multi.forEach((m, i) => {
    if (!madj.has(m.a)) madj.set(m.a, [])
    madj.get(m.a)!.push(i)
    if (m.b !== m.a) {
      if (!madj.has(m.b)) madj.set(m.b, [])
      madj.get(m.b)!.push(i)
    }
  })
  const used = new Uint8Array(multi.length)
  const start = odd.size ? [...odd][0] : multi[0].a
  // direction of travel as the trail arrives at / leaves a node along an edge
  const tangent = (src: number, fromA: boolean, atStart: boolean): Pt => {
    const e = local[src]
    const end = atStart === fromA ? 'a' : 'b'
    const d = leaving({ a: e.a, b: e.b, pts: e.pts, alive: true }, end)
    return atStart ? d : [-d[0], -d[1]]
  }
  const stack: { n: number; m: number; fwd: boolean }[] = [{ n: start, m: -1, fwd: true }]
  const trail: { m: number; fwd: boolean }[] = []
  while (stack.length) {
    const top = stack[stack.length - 1]
    const list = madj.get(top.n) || []
    let pick = -1
    let best = Infinity
    const inDir = top.m >= 0 ? tangent(multi[top.m].src, top.fwd, false) : null
    for (const i of list) {
      if (used[i]) continue
      if (!inDir) { pick = i; break }
      const fromA = multi[i].a === top.n
      const out = tangent(multi[i].src, fromA, true)
      // prefer going straight on, and prefer first passes over doubled ones on a tie
      const bend = 1 - (inDir[0] * out[0] + inDir[1] * out[1]) + (multi[i].doubled ? 0.01 : 0)
      if (bend < best) { best = bend; pick = i }
    }
    if (pick < 0) {
      stack.pop()
      if (top.m >= 0) trail.push({ m: top.m, fwd: top.fwd })
      continue
    }
    used[pick] = 1
    const m = multi[pick]
    const fwd = m.a === top.n
    stack.push({ n: fwd ? m.b : m.a, m: pick, fwd })
  }
  trail.reverse()
  // the first pass along a line is the real one; any later pass is the doubled one
  const seen = new Uint8Array(local.length)
  return trail.map(({ m, fwd }) => {
    const src = multi[m].src
    const doubled = !!seen[src]
    seen[src] = 1
    return { edge: ids[src], fwd, doubled }
  })
}

// ---- stitching -----------------------------------------------------------------------------

// Catmull–Rom points between simplified vertices, about every 0.15 mm, so stitch placement can
// follow the curve rather than the polygon.
function densify(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts
  const out: Pt[] = [pts[0]]
  const n = pts.length
  const get = (i: number) => pts[Math.max(0, Math.min(n - 1, i))]
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.15))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  return out
}

function chordError(d: Pt[], i: number, j: number): number {
  const [ax, ay] = d[i]
  const [bx, by] = d[j]
  const dx = bx - ax, dy = by - ay
  const l = Math.hypot(dx, dy) || 1
  let worst = 0
  for (let k = i + 1; k < j; k++) worst = Math.max(worst, Math.abs(dy * d[k][0] - dx * d[k][1] + bx * ay - by * ax) / l)
  return worst
}

// Moving average over `radius` mm of arc length, ends pinned (they meet other lines at junctions).
// Traced pixel lines wobble by a fraction of a pixel; left in, every wobble reads as a corner and
// collects a cluster of tiny stitches.
function smoothLine(pts: Pt[], radius: number, closed: boolean): Pt[] {
  if (radius <= 0 || pts.length < 3) return pts
  const ring = closed ? pts.slice(0, -1) : pts // a closed line repeats its first point at the end
  const n = ring.length
  const d = (i: number, j: number) => Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1])
  const arc = [0]
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + d(i - 1, i))
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(ring[i])
      continue
    }
    // near an open end the window shrinks, so the end stays put and the line doesn't shorten
    const r = closed ? radius : Math.min(radius, arc[i], arc[n - 1] - arc[i])
    let sx = ring[i][0], sy = ring[i][1], c = 1
    for (const dir of [-1, 1]) {
      let walked = 0
      let j = i
      for (let k = 1; k < n; k++) {
        const next = closed ? (j + dir + n) % n : j + dir
        if (next < 0 || next >= n || next === i) break
        walked += d(j, next)
        if (walked > r) break
        sx += ring[next][0]
        sy += ring[next][1]
        c++
        j = next
      }
    }
    out.push([sx / c, sy / c])
  }
  if (closed) out.push(out[0])
  return out
}

// Needle points along one line (mm, both ends included). Corners sharper than ~40° always get a
// needle point (unless that would make a stitch shorter than `minStitchMm`); between them stitches
// are as long as `stitchMm` allows while staying within `tolMm` of the curve, never shorter than
// `minStitchMm`, and evened out so there is no stub.
function stitchLine(ptsMm: Pt[], p: StitchParams, closed: boolean): Pt[] {
  const simple = rdp(smoothLine(ptsMm, p.smoothMm, closed), Math.min(0.08, p.tolMm / 2))
  if (closed && simple.length > 2 && simple[0] !== simple[simple.length - 1]) simple.push(simple[0])
  const cut = [0]
  let lastCut = simple[0]
  for (let i = 1; i < simple.length - 1; i++) {
    const a = simple[i - 1], b = simple[i], c = simple[i + 1]
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]]
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1])) || 1)
    if (cos < 0.77 && Math.hypot(b[0] - lastCut[0], b[1] - lastCut[1]) >= p.minStitchMm) {
      cut.push(i)
      lastCut = b
    }
  }
  const end = simple[simple.length - 1]
  if (cut.length > 1 && Math.hypot(end[0] - lastCut[0], end[1] - lastCut[1]) < p.minStitchMm) cut.pop()
  cut.push(simple.length - 1)
  const out: Pt[] = [simple[0]]
  for (let c = 0; c < cut.length - 1; c++) {
    const piece = simple.slice(cut[c], cut[c + 1] + 1)
    const total = len(piece)
    if (piece.length === 2 || total <= p.stitchMm) {
      const n = Math.max(1, Math.ceil(total / p.stitchMm - 1e-9))
      const [a, b] = [piece[0], piece[piece.length - 1]]
      if (piece.length === 2) for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
      else out.push(b)
      continue
    }
    const d = densify(piece)
    const arc = [0]
    for (let i = 1; i < d.length; i++) arc.push(arc[i - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]))
    const picks: number[] = []
    let i = 0
    while (i < d.length - 1) {
      let best = i + 1
      for (let j = i + 1; j < d.length && arc[j] - arc[i] <= p.stitchMm; j++) {
        if (arc[j] - arc[i] <= p.minStitchMm || chordError(d, i, j) <= p.tolMm) best = j
        else break
      }
      picks.push(best)
      i = best
    }
    // a stub at the end: share the last two stitches evenly instead
    if (picks.length >= 2) {
      const last = picks[picks.length - 1], prev = picks[picks.length - 2]
      const before = picks.length >= 3 ? picks[picks.length - 3] : 0
      if (arc[last] - arc[prev] < p.minStitchMm) {
        const mid = arc[before] + (arc[last] - arc[before]) / 2
        let k = before + 1
        while (k < last && arc[k] < mid) k++
        picks[picks.length - 2] = k
      }
    }
    for (const k of picks) out.push(d[k])
  }
  return out
}

function lockStitches(at: Pt, toward: Pt, sizeMm: number): Pt[] {
  const dx = toward[0] - at[0], dy = toward[1] - at[1]
  const l = Math.hypot(dx, dy)
  if (l < 1e-6) return [at]
  const k = Math.min(sizeMm, l * 0.8) / l
  const b: Pt = [at[0] + dx * k, at[1] + dy * k]
  return [at, b, at, b, at]
}

// ---- plan ----------------------------------------------------------------------------------

export function planStitches(edges: Edge[], nodePos: Pt[], w: number, h: number, p: StitchParams): StitchPlan {
  // scale so the ink, not the image with its margins, comes out `widthMm` wide
  let minX = Infinity, maxX = -Infinity
  for (const e of edges) for (const [x] of e.pts) { if (x < minX) minX = x; if (x > maxX) maxX = x }
  const mm = p.widthMm / Math.max(1, maxX - minX) // mm per px
  let g = buildGraph(edges, nodePos, Math.max(3, 0.35 / mm)) // pixel-level junction clusters only; bigger moves distort the drawing
  // too small to sew: whole shapes with less line than the smallest detail
  const minPx = p.minDetailMm / mm
  const keep = new Set<number>()
  for (const comp of components(g.nodes.length, g.edges)) if (comp.reduce((s, i) => s + g.edges[i].len, 0) >= minPx) comp.forEach((i) => keep.add(i))
  g = { nodes: g.nodes, edges: g.edges.filter((_, i) => keep.has(i)) }
  const gEdges = linkGaps(g.nodes, g.edges, p.linkMm / mm)

  // needle points for every line, computed once so a doubled pass reuses the same holes
  const lineStitches = gEdges.map((e) => stitchLine(e.pts.map(([x, y]) => [x * mm, y * mm] as Pt), p, e.a === e.b))

  const runs: { pts: Pt[]; doubled: number }[] = []
  const comps = components(g.nodes.length, gEdges)
  for (const comp of comps) {
    const steps: Step[][] =
      p.route === 'continuous'
        ? [routeComponent(g.nodes, gEdges, comp)]
        : comp.map((i) => [{ edge: i, fwd: true, doubled: false }])
    for (const trail of steps) {
      const pts: Pt[] = []
      let doubled = 0
      for (const s of trail) {
        const seq = s.fwd ? lineStitches[s.edge] : [...lineStitches[s.edge]].reverse()
        for (const q of seq) {
          const last = pts[pts.length - 1]
          if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.05) pts.push(q) // no zero-length stitches
        }
        if (s.doubled) doubled += len(seq)
      }
      if (pts.length > 1) runs.push({ pts, doubled })
    }
  }

  // order runs to keep jumps short, reversing a run when its far end is nearer
  const ordered: Pt[][] = []
  let at: Pt = [0, 0]
  let jumpMm = 0
  let doubledMm = 0
  const left = runs.slice()
  while (left.length) {
    let bi = 0, bd = Infinity, rev = false
    for (let i = 0; i < left.length; i++) {
      const r = left[i].pts
      const d0 = Math.hypot(r[0][0] - at[0], r[0][1] - at[1])
      const d1 = Math.hypot(r[r.length - 1][0] - at[0], r[r.length - 1][1] - at[1])
      if (d0 < bd) { bd = d0; bi = i; rev = false }
      if (d1 < bd) { bd = d1; bi = i; rev = true }
    }
    const r = left.splice(bi, 1)[0]
    const pts = rev ? [...r.pts].reverse() : r.pts
    if (ordered.length) jumpMm += bd
    doubledMm += r.doubled
    ordered.push(pts)
    at = pts[pts.length - 1]
  }

  const finished: StitchRun[] = ordered.map((pts) => {
    if (!p.ties || pts.length < 2) return { pts }
    const head = lockStitches(pts[0], pts[1], 0.7)
    const tail = lockStitches(pts[pts.length - 1], pts[pts.length - 2], 0.7)
    return { pts: [...head, ...pts.slice(1, -1), ...tail] }
  })
  let threadMm = 0
  let stitches = 0
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
  for (const r of finished) {
    stitches += r.pts.length - 1
    threadMm += len(r.pts)
    for (const [x, y] of r.pts) {
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y)
    }
  }
  const box = finished.length ? { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } : { x: 0, y: 0, w: 0, h: 0 }
  return {
    frameW: w * mm,
    frameH: h * mm,
    box,
    runs: finished,
    stats: { stitches, runs: finished.length, trims: Math.max(0, finished.length - 1), threadMm, doubledMm, jumpMm },
  }
}

// Preview: each run as the thread would lie, jumps as dashed lines between runs.
export function stitchSvg(plan: StitchPlan, color = '#1f3a93'): string {
  const f = (n: number) => (Math.round(n * 100) / 100).toString()
  const runs = plan.runs.map((r) => `<path d="M${r.pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}"/>`).join('\n')
  const jumps: string[] = []
  for (let i = 1; i < plan.runs.length; i++) {
    const a = plan.runs[i - 1].pts[plan.runs[i - 1].pts.length - 1]
    const b = plan.runs[i].pts[0]
    jumps.push(`<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(plan.frameW)} ${f(plan.frameH)}" width="${f(plan.frameW)}mm" height="${f(plan.frameH)}mm">
<g fill="none" stroke="#9a968c" stroke-width="0.15" stroke-dasharray="0.6 0.6">\n${jumps.join('\n')}\n</g>
<g fill="none" stroke="${color}" stroke-width="0.35" stroke-linecap="round" stroke-linejoin="round">\n${runs}\n</g>
</svg>
`
}
