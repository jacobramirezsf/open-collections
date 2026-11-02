// The vectorizer's engines and their settings, and runVector(), which takes a canvas through the
// chosen engine to a finished SVG. Engines:
//   centerline  single strokes down the middle of lines (plotter, CNC engraving, running stitch);
//               our own skeleton tracer, in the worker
//   outline     smooth filled outlines of black-and-white art (cutting, fills, satin); Potrace,
//               server-side at /api/vectorize, on a mask made in the worker
//   color       flat colour regions that don't overlap (logos, stickers, poster art); VTracer, in
//               the worker
//   stitch      a running-stitch embroidery plan from the centerline skeleton (embroidery.ts), each
//               connected shape sewn in one run; downloads as DST
import type { PrepParams } from './bitmap'
import type { CenterlineParams } from './centerline'
import type { StitchParams, StitchPlan } from './embroidery'
import { normalizeRoot, outlinesOnly, svgStats, type SvgStats } from './svgout'
import type { WorkerJob, WorkerReply } from './worker'

export type EngineId = 'centerline' | 'outline' | 'color' | 'stitch'

export const ENGINES: { id: EngineId; label: string; blurb: string }[] = [
  { id: 'centerline', label: 'Centerline', blurb: 'One stroke down the middle of each line. For plotters, CNC engraving and running stitch.' },
  { id: 'outline', label: 'Outline', blurb: 'Smooth outlines of black-and-white art. For cutting, laser, and fill or satin stitches.' },
  { id: 'color', label: 'Color', blurb: 'Flat colour shapes that never overlap. For logos, stickers and poster art.' },
  { id: 'stitch', label: 'Running stitch', blurb: 'An embroidery stitch plan from the centerlines: each connected shape sewn in one run, doubling back instead of trimming. Downloads as DST.' },
]

export interface OutlineParams {
  corners: number // Potrace alphamax: 0 = all corners sharp, 1.33 = everything rounded
  curveFit: number // Potrace opttolerance: how far curves may be merged (0 = keep every segment)
}

export interface ColorParams {
  colors: number // 0 = let VTracer decide, else quantize to this many
  speckle: number // drop patches smaller than this (px)
  simplify: number // curve simplification tolerance (px), 0 = off
  corners: number // corner threshold (deg): sharper turns stay corners
  mode: 'spline' | 'polygon'
  layering: 'cutout' | 'stacked'
  clustering: 'color-cluster' | 'watershed'
}

export interface VectorSettings {
  engine: EngineId
  size: number // longest edge the image is traced at, px
  prep: PrepParams
  centerline: CenterlineParams
  outline: OutlineParams
  color: ColorParams
  stitch: StitchParams
  widthMm: number // physical width written into the SVG; 0 = pixels
  outlinesOnly: boolean // outline/color: hairline outlines instead of fills
}

export const DEFAULT_SETTINGS: VectorSettings = {
  engine: 'centerline',
  size: 1600,
  prep: { threshold: 0, adaptive: false, invert: false, blur: 0, bridge: 1, despeckle: 12 },
  centerline: { prune: 10, minLength: 6, joinAngle: 35, simplify: 0.8, smooth: 0.6 },
  outline: { corners: 1, curveFit: 0.2 },
  color: { colors: 8, speckle: 4, simplify: 1.5, corners: 60, mode: 'spline', layering: 'cutout', clustering: 'color-cluster' },
  stitch: { widthMm: 100, stitchMm: 2.5, minStitchMm: 1, tolMm: 0.2, smoothMm: 0.5, linkMm: 1, minDetailMm: 2, route: 'continuous', ties: true },
  widthMm: 0,
  outlinesOnly: false,
}

// Slider specs for the settings panel. `get`/`set` address the nested settings.
export interface Knob {
  key: string
  label: string
  hint: string
  min: number
  max: number
  step: number
  get: (s: VectorSettings) => number
  set: (s: VectorSettings, v: number) => VectorSettings
  show?: (v: number) => string
}

const prepKnob = (key: keyof PrepParams, label: string, hint: string, min: number, max: number, step: number, show?: (v: number) => string): Knob => ({
  key: `prep.${key}`, label, hint, min, max, step, show,
  get: (s) => Number(s.prep[key]),
  set: (s, v) => ({ ...s, prep: { ...s.prep, [key]: v } }),
})
const engineKnob = <E extends 'centerline' | 'outline' | 'color' | 'stitch'>(e: E, key: keyof VectorSettings[E], label: string, hint: string, min: number, max: number, step: number, show?: (v: number) => string): Knob => ({
  key: `${e}.${String(key)}`, label, hint, min, max, step, show,
  get: (s) => Number(s[e][key]),
  set: (s, v) => ({ ...s, [e]: { ...s[e], [key]: v } }),
})

export const PREP_KNOBS: Knob[] = [
  prepKnob('threshold', 'Ink threshold', 'How dark a pixel must be to count as ink. Auto picks it from the image.', 0, 254, 1, (v) => (v ? String(v) : 'auto')),
  prepKnob('blur', 'Soften', 'Blur before deciding what is ink: smooths ragged scans and JPEG noise.', 0, 4, 1, (v) => (v ? `${v}px` : 'off')),
  prepKnob('bridge', 'Bridge gaps', 'Joins dotted or broken lines across small gaps.', 0, 6, 1, (v) => (v ? `${v}px` : 'off')),
  prepKnob('despeckle', 'Despeckle', 'Removes ink specks and fills pinholes smaller than this.', 0, 200, 1, (v) => (v ? `${v}px²` : 'off')),
]

export const CENTERLINE_KNOBS: Knob[] = [
  engineKnob('centerline', 'prune', 'Trim branches', 'Removes dead-end twigs shorter than this, the hairs a thinned line grows at corners and serifs.', 0, 60, 1, (v) => (v ? `${v}px` : 'off')),
  engineKnob('centerline', 'joinAngle', 'Carry through junctions', 'Where lines cross or meet, keep a line going if it bends less than this. Longer strokes, fewer jumps.', 0, 90, 1, (v) => (v ? `${v}°` : 'off')),
  engineKnob('centerline', 'simplify', 'Simplify', 'Fewer points: how far the path may stray from the traced line.', 0, 4, 0.1, (v) => (v ? `${v.toFixed(1)}px` : 'off')),
  engineKnob('centerline', 'smooth', 'Smooth', 'Straight segments at 0, flowing curves through the same points at 1.', 0, 1, 0.05, (v) => v.toFixed(2)),
  engineKnob('centerline', 'minLength', 'Shortest stroke', 'Strokes shorter than this are dropped.', 0, 60, 1, (v) => `${v}px`),
]

export const OUTLINE_KNOBS: Knob[] = [
  engineKnob('outline', 'corners', 'Roundness', 'Sharp corners at 0, everything rounded at the top.', 0, 1.33, 0.01, (v) => v.toFixed(2)),
  engineKnob('outline', 'curveFit', 'Curve merging', 'How freely neighbouring curves merge into one. Higher = fewer nodes, looser fit.', 0, 1, 0.05, (v) => v.toFixed(2)),
]

export const COLOR_KNOBS: Knob[] = [
  engineKnob('color', 'colors', 'Colours', 'Reduce the image to this many colours. Auto lets the tracer decide.', 0, 32, 1, (v) => (v ? String(v) : 'auto')),
  engineKnob('color', 'speckle', 'Despeckle', 'Patches smaller than this are merged into their neighbours.', 0, 64, 1, (v) => `${v}px`),
  engineKnob('color', 'simplify', 'Simplify', 'Fewer nodes: how far curves may stray from the traced edge.', 0, 4, 0.1, (v) => (v ? `${v.toFixed(1)}px` : 'off')),
  engineKnob('color', 'corners', 'Corner angle', 'Turns sharper than this stay corners; gentler ones become curves.', 0, 180, 1, (v) => `${v}°`),
]

export const STITCH_KNOBS: Knob[] = [
  engineKnob('stitch', 'widthMm', 'Design width', 'How wide the design sews out. Everything else is measured at this size.', 20, 300, 1, (v) => `${v} mm`),
  engineKnob('stitch', 'stitchMm', 'Stitch length', 'Running stitch length on straight lines. Longer sews faster; 2–3 mm is typical.', 1.5, 5, 0.1, (v) => `${v.toFixed(1)} mm`),
  engineKnob('stitch', 'tolMm', 'Curve accuracy', 'How far a stitch may cut across a curve before it is shortened.', 0.05, 0.6, 0.05, (v) => `${v.toFixed(2)} mm`),
  engineKnob('stitch', 'minStitchMm', 'Shortest stitch', 'Stitches are never shorter than this, even on tight curves. Very short stitches pile up thread.', 0.5, 2, 0.1, (v) => `${v.toFixed(1)} mm`),
  engineKnob('stitch', 'smoothMm', 'Smooth', 'Averages out scan wobble along each line before stitching.', 0, 1.5, 0.05, (v) => (v ? `${v.toFixed(2)} mm` : 'off')),
  engineKnob('stitch', 'linkMm', 'Close gaps', 'Line ends closer than this are joined and sewn through, so broken lines become one run.', 0, 4, 0.1, (v) => (v ? `${v.toFixed(1)} mm` : 'off')),
  engineKnob('stitch', 'minDetailMm', 'Smallest detail', 'Shapes with less line than this are left out.', 0, 15, 0.5, (v) => (v ? `${v.toFixed(1)} mm` : 'off')),
]

export const STITCHES_PER_MINUTE = 700
export const SECONDS_PER_TRIM = 8

// One worker for the page, created on first use.
let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, (r: WorkerReply) => void>()

type Job = WorkerJob extends infer J ? (J extends WorkerJob ? Omit<J, 'id'> : never) : never

function ask(job: Job, transfer: Transferable[]): Promise<WorkerReply> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
  }
  const id = ++seq
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    worker!.postMessage({ ...job, id }, transfer)
  })
}

function pixels(source: HTMLCanvasElement, maxEdge: number): { rgba: Uint8ClampedArray; w: number; h: number } {
  const k = Math.min(1, maxEdge / Math.max(source.width, source.height))
  const w = Math.max(1, Math.round(source.width * k))
  const h = Math.max(1, Math.round(source.height * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return { rgba: ctx.getImageData(0, 0, w, h).data, w, h }
}

const toBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export interface VectorResult {
  svg: string
  engine: EngineId
  w: number // traced size, px
  h: number
  stats: SvgStats & { travel?: number; length?: number; lineWidth?: number }
  plan?: StitchPlan // stitch engine only
}

function colorOptions(c: ColorParams): Record<string, unknown> {
  return {
    clustering: c.clustering,
    hierarchical: c.layering,
    mode: c.mode,
    filterSpeckle: c.speckle,
    cornerThreshold: c.corners,
    ...(c.simplify > 0 ? { simplify: c.simplify } : {}),
    ...(c.colors > 0 ? { maxColors: c.colors } : {}),
    optimize: 2,
  }
}

export async function runVector(source: HTMLCanvasElement, s: VectorSettings, signal?: AbortSignal): Promise<VectorResult> {
  const { rgba, w, h } = pixels(source, s.size)
  let svg: string
  let extra: { travel?: number; length?: number; lineWidth?: number } = {}
  const fail = (r: WorkerReply) => {
    if ('error' in r) throw new Error(r.error)
  }
  if (s.engine === 'centerline') {
    const r = await ask({ kind: 'centerline', rgba, w, h, prep: s.prep, params: s.centerline }, [rgba.buffer])
    fail(r)
    const { svg: out, travel, length, lineWidth } = r as { svg: string; travel: number; length: number; lineWidth: number }
    svg = out
    extra = { travel, length, lineWidth }
  } else if (s.engine === 'stitch') {
    const r = await ask({ kind: 'stitch', rgba, w, h, prep: s.prep, prune: s.centerline.prune, params: s.stitch }, [rgba.buffer])
    fail(r)
    const { svg, plan } = r as { svg: string; plan: StitchPlan }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return { svg, engine: 'stitch', w, h, plan, stats: svgStats(svg) }
  } else if (s.engine === 'outline') {
    const r = await ask({ kind: 'mask', rgba, w, h, prep: s.prep }, [rgba.buffer])
    fail(r)
    const res = await fetch('/api/vectorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ w, h, bits: toBase64((r as { bits: Uint8Array }).bits), corners: s.outline.corners, curveFit: s.outline.curveFit }),
      signal,
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok || typeof payload?.svg !== 'string') throw new Error(payload?.error || `Outline tracing failed (${res.status})`)
    svg = payload.svg
  } else {
    const r = await ask({ kind: 'color', rgba, w, h, options: colorOptions(s.color) }, [rgba.buffer])
    fail(r)
    svg = (r as { svg: string }).svg
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (s.outlinesOnly && s.engine !== 'centerline') svg = outlinesOnly(svg)
  svg = normalizeRoot(svg, w, h, s.widthMm)
  return { svg, engine: s.engine, w, h, stats: { ...svgStats(svg), ...extra } }
}

const SETTINGS_KEY = 'oc:vector-settings'

// Saved settings merged over the defaults, so a newly added knob always has a value.
export function loadSettings(): VectorSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')
    if (!saved || typeof saved !== 'object') return DEFAULT_SETTINGS
    const d = DEFAULT_SETTINGS
    return {
      ...d,
      ...saved,
      engine: ENGINES.some((e) => e.id === saved.engine) ? saved.engine : d.engine,
      prep: { ...d.prep, ...saved.prep },
      centerline: { ...d.centerline, ...saved.centerline },
      outline: { ...d.outline, ...saved.outline },
      color: { ...d.color, ...saved.color },
      stitch: { ...d.stitch, ...saved.stitch },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: VectorSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}
