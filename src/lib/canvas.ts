import type { TextProps } from './textpiece'

// Canvas documents: arrange saved edits / board items / uploaded images on one artboard.
// Stored like boards (localStorage, cloud-synced for signed-in users via the same userdata payload).
export interface CanvasPiece {
  id: string
  src: string // image URL (proxy/blob/data:)
  x: number // center, in canvas units (0..W)
  y: number
  scale: number // 1 = image width equals half the canvas width
  rotation: number // degrees
  flipH?: boolean
  w: number // natural aspect (w/h) captured at add time
  h: number
  title?: string
  hi?: string // full-resolution source, used only when exporting
  text?: TextProps // set when this piece is lettering, so it stays re-editable
  locked?: boolean // pinned in place: not draggable or marquee-selectable on the artboard
}

export interface CanvasDoc {
  id: string
  name: string
  aspect: number // width / height
  background: string // css colour, 'transparent', 'img:<sheet>' or 'garment:<piece>/<colour>'
  bgRotate?: number // 0/90/180/270, for sheets
  pieces: CanvasPiece[]
  createdAt: number
  updatedAt: number
}

const KEY = 'open-collections:canvases:v1'
type Listener = () => void
const listeners = new Set<Listener>()

function load(): CanvasDoc[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let docs = load()

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(docs))
  } catch (e) {
    console.warn('canvas save failed', e)
  }
}

function commit() {
  docs = docs.slice()
  save()
  listeners.forEach((l) => l())
}

export const canvasStore = {
  list: (): CanvasDoc[] => docs,
  get: (id: string) => docs.find((d) => d.id === id),
  create(name?: string): CanvasDoc {
    const d: CanvasDoc = {
      id: Math.random().toString(36).slice(2, 10),
      name: name || `Canvas ${docs.length + 1}`,
      aspect: 4 / 5,
      background: 'paper:fine-grain',
      pieces: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    docs = [d, ...docs]
    commit()
    return d
  },
  update(id: string, patch: Partial<CanvasDoc>) {
    if (!docs.some((x) => x.id === id)) return
    docs = docs.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x))
    commit()
  },
  remove(id: string) {
    docs = docs.filter((x) => x.id !== id)
    commit()
  },
  setAll(next: CanvasDoc[]) {
    docs = next
    commit()
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

// The Canvas button always starts fresh. An untouched blank is reused so repeated taps don't
// pile up empty "Canvas 7, Canvas 8…" entries; anything you actually worked on is left alone.
export function openNewCanvas(): CanvasDoc {
  const blank = docs.find((d) => !d.pieces.length && d.updatedAt === d.createdAt)
  return blank || canvasStore.create()
}

// last-opened canvas, so the toolbar button returns you to the one you were working on
const LAST_KEY = 'open-collections:last-canvas'
export function rememberCanvas(id: string) {
  try { localStorage.setItem(LAST_KEY, id) } catch {}
}
export function lastCanvasId(): string | null {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

// union-merge for cloud sync (same strategy as boards)
export function mergeCanvases(a: CanvasDoc[], b: CanvasDoc[]): CanvasDoc[] {
  const byId = new Map<string, CanvasDoc>()
  for (const src of [a, b]) {
    for (const d of src) {
      const cur = byId.get(d.id)
      if (!cur || d.updatedAt > cur.updatedAt) byId.set(d.id, d)
    }
  }
  return [...byId.values()].sort((x, y) => y.updatedAt - x.updatedAt)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      docs = load()
      listeners.forEach((l) => l())
    }
  })
}
