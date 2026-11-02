// Vector worker: the CPU-heavy part of every engine runs here so the page stays responsive.
//   centerline → our skeleton tracer, returns the SVG
//   mask       → just the ink mask, bit-packed, for the outline engine (Potrace runs server-side)
//   color      → VTracer (wasm), returns the SVG
import { inkMask, packMask, type PrepParams } from './bitmap'
import { traceCenterline, centerlineSvg, type CenterlineParams } from './centerline'
import { init, vectorize_rgba } from './vtracer/vtracer.js'
import wasmUrl from './vtracer/vtracer_bg.wasm?url'

export type WorkerJob =
  | { id: number; kind: 'centerline'; rgba: Uint8ClampedArray; w: number; h: number; prep: PrepParams; params: CenterlineParams }
  | { id: number; kind: 'mask'; rgba: Uint8ClampedArray; w: number; h: number; prep: PrepParams }
  | { id: number; kind: 'color'; rgba: Uint8ClampedArray; w: number; h: number; options: Record<string, unknown> }

export type WorkerReply =
  | { id: number; svg: string; lineWidth?: number; travel?: number; length?: number }
  | { id: number; bits: Uint8Array }
  | { id: number; error: string }

const post = (msg: WorkerReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (e: MessageEvent<WorkerJob>) => {
  const job = e.data
  try {
    if (job.kind === 'centerline') {
      const r = traceCenterline(inkMask(job.rgba, job.w, job.h, job.prep), job.params)
      post({ id: job.id, svg: centerlineSvg(r, job.w, job.h, job.params.smooth), lineWidth: r.stats.lineWidth, travel: r.stats.travel, length: r.stats.length })
    } else if (job.kind === 'mask') {
      const bits = packMask(inkMask(job.rgba, job.w, job.h, job.prep))
      post({ id: job.id, bits }, [bits.buffer])
    } else {
      await init(wasmUrl)
      post({ id: job.id, svg: vectorize_rgba(new Uint8Array(job.rgba.buffer, job.rgba.byteOffset, job.rgba.byteLength), job.w, job.h, job.options) })
    }
  } catch (err) {
    post({ id: job.id, error: (err as Error)?.message || String(err) })
  }
}
