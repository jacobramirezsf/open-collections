// Canvas studio (mobile-first): arrange saved edits, board items and uploads on one artboard —
// drag to move, pinch to scale/rotate, layer strip, paper backgrounds, undo, export/share.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boardStore, type Board } from '../lib/boards'
import { canvasStore, rememberCanvas, type CanvasDoc, type CanvasPiece } from '../lib/canvas'
import { FONTS, TEXT_DEFAULTS, TEXT_SHAPES, renderTextPiece, type TextProps } from '../lib/textpiece'
import MaskTool from './MaskTool'
import { EFFECTS } from '../lib/textures'
import BackgroundPicker, { backgroundImageUrl, backgroundLabel, isContainedBackground, isSheetValue } from './BackgroundPicker'
import { proxyImageUrl, uploadEdit } from '../lib/api'
import { saveImage } from '../lib/save'
import { onAuthChange } from '../lib/account'
import { useBodyLock } from './Panels'
import type { Item } from '../../shared/types'

const CANVAS_W = 1000 // internal units; height = CANVAS_W / aspect

// Enlarging a small source in one jump gives mush; doubling repeatedly with smoothing on keeps far
// more of the weave and stitching, which matters because the garment photographs are only ~750px.
function upscale(img: CanvasImageSource, tw: number, th: number): HTMLCanvasElement {
  let w = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
  let h = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
  let cur: CanvasImageSource = img
  while (w * 2 <= tw) {
    w = Math.min(tw, w * 2)
    h = Math.min(th, h * 2)
    const step = document.createElement('canvas')
    step.width = w
    step.height = h
    const sc = step.getContext('2d')!
    sc.imageSmoothingQuality = 'high'
    sc.drawImage(cur, 0, 0, w, h)
    cur = step
  }
  if (cur === img) {
    const one = document.createElement('canvas')
    one.width = w
    one.height = h
    one.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return one
  }
  return cur as HTMLCanvasElement
}
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

interface Props {
  id: string
  onClose: () => void
}

const ASPECTS: { label: string; value: number }[] = [
  { label: '4:5', value: 4 / 5 },
  { label: '1:1', value: 1 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]

// canvases saved before the picker used a `paper:` prefix
const bgValue = (raw: string) => (raw.startsWith('paper:') ? 'img:' + raw.slice(6) : raw)

function pieceSrcForItem(item: Item): string {
  if (item.originalImageUrl?.startsWith('data:')) return item.originalImageUrl
  if (item.source === 'edits') return item.originalImageUrl || item.imageUrl || item.thumbnailUrl || ''
  return proxyImageUrl(item, 'view')
}

// The on-screen piece uses a light rendition; exports re-fetch the full-resolution original so a
// 4000–6000px canvas is genuinely sharp rather than an upscale of the preview.
function pieceHiForItem(item: Item): string | undefined {
  if (item.originalImageUrl?.startsWith('data:')) return undefined
  if (item.source === 'edits') return undefined
  return proxyImageUrl(item, 'orig')
}

export default function CanvasStudio({ id, onClose }: Props) {
  useBodyLock()
  const [doc, setDoc] = useState<CanvasDoc | null>(canvasStore.get(id) ?? null)
  const [selected, setSelected] = useState<string[]>([])
  const [marquee, setMarquee] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null)
  const [exportScale, setExportScale] = useState(2)
  const [textEdit, setTextEdit] = useState<null | { id: string | null; props: TextProps }>(null)
  const [bgPicker, setBgPicker] = useState(false)
  const [erasing, setErasing] = useState<null | { id: string; canvas: HTMLCanvasElement }>(null)
  const [bgNatural, setBgNatural] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState({ z: 1, x: 0, y: 0 }) // artboard zoom and pan
  const pan = useRef<null | { x: number; y: number; vx: number; vy: number }>(null)
  const [picker, setPicker] = useState(false)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [snap, setSnap] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const [user, setUser] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const history = useRef<string[]>([])
  const future = useRef<string[]>([])
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<null | {
    kind: 'move' | 'pinch' | 'handle' | 'marquee' | 'rotate'
    corner?: 'nw' | 'ne' | 'sw' | 'se'
    ids: string[]
    px: number // pointer position at gesture start, in canvas units
    py: number
    starts: Map<string, { x: number; y: number; scale: number; rotation: number }>
    cx?: number // selection centroid at gesture start
    cy?: number
    dist?: number
    angle?: number
    moved?: boolean
  }>(null)

  useEffect(() => onAuthChange((s) => setUser(s.user)), [])
  useEffect(() => rememberCanvas(id), [id])
  useEffect(() => {
    const url = backgroundImageUrl(bgValue(doc?.background || ''))
    if (!url) {
      setBgNatural(null)
      return
    }
    let dead = false
    const im = new Image()
    im.onload = () => !dead && setBgNatural({ w: im.naturalWidth, h: im.naturalHeight })
    im.src = url
    return () => {
      dead = true
    }
  }, [doc?.background])
  useEffect(() => canvasStore.subscribe(() => setDoc(canvasStore.get(id) ?? null)), [id])

  const say = useCallback((m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 2400)
  }, [])

  const snapshot = useCallback(() => {
    if (!doc) return
    history.current.push(JSON.stringify({ pieces: doc.pieces, background: doc.background, aspect: doc.aspect }))
    if (history.current.length > 40) history.current.shift()
    future.current = []
  }, [doc])

  const restore = useCallback(
    (json: string) => {
      const s = JSON.parse(json)
      canvasStore.update(id, { pieces: s.pieces, background: s.background, aspect: s.aspect })
    },
    [id],
  )

  const undo = useCallback(() => {
    if (!doc || !history.current.length) return
    future.current.push(JSON.stringify({ pieces: doc.pieces, background: doc.background, aspect: doc.aspect }))
    restore(history.current.pop()!)
  }, [doc, restore])

  const redo = useCallback(() => {
    if (!doc || !future.current.length) return
    history.current.push(JSON.stringify({ pieces: doc.pieces, background: doc.background, aspect: doc.aspect }))
    restore(future.current.pop()!)
  }, [doc, restore])

  // ---- fit the artboard into the stage ----
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => setStageSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const aspect = doc?.aspect ?? 1
  const boardW = Math.min(stageSize.w - 24, (stageSize.h - 24) * aspect) * view.z
  const boardH = boardW / aspect
  const unit = boardW / CANVAS_W // canvas units → screen px
  const canvasH = CANVAS_W / aspect

  const selSet = useMemo(() => new Set(selected), [selected])
  const selPieces = useMemo(() => (doc ? doc.pieces.filter((p) => selSet.has(p.id)) : []), [doc, selSet])
  const one = selPieces.length === 1 ? selPieces[0] : null // affordances that only make sense for a single piece

  const updatePieces = useCallback(
    (fn: (p: CanvasPiece) => Partial<CanvasPiece> | null, commitDoc = false) => {
      if (!doc) return
      const pieces = doc.pieces.map((p) => {
        const patch = fn(p)
        return patch ? { ...p, ...patch } : p
      })
      if (commitDoc) canvasStore.update(id, { pieces })
      else setDoc({ ...doc, pieces }) // transient while gesturing
    },
    [doc, id],
  )

  const startsOf = (ids: string[]) => {
    const m = new Map<string, { x: number; y: number; scale: number; rotation: number }>()
    for (const p of doc?.pieces || []) if (ids.includes(p.id)) m.set(p.id, { x: p.x, y: p.y, scale: p.scale, rotation: p.rotation })
    return m
  }
  const centroidOf = (ids: string[]) => {
    const ps = (doc?.pieces || []).filter((p) => ids.includes(p.id))
    if (!ps.length) return { cx: CANVAS_W / 2, cy: canvasH / 2 }
    return { cx: ps.reduce((a, p) => a + p.x, 0) / ps.length, cy: ps.reduce((a, p) => a + p.y, 0) / ps.length }
  }
  // scale + rotate a whole selection about its centroid, so a group keeps its arrangement
  const transformGroup = (g: NonNullable<typeof gesture.current>, k: number, dA: number) => {
    const rad = (dA * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    updatePieces((p) => {
      const st = g.starts.get(p.id)
      if (!st) return null
      const dx = (st.x - (g.cx || 0)) * k
      const dy = (st.y - (g.cy || 0)) * k
      return {
        x: (g.cx || 0) + dx * cos - dy * sin,
        y: (g.cy || 0) + dx * sin + dy * cos,
        scale: Math.max(0.05, Math.min(4, st.scale * k)),
        rotation: st.rotation + dA,
      }
    })
  }
  // axis-aligned bounds of a rotated piece, for marquee hit-testing
  const boundsOf = (p: CanvasPiece) => {
    const w = 500 * p.scale
    const h = (w * p.h) / p.w
    const rad = (p.rotation * Math.PI) / 180
    const ex = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2
    const ey = (Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h) / 2
    return { x0: p.x - ex, x1: p.x + ex, y0: p.y - ey, y1: p.y + ey }
  }

  // ---- gestures ----
  const clientToCanvas = (cx: number, cy: number) => {
    const r = boardRef.current!.getBoundingClientRect()
    return { x: (cx - r.left) / unit, y: (cy - r.top) / unit }
  }

  const onPiecePointerDown = (e: React.PointerEvent, p: CanvasPiece) => {
    if (p.locked) return // a locked layer stays put; unlock it from the layer strip
    e.stopPropagation()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const inSel = selSet.has(p.id)
    if (e.shiftKey) {
      setSelected(inSel ? selected.filter((x) => x !== p.id) : [...selected, p.id])
      return
    }
    // dragging a piece that's part of a multi-selection moves the whole group
    const ids = inSel && selected.length > 1 ? selected : [p.id]
    if (!inSel || selected.length <= 1) setSelected([p.id])
    if (pointers.current.size === 1) {
      snapshot()
      const pt = clientToCanvas(e.clientX, e.clientY)
      gesture.current = { kind: 'move', ids, px: pt.x, py: pt.y, starts: startsOf(ids) }
    }
  }

  const onStagePointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && selPieces.length) {
      const [a, b] = [...pointers.current.values()]
      snapshot()
      const ids = selPieces.map((p) => p.id)
      const { cx, cy } = centroidOf(ids)
      gesture.current = {
        kind: 'pinch',
        ids,
        px: 0,
        py: 0,
        starts: startsOf(ids),
        cx,
        cy,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      }
      setMarquee(null)
    } else if (e.target === stageRef.current) {
      // the surround pans the view
      pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    } else if (e.target === boardRef.current) {
      // drag across empty canvas to sweep up everything inside the rectangle
      const pt = clientToCanvas(e.clientX, e.clientY)
      gesture.current = { kind: 'marquee', ids: [], px: pt.x, py: pt.y, starts: new Map() }
      setMarquee({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pan.current) {
      const p0 = pan.current
      setView((v) => ({ ...v, x: p0.vx + (e.clientX - p0.x), y: p0.vy + (e.clientY - p0.y) }))
      return
    }
    if (!pointers.current.has(e.pointerId) || !doc) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
      transformGroup(g, dist / (g.dist || 1), angle - (g.angle || 0))
      g.moved = true
    } else if (g.kind === 'rotate' && pointers.current.size === 1) {
      const pt = clientToCanvas(e.clientX, e.clientY)
      const now = (Math.atan2(pt.y - (g.cy || 0), pt.x - (g.cx || 0)) * 180) / Math.PI
      const st = g.starts.get(g.ids[0])!
      let deg = st.rotation + (now - (g.angle || 0))
      if (e.shiftKey) deg = Math.round(deg / 15) * 15 // snap while shift is held
      updatePieces((p) => (p.id === g.ids[0] ? { rotation: deg } : null))
      g.moved = true
    } else if (g.kind === 'marquee' && pointers.current.size === 1) {
      const pt = clientToCanvas(e.clientX, e.clientY)
      setMarquee((m) => (m ? { ...m, x1: pt.x, y1: pt.y } : m))
      g.moved = true
    } else if ((g.kind === 'move' || g.kind === 'handle') && pointers.current.size === 1) {
      const pt = clientToCanvas(e.clientX, e.clientY)
      if (g.kind === 'move') {
        let dx = pt.x - g.px
        let dy = pt.y - g.py
        if (g.ids.length === 1) {
          // single piece snaps to the canvas centre lines
          const st = g.starts.get(g.ids[0])!
          const sv = Math.abs(st.x + dx - CANVAS_W / 2) < 14
          const sh = Math.abs(st.y + dy - canvasH / 2) < 14
          if (sv) dx = CANVAS_W / 2 - st.x
          if (sh) dy = canvasH / 2 - st.y
          setSnap({ v: sv, h: sh })
        }
        updatePieces((p) => {
          const st = g.starts.get(p.id)
          return st ? { x: st.x + dx, y: st.y + dy } : null
        })
      } else {
        // any corner scales about the opposite one, so the piece grows from the corner you grab
        const piece = doc.pieces.find((p) => p.id === g.ids[0])
        const st = g.starts.get(g.ids[0])
        if (piece && st) {
          const w0 = 500 * st.scale
          const h0 = (w0 * piece.h) / piece.w
          const sx = g.corner === 'nw' || g.corner === 'sw' ? -1 : 1
          const sy = g.corner === 'nw' || g.corner === 'ne' ? -1 : 1
          const anchor = { x: st.x - (sx * w0) / 2, y: st.y - (sy * h0) / 2 }
          const d = Math.hypot(pt.x - anchor.x, pt.y - anchor.y)
          const k = Math.max(0.05, Math.min(4, (st.scale * d) / Math.max(1, Math.hypot(w0, h0))))
          const w1 = 500 * k
          const h1 = (w1 * piece.h) / piece.w
          updatePieces((p) => (p.id === piece.id ? { scale: k, x: anchor.x + (sx * w1) / 2, y: anchor.y + (sy * h1) / 2 } : null))
        }
      }
      g.moved = true
    }
  }

  const endGesture = (e: React.PointerEvent) => {
    pan.current = null
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0 && gesture.current) {
      const g = gesture.current
      gesture.current = null
      setSnap({ v: false, h: false })
      if (g.kind === 'marquee') {
        const m = marquee
        setMarquee(null)
        if (m && doc) {
          const x0 = Math.min(m.x0, m.x1)
          const x1 = Math.max(m.x0, m.x1)
          const y0 = Math.min(m.y0, m.y1)
          const y1 = Math.max(m.y0, m.y1)
          if (x1 - x0 < 8 && y1 - y0 < 8) setSelected([]) // a tap on empty canvas clears
          else {
            const hit = doc.pieces.filter((p) => {
              if (p.locked) return false
              const b = boundsOf(p)
              return b.x0 < x1 && b.x1 > x0 && b.y0 < y1 && b.y1 > y0
            })
            setSelected(hit.map((p) => p.id))
            if (hit.length) say(`${hit.length} selected`)
          }
        }
        return
      }
      if (g.moved && doc) canvasStore.update(id, { pieces: doc.pieces })
      else history.current.pop() // no-op gesture: drop the snapshot
    }
  }

  const onHandleDown = (e: React.PointerEvent, p: CanvasPiece, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    e.stopPropagation()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    snapshot()
    gesture.current = { kind: 'handle', ids: [p.id], px: 0, py: 0, starts: startsOf([p.id]), corner }
  }

  const onRotateDown = (e: React.PointerEvent, p: CanvasPiece) => {
    e.stopPropagation()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    snapshot()
    const pt = clientToCanvas(e.clientX, e.clientY)
    gesture.current = {
      kind: 'rotate',
      ids: [p.id],
      px: 0,
      py: 0,
      starts: startsOf([p.id]),
      cx: p.x,
      cy: p.y,
      angle: (Math.atan2(pt.y - p.y, pt.x - p.x) * 180) / Math.PI,
    }
  }

  // ---- piece management ----
  const addFromItem = (item: Item) => {
    if (!doc) return
    snapshot()
    const src = pieceSrcForItem(item)
    const img = new Image()
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => {
      const n = doc.pieces.length
      const piece: CanvasPiece = {
        id: Math.random().toString(36).slice(2, 9),
        src,
        x: CANVAS_W / 2 + ((n % 3) - 1) * 60,
        y: canvasH / 2 + (((n / 3) | 0) % 3 - 1) * 60,
        scale: 0.9,
        rotation: 0,
        w: img.naturalWidth,
        h: img.naturalHeight,
        title: item.title,
        hi: pieceHiForItem(item),
      }
      canvasStore.update(id, { pieces: [...(canvasStore.get(id)?.pieces || []), piece] })
      setSelected([piece.id])
      say(`Added “${item.title.slice(0, 34)}”`)
    }
    img.onerror = () => say('Could not load that image')
    img.src = src
  }

  const addUpload = (file: File) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const c = document.createElement('canvas')
      const s = Math.min(1, 2600 / Math.max(img.naturalWidth, img.naturalHeight))
      c.width = Math.round(img.naturalWidth * s)
      c.height = Math.round(img.naturalHeight * s)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      const dataUrl = c.toDataURL('image/png') // keep alpha for cutout uploads
      snapshot()
      const piece: CanvasPiece = {
        id: Math.random().toString(36).slice(2, 9),
        src: dataUrl,
        x: CANVAS_W / 2,
        y: canvasH / 2,
        scale: 0.9,
        rotation: 0,
        w: c.width,
        h: c.height,
        title: file.name,
      }
      canvasStore.update(id, { pieces: [...(canvasStore.get(id)?.pieces || []), piece] })
      setSelected([piece.id])
    }
    img.src = url
  }

  const mutateSel = (fn: (p: CanvasPiece) => Partial<CanvasPiece>) => {
    if (!doc || !selPieces.length) return
    snapshot()
    canvasStore.update(id, { pieces: doc.pieces.map((p) => (selSet.has(p.id) ? { ...p, ...fn(p) } : p)) })
  }
  const removeSel = () => {
    if (!doc || !selPieces.length) return
    snapshot()
    canvasStore.update(id, { pieces: doc.pieces.filter((p) => !selSet.has(p.id)) })
    setSelected([])
  }
  const duplicateSel = () => {
    if (!doc || !selPieces.length) return
    snapshot()
    const copies = selPieces.map((p) => ({ ...p, id: Math.random().toString(36).slice(2, 9), x: p.x + 40, y: p.y + 40 }))
    canvasStore.update(id, { pieces: [...doc.pieces, ...copies] })
    setSelected(copies.map((c) => c.id))
  }
  const reorderSel = (dir: 1 | -1) => {
    if (!doc || !selPieces.length) return
    const pieces = doc.pieces.slice()
    // walk in the direction of travel so a multi-selection keeps its relative order
    const order = dir === 1 ? [...selPieces].reverse() : selPieces
    let changed = false
    for (const piece of order) {
      const idx = pieces.findIndex((p) => p.id === piece.id)
      const to = idx + dir
      if (to < 0 || to >= pieces.length || selSet.has(pieces[to].id)) continue
      pieces.splice(idx, 1)
      pieces.splice(to, 0, piece)
      changed = true
    }
    if (!changed) return
    snapshot()
    canvasStore.update(id, { pieces })
  }
  const selectAll = () => setSelected((doc?.pieces || []).filter((p) => !p.locked).map((p) => p.id))
  const toggleLock = (pid: string) => {
    if (!doc) return
    snapshot()
    canvasStore.update(id, { pieces: doc.pieces.map((p) => (p.id === pid ? { ...p, locked: !p.locked } : p)) })
  }
  // move one layer through the stack; +1 is toward the front
  const movePiece = (pid: string, dir: 1 | -1) => {
    if (!doc) return
    const idx = doc.pieces.findIndex((p) => p.id === pid)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= doc.pieces.length) return
    snapshot()
    const pieces = doc.pieces.slice()
    const [moved] = pieces.splice(idx, 1)
    pieces.splice(to, 0, moved)
    canvasStore.update(id, { pieces })
  }

  // ---- desktop: keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Escape') {
        if (picker || menu) return // their backdrops handle it
        if (selected.length) setSelected([])
        else onClose()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return }
      if (!selPieces.length) return
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); return }
      if (e.key === ']') { reorderSel(1); return }
      if (e.key === '[') { reorderSel(-1); return }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 20 : 5
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        mutateSel((p) => ({ x: p.x + dx, y: p.y + dy }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- desktop: wheel scales the selected piece (alt+wheel rotates) ----
  const wheelLive = useRef<{ active: boolean; timer: number; g: typeof gesture.current }>({ active: false, timer: 0, g: null })
  const liveRefs = useRef({ doc, selPieces, snapshot, startsOf, centroidOf, transformGroup })
  liveRefs.current = { doc, selPieces, snapshot, startsOf, centroidOf, transformGroup }
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const L = liveRefs.current
      if (!L.doc) return
      if (!L.selPieces.length || e.ctrlKey || e.metaKey) {
        // nothing selected (or a pinch-zoom gesture): zoom the whole artboard instead
        e.preventDefault()
        setView((v) => ({ ...v, z: Math.max(0.4, Math.min(6, v.z * Math.exp(-e.deltaY * 0.0015))) }))
        return
      }
      e.preventDefault()
      if (!wheelLive.current.active) {
        wheelLive.current.active = true
        L.snapshot()
        const ids = L.selPieces.map((p) => p.id)
        const { cx, cy } = L.centroidOf(ids)
        wheelLive.current.g = { kind: 'pinch', ids, px: 0, py: 0, starts: L.startsOf(ids), cx, cy, dist: 1, angle: 0 }
      }
      const g = wheelLive.current.g!
      // accumulate across the whole wheel burst so the gesture stays reversible
      if (e.altKey) g.angle = (g.angle || 0) + e.deltaY * 0.12
      else g.dist = Math.max(0.02, (g.dist || 1) * Math.exp(-e.deltaY * 0.0016))
      L.transformGroup(g, g.dist || 1, g.angle || 0)
      window.clearTimeout(wheelLive.current.timer)
      wheelLive.current.timer = window.setTimeout(() => {
        wheelLive.current.active = false
        wheelLive.current.g = null
        const cur = liveRefs.current.doc
        if (cur) canvasStore.update(cur.id, { pieces: cur.pieces })
      }, 350)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- lettering ----
  const commitText = useCallback(
    async (pieceId: string | null, props: TextProps) => {
      setBusy('Setting type…')
      try {
        const c = await renderTextPiece(props)
        const src = c.toDataURL('image/png')
        const cur = canvasStore.get(id)
        if (!cur) return
        snapshot()
        if (pieceId) {
          canvasStore.update(id, {
            pieces: cur.pieces.map((p) => (p.id === pieceId ? { ...p, src, w: c.width, h: c.height, text: props, title: props.value.slice(0, 40) } : p)),
          })
        } else {
          const piece: CanvasPiece = {
            id: Math.random().toString(36).slice(2, 9),
            src,
            x: CANVAS_W / 2,
            y: canvasH / 2,
            scale: 0.8,
            rotation: 0,
            w: c.width,
            h: c.height,
            title: props.value.slice(0, 40),
            text: props,
          }
          canvasStore.update(id, { pieces: [...cur.pieces, piece] })
          setSelected([piece.id])
        }
      } catch (e) {
        say('Could not set that type: ' + (e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [id, canvasH, snapshot, say],
  )

  // ---- export ----
  const renderCanvas = useCallback(async (scale = exportScale): Promise<HTMLCanvasElement> => {
    if (!doc) throw new Error('no canvas')
    const W = 2000 * scale
    const H = Math.round(W / doc.aspect)
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    const bg = bgValue(doc.background)
    const bgUrl = backgroundImageUrl(bg)
    if (bgUrl) {
      const img = await new Promise<HTMLImageElement>((ok, bad) => {
        const im = new Image()
        im.onload = () => ok(im)
        im.onerror = () => bad(new Error('background failed'))
        im.src = bgUrl
      })
      const deg = doc.bgRotate || 0
      const turned = deg % 180 !== 0
      const nw = img.naturalWidth
      const nh = img.naturalHeight
      const ew = turned ? nh : nw
      const eh = turned ? nw : nh
      // a cut-out sheet or garment keeps its silhouette (contain); a full-bleed paper covers
      const grow = bg.startsWith('garment:') ? 1.16 : 1
      const k = isContainedBackground(bg) ? Math.min(W / ew, H / eh) * grow : Math.max(W / ew, H / eh)
      ctx.save()
      ctx.translate(W / 2, H / 2)
      ctx.rotate((deg * Math.PI) / 180)
      const src = k > 1.8 ? upscale(img, Math.round(nw * k), Math.round(nh * k)) : img
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, (-nw * k) / 2, (-nh * k) / 2, nw * k, nh * k)
      ctx.restore()
    } else if (doc.background !== 'transparent') {
      ctx.fillStyle = doc.background
      ctx.fillRect(0, 0, W, H)
    }
    const k = W / CANVAS_W
    for (const p of doc.pieces) {
      const load = (url: string) =>
        new Promise<HTMLImageElement | null>((ok) => {
          const im = new Image()
          if (!url.startsWith('data:')) im.crossOrigin = 'anonymous'
          im.onload = () => ok(im)
          im.onerror = () => ok(null)
          im.src = url
        })
      // prefer the full-resolution original; fall back to the on-screen source if it won't load
      const img = (p.hi ? await load(p.hi) : null) || (await load(p.src))
      if (!img) continue
      const wpx = 500 * p.scale * k
      const hpx = (wpx * p.h) / p.w
      const drawSrc = wpx > img.naturalWidth * 1.8 ? upscale(img, Math.round(wpx), Math.round(hpx)) : img
      ctx.imageSmoothingQuality = 'high'
      ctx.save()
      ctx.translate(p.x * k, p.y * k)
      ctx.rotate((p.rotation * Math.PI) / 180)
      if (p.flipH) ctx.scale(-1, 1)
      ctx.drawImage(drawSrc, -wpx / 2, -hpx / 2, wpx, hpx)
      ctx.restore()
    }
    return c
  }, [doc, exportScale])

  const exportImage = useCallback(() => {
    setBusy('Rendering…')
    setTimeout(async () => {
      try {
        const c = await renderCanvas()
        const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'))
        if (!blob) throw new Error('render failed')
        await saveImage(blob, `${(doc?.name || 'canvas').replace(/[^a-zA-Z0-9._-]+/g, '-')}.png`)
      } catch (e) {
        say('Export failed: ' + (e as Error).message)
      } finally {
        setBusy(null)
      }
    }, 30)
  }, [renderCanvas, doc, say])

  const saveToEdits = useCallback(() => {
    setBusy('Saving…')
    setTimeout(async () => {
      try {
        const full = await renderCanvas()
        let url: string
        // (Save to Edits uploads a bounded rendition of this; Save/Download keeps the full size.)
        if (user) {
          // upload a bounded rendition; only downscale finished pixels until it fits the cap
          let c: HTMLCanvasElement = full
          if (c.width > 1600) {
            const s2 = document.createElement('canvas')
            s2.width = 1600
            s2.height = Math.round((1600 * c.height) / c.width)
            s2.getContext('2d')!.drawImage(c, 0, 0, s2.width, s2.height)
            c = s2
          }
          let blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'))
          while (blob && blob.size > 4_200_000 && c.width > 700) {
            const s2 = document.createElement('canvas')
            s2.width = Math.round(c.width * 0.8)
            s2.height = Math.round(c.height * 0.8)
            s2.getContext('2d')!.drawImage(c, 0, 0, s2.width, s2.height)
            c = s2
            blob = await new Promise((r) => c.toBlob(r, 'image/png'))
          }
          if (!blob) throw new Error('render failed')
          url = await uploadEdit(blob, 'image/png')
        } else {
          const small = document.createElement('canvas')
          small.width = 1200
          small.height = Math.round(1200 / (doc?.aspect || 1))
          small.getContext('2d')!.drawImage(full, 0, 0, small.width, small.height)
          url = small.toDataURL('image/jpeg', 0.85)
        }
        const item: Item = {
          id: `edits:${Date.now()}`,
          source: 'edits',
          sourceName: 'My edits',
          sourceUrl: '',
          title: `${doc?.name || 'Canvas'} · collage`,
          creator: 'Canvas studio',
          dateDisplay: new Date().toLocaleDateString(),
          yearStart: null,
          yearEnd: null,
          objectType: 'Canvas',
          medium: `${doc?.pieces.length ?? 0} pieces`,
          culture: null,
          place: null,
          publicDomain: null,
          rightsLabel: 'Collage of open collection works',
          licenseUrl: null,
          thumbnailUrl: url,
          imageUrl: url,
          originalImageUrl: url,
          width: null,
          height: null,
          contentType: 'image',
          files: [],
        }
        const board = boardStore.create('Edits', 'edits')
        boardStore.addItems(board.id, [item])
        say(user ? 'Saved to your Edits board' : 'Saved to Edits (this browser)')
      } catch (e) {
        say('Save failed: ' + (e as Error).message)
      } finally {
        setBusy(null)
      }
    }, 30)
  }, [renderCanvas, doc, user, say])

  if (!doc) {
    return (
      <div className="viewer canvas-studio">
        <div className="vtop">
          <button className="btn" onClick={onClose}>← Back</button>
          <strong style={{ fontSize: 13 }}>Canvas</strong>
        </div>
        <div className="empty"><p>This canvas no longer exists.</p></div>
      </div>
    )
  }

  const CHECKER = 'repeating-conic-gradient(#e3e0d9 0% 25%, #efece6 0% 50%)'
  const bgVal = bgValue(doc.background)
  const bgUrl = backgroundImageUrl(bgVal)
  const bgStyle: React.CSSProperties = bgUrl
    ? { backgroundImage: CHECKER, backgroundSize: '16px 16px' }
    : bgVal === 'transparent'
      ? { backgroundImage: CHECKER, backgroundSize: '16px 16px' }
      : { background: bgVal }
  // the sheet is a real element rather than a CSS background so it can be turned 90 degrees
  const bgImgStyle = (): React.CSSProperties | null => {
    if (!bgUrl || !bgNatural) return null
    const deg = doc.bgRotate || 0
    const turned = deg % 180 !== 0
    const ew = turned ? bgNatural.h : bgNatural.w
    const eh = turned ? bgNatural.w : bgNatural.h
    // garments read better filling more of the board than a strict contain
    const grow = bgVal.startsWith('garment:') ? 1.16 : 1
    const k = isContainedBackground(bgVal) ? Math.min(boardW / ew, boardH / eh) * grow : Math.max(boardW / ew, boardH / eh)
    return {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: bgNatural.w * k,
      height: bgNatural.h * k,
      transform: `translate(-50%, -50%) rotate(${deg}deg)`,
      pointerEvents: 'none',
    }
  }

  return (
    <div className="viewer canvas-studio" role="dialog" aria-modal="true">
      <div className="vtop">
        <button className="btn" onClick={onClose}>← Back</button>
        <button className="btn link" style={{ fontWeight: 700 }} onClick={() => { const n = prompt('Canvas name', doc.name); if (n) canvasStore.update(id, { name: n }) }}>{doc.name}</button>
        <button className="btn small" onClick={() => setMenu(true)}>☰</button>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={undo} disabled={!history.current.length} aria-label="Undo">↩</button>
        <button className="btn small" onClick={redo} disabled={!future.current.length} aria-label="Redo">↪</button>
        <button className="btn primary" onClick={exportImage} disabled={!!busy}>{isTouch() ? 'Save' : 'Download'}</button>
      </div>
      <div
        className="stage canvas-stage"
        ref={stageRef}
        style={{ touchAction: 'none', overflow: 'hidden', background: '#2a2925' }}
        onPointerDown={onStagePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        {busy && <div className="busy-pill" style={{ position: 'absolute', zIndex: 5 }}>{busy}</div>}
        <div className="artboard" ref={boardRef} style={{ width: boardW, height: boardH, transform: `translate(${view.x}px, ${view.y}px)`, ...bgStyle }}>
          {bgUrl && bgImgStyle() && <img className="artboard-bg" src={bgUrl} alt="" draggable={false} style={bgImgStyle()!} />}
          {snap.v && <div className="guide gv" />}
          {snap.h && <div className="guide gh" />}
          {marquee && (
            <div
              className="marquee"
              style={{
                left: Math.min(marquee.x0, marquee.x1) * unit,
                top: Math.min(marquee.y0, marquee.y1) * unit,
                width: Math.abs(marquee.x1 - marquee.x0) * unit,
                height: Math.abs(marquee.y1 - marquee.y0) * unit,
              }}
            />
          )}
          {doc.pieces.map((p) => {
            const wpx = 500 * p.scale * unit
            const hpx = (wpx * p.h) / p.w
            return (
              <div
                key={p.id}
                className={'piece' + (selSet.has(p.id) ? ' sel' : '')}
                style={{
                  width: wpx,
                  height: hpx,
                  left: p.x * unit - wpx / 2,
                  top: p.y * unit - hpx / 2,
                  transform: `rotate(${p.rotation}deg)${p.flipH ? ' scaleX(-1)' : ''}`,
                }}
                onPointerDown={(e) => onPiecePointerDown(e, p)}
              >
                <img src={p.src} alt={p.title || ''} draggable={false} />
                {one?.id === p.id && !p.locked && (
                  <>
                    {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                      <span key={c} className={'scale-handle ' + c} onPointerDown={(e) => onHandleDown(e, p, c)} />
                    ))}
                    <span className="rotate-handle" onPointerDown={(e) => onRotateDown(e, p)} title="Drag to rotate, hold shift to snap" />
                  </>
                )}
              </div>
            )
          })}
        </div>
        {doc.pieces.length > 0 && (
          <div className="layerstrip">
            {[...doc.pieces].reverse().map((p) => (
              <div key={p.id} className={'layerrow' + (selSet.has(p.id) ? ' sel' : '')}>
                <button
                  className={'layerthumb' + (selSet.has(p.id) ? ' sel' : '') + (p.locked ? ' locked' : '')}
                  onClick={(e) => setSelected(e.shiftKey ? (selSet.has(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id]) : [p.id])}
                  title={p.title || 'Layer'}
                >
                  <img src={p.src} alt="" draggable={false} />
                  <span className="layerlock" onClick={(e) => { e.stopPropagation(); toggleLock(p.id) }} title={p.locked ? 'Unlock this layer' : 'Lock this layer'}>
                    {p.locked ? '🔒' : '🔓'}
                  </span>
                </button>
                {selSet.has(p.id) && (
                  <div className="layermove">
                    <button onClick={() => movePiece(p.id, 1)} disabled={doc.pieces[doc.pieces.length - 1]?.id === p.id} title="Bring forward">▲</button>
                    <button onClick={() => movePiece(p.id, -1)} disabled={doc.pieces[0]?.id === p.id} title="Send back">▼</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="zoombar">
          <button onClick={() => setView((v) => ({ ...v, z: Math.max(0.4, v.z / 1.25) }))} title="Zoom out">−</button>
          <button className="zoomlabel" onClick={() => setView({ z: 1, x: 0, y: 0 })} title="Fit the canvas">{Math.round(view.z * 100)}%</button>
          <button onClick={() => setView((v) => ({ ...v, z: Math.min(6, v.z * 1.25) }))} title="Zoom in">+</button>
        </div>
        {doc.pieces.length === 0 && !busy && (
          <div className="ph" style={{ position: 'absolute', color: '#bdb9af', textAlign: 'center' }}>
            <p style={{ margin: 0 }}>Empty canvas</p>
            <p style={{ margin: '4px 0 0', fontSize: 12 }}>Add images from your edits, boards, or device.</p>
          </div>
        )}
      </div>
      <div className="canvas-dock">
        <div className="chips" style={{ margin: 0 }}>
          <button className="btn small primary" onClick={() => setPicker(true)}>+ Add image</button>
          <button className="btn small" onClick={() => setTextEdit({ id: null, props: { ...TEXT_DEFAULTS } })}>+ Add text</button>
          <button className="btn small" onClick={() => setBgPicker(true)} style={{ gap: 6 }}>
            <span
              className="bg-swatch"
              style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : bgVal === 'transparent' ? { backgroundImage: CHECKER, backgroundSize: '8px 8px' } : { background: bgVal }}
            />
            {isSheetValue(bgVal) ? backgroundLabel(bgVal) : bgVal === 'transparent' ? 'Transparent' : 'Colour'}
          </button>
          {isSheetValue(bgVal) && (
            <button className="btn small" onClick={() => { snapshot(); canvasStore.update(id, { bgRotate: ((doc.bgRotate || 0) + 90) % 360 }) }} title="Turn the sheet 90 degrees">
              Rotate
            </button>
          )}
          <select className="input btn-like" value={String(doc.aspect)} onChange={(e) => { snapshot(); canvasStore.update(id, { aspect: Number(e.target.value) }) }}>
            {ASPECTS.map((a) => (
              <option key={a.label} value={String(a.value)}>{a.label}</option>
            ))}
          </select>
          <select
            className="input btn-like"
            title="Export resolution"
            value={String(exportScale)}
            onChange={(e) => setExportScale(Number(e.target.value))}
          >
            {[1, 2, 3].map((k) => (
              <option key={k} value={String(k)} title={`${2000 * k} × ${Math.round((2000 * k) / doc.aspect)} px`}>
                {2000 * k} px
              </option>
            ))}
          </select>
          <button className="btn small" onClick={saveToEdits} disabled={!!busy || !doc.pieces.length}>Save to Edits</button>
        </div>
        <p className="desktop-hint faint">Scroll to zoom the canvas, drag around it to pan · drag empty canvas to select several · scroll to scale · alt+scroll rotates · arrows nudge · [ ] reorder · ⌫ removes</p>
        {selPieces.length > 0 && (
          <div className="chips" style={{ margin: '6px 0 0' }}>
            <span className="faint" style={{ fontSize: 11, alignSelf: 'center', flex: '0 0 auto' }}>
              {selPieces.length === 1 ? 'Selected:' : `${selPieces.length} selected:`}
            </span>
            {one && !one.locked && (
              <button
                className="btn small"
                onClick={() => {
                  setBusy('Opening…')
                  const im = new Image()
                  if (!one.src.startsWith('data:')) im.crossOrigin = 'anonymous'
                  im.onload = () => {
                    const c = document.createElement('canvas')
                    c.width = im.naturalWidth
                    c.height = im.naturalHeight
                    c.getContext('2d')!.drawImage(im, 0, 0)
                    setErasing({ id: one.id, canvas: c })
                    setBusy(null)
                  }
                  im.onerror = () => {
                    say('Could not open that piece for erasing')
                    setBusy(null)
                  }
                  im.src = one.src
                }}
              >
                Erase
              </button>
            )}
            {one?.text && (
              <button className="btn small" onClick={() => setTextEdit({ id: one.id, props: one.text! })}>Edit text</button>
            )}
            <button className="btn small" onClick={() => mutateSel((p) => ({ flipH: !p.flipH }))}>Flip</button>
            <button className="btn small" onClick={() => mutateSel(() => ({ rotation: 0 }))}>Straighten</button>
            <button className="btn small" onClick={duplicateSel}>Duplicate</button>
            <button className="btn small" onClick={() => reorderSel(1)}>Forward</button>
            <button className="btn small" onClick={() => reorderSel(-1)}>Back</button>
            <button className="btn small" onClick={() => selPieces.forEach((p) => toggleLock(p.id))}>
              {selPieces.every((p) => p.locked) ? 'Unlock' : 'Lock'}
            </button>
            <button className="btn small danger" onClick={removeSel}>Remove</button>
            {doc.pieces.length > selPieces.length && <button className="btn small" onClick={selectAll}>Select all</button>}
            <button className="btn small" onClick={() => setSelected([])}>Deselect</button>
          </div>
        )}
        {!selPieces.length && doc.pieces.length > 1 && (
          <div className="chips" style={{ margin: '6px 0 0' }}>
            <span className="faint" style={{ fontSize: 11, alignSelf: 'center', flex: '0 0 auto' }}>Drag across the canvas to select several ·</span>
            <button className="btn small" onClick={selectAll}>Select all</button>
          </div>
        )}
      </div>

      {erasing && (
        <MaskTool
          original={erasing.canvas}
          current={erasing.canvas}
          onApply={(c) => {
            snapshot()
            const cur = canvasStore.get(id)
            if (cur) {
              canvasStore.update(id, {
                pieces: cur.pieces.map((p) =>
                  p.id === erasing.id ? { ...p, src: c.toDataURL('image/png'), hi: undefined, w: c.width, h: c.height } : p,
                ),
              })
            }
            setErasing(null)
          }}
          onClose={() => setErasing(null)}
        />
      )}
      {bgPicker && (
        <BackgroundPicker
          value={bgVal}
          color={isSheetValue(bgVal) || bgVal === 'transparent' ? '#f3f1e8' : bgVal}
          rotate={doc.bgRotate || 0}
          onRotate={(deg) => canvasStore.update(id, { bgRotate: deg })}
          onColor={(hex) => canvasStore.update(id, { background: hex, bgRotate: 0 })}
          onPick={(v) => { snapshot(); canvasStore.update(id, { background: v === 'none' ? '#f3f1e8' : v, bgRotate: 0 }) }}
          onClose={() => setBgPicker(false)}
        />
      )}
      {textEdit && (
        <TextSheet
          initial={textEdit.props}
          isNew={!textEdit.id}
          onClose={() => setTextEdit(null)}
          onApply={(props) => {
            void commitText(textEdit.id, props)
            setTextEdit(null)
          }}
        />
      )}
      {picker && <AddPicker onAdd={addFromItem} onUpload={addUpload} onClose={() => setPicker(false)} />}
      {menu && (
        <CanvasMenu
          currentId={id}
          onClose={() => setMenu(false)}
          onOpen={(cid) => {
            setMenu(false)
            if (cid !== id) location.hash = `#/canvas/${cid}`
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function TextSheet({ initial, isNew, onApply, onClose }: { initial: TextProps; isNew: boolean; onApply: (p: TextProps) => void; onClose: () => void }) {
  const [p, setP] = useState<TextProps>(initial)
  const set = <K extends keyof TextProps>(k: K, v: TextProps[K]) => setP((cur) => ({ ...cur, [k]: v }))
  const font = FONTS.find((f) => f.css === p.font) || FONTS[0]
  return (
    <>
      <div className="backdrop" style={{ zIndex: 86 }} onClick={onClose} />
      <div className="pop text-pop" style={{ zIndex: 87 }} role="dialog" aria-modal="true">
        <span className="label">{isNew ? 'Add text' : 'Edit text'}</span>
        <textarea
          className="input"
          rows={2}
          value={p.value}
          autoFocus
          onChange={(e) => set('value', e.target.value)}
          style={{ fontFamily: p.font, fontWeight: p.weight, fontStyle: p.italic ? 'italic' : 'normal', fontSize: 18, marginBottom: 8, resize: 'vertical' }}
        />
        <div className="controls-wrap" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
          <div>
            <span className="label">Typeface</span>
            <select className="input" value={p.font} onChange={(e) => { const f = FONTS.find((x) => x.css === e.target.value)!; setP((cur) => ({ ...cur, font: f.css, weight: f.weights.includes(cur.weight) ? cur.weight : f.weights[0] })) }}>
              {FONTS.map((f) => (
                <option key={f.css} value={f.css}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Weight</span>
            <select className="input" value={String(p.weight)} onChange={(e) => set('weight', Number(e.target.value))}>
              {font.weights.map((w) => (
                <option key={w} value={String(w)}>{w === 400 ? 'Regular' : w === 700 ? 'Bold' : w === 900 ? 'Black' : String(w)}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Colour</span>
            <div className="row" style={{ gap: 8 }}>
              <input type="color" value={p.color} onChange={(e) => set('color', e.target.value)} />
              <label className="check"><input type="checkbox" checked={p.italic} onChange={(e) => set('italic', e.target.checked)} /> Italic</label>
            </div>
          </div>
          <div>
            <span className="label">Align</span>
            <div className="seg">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} type="button" className={p.align === a ? 'active' : ''} onClick={() => set('align', a)}>{a}</button>
              ))}
            </div>
          </div>
          <label className="slider">
            <span className="label">Tracking · {p.tracking.toFixed(2)}em</span>
            <input type="range" min={-0.08} max={0.5} step={0.01} value={p.tracking} onChange={(e) => set('tracking', Number(e.target.value))} />
          </label>
          <label className="slider">
            <span className="label">Leading · {p.leading.toFixed(2)}</span>
            <input type="range" min={0.85} max={2} step={0.01} value={p.leading} onChange={(e) => set('leading', Number(e.target.value))} />
          </label>
          <div>
            <span className="label">Shape</span>
            <select className="input" value={p.shape} onChange={(e) => set('shape', e.target.value as TextProps['shape'])}>
              {TEXT_SHAPES.map((sh) => (
                <option key={sh.key} value={sh.key}>{sh.label}</option>
              ))}
            </select>
          </div>
          {(p.shape === 'arch' || p.shape === 'valley') && (
            <label className="slider">
              <span className="label">Curve · {Math.round(p.curve * 100)}%</span>
              <input type="range" min={0.15} max={1} step={0.05} value={p.curve} onChange={(e) => set('curve', Number(e.target.value))} />
            </label>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <span className="label">Effect</span>
            <select className="input" value={p.effect || 'none'} onChange={(e) => set('effect', e.target.value as TextProps['effect'])}>
              <option value="none">None</option>
              {EFFECTS.map((e2) => (
                <option key={e2.key} value={e2.key}>{e2.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={() => onApply(p)} disabled={!p.value.trim()}>{isNew ? 'Add to canvas' : 'Update'}</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}

function AddPicker({ onAdd, onUpload, onClose }: { onAdd: (i: Item) => void; onUpload: (f: File) => void; onClose: () => void }) {
  const [boards, setBoards] = useState<Board[]>(boardStore.list())
  useEffect(() => boardStore.subscribe(() => setBoards(boardStore.list())), [])
  const ordered = useMemo(() => {
    const edits = boards.filter((b) => b.id === 'edits')
    const favs = boards.filter((b) => b.id === 'favorites')
    const rest = boards.filter((b) => b.id !== 'edits' && b.id !== 'favorites')
    // Edits leads even when empty — canvas pieces should primarily come from your edits
    return [...edits, ...favs, ...rest].filter((b) => b.id === 'edits' || b.items.length)
  }, [boards])
  return (
    <>
      <div className="backdrop" style={{ zIndex: 75 }} onClick={onClose} />
      <div className="pop picker-pop">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="label" style={{ margin: 0 }}>Add image</span>
          <label className="btn small">
            Upload
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { onUpload(f); onClose() } }} />
          </label>
        </div>
        <div className="picker-scroll">
          {ordered.length === 0 && <p className="faint" style={{ fontSize: 13 }}>Nothing saved yet. Favorite items or save edits first, or upload from your device.</p>}
          {ordered.map((b) => (
            <div key={b.id}>
              <h4 className="picker-h">{b.id === 'edits' ? 'Your edits' : b.name}</h4>
              {b.id === 'edits' && !b.items.length && (
                <p className="faint" style={{ fontSize: 12, margin: '2px 0 8px' }}>Nothing here yet. Open any image, tap Edit, and use “Save to Edits”. Your edits land here ready to collage.</p>
              )}
              <div className="picker-grid">
                {b.items.map((it) => (
                  <button key={it.id} className="picker-cell" onClick={() => onAdd(it)}>
                    <img src={it.thumbnailUrl || ''} alt={it.title} loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 8 }} onClick={onClose}>Done</button>
      </div>
    </>
  )
}

function CanvasMenu({ currentId, onClose, onOpen }: { currentId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [docs, setDocs] = useState(canvasStore.list())
  useEffect(() => canvasStore.subscribe(() => setDocs(canvasStore.list())), [])
  return (
    <>
      <div className="backdrop" style={{ zIndex: 75 }} onClick={onClose} />
      <div className="pop picker-pop">
        <span className="label">Your canvases</span>
        <p className="faint" style={{ fontSize: 12, margin: '2px 0 8px' }}>Canvases save automatically as you work. Reopen any of them here to keep editing or export again.</p>
        <div className="list">
          {docs.map((d) => (
            <button key={d.id} onClick={() => onOpen(d.id)}>
              {d.id === currentId ? '● ' : ''}{d.name}
              <span>{d.pieces.length} {d.pieces.length === 1 ? 'piece' : 'pieces'} · {new Date(d.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className="btn primary" onClick={() => { const n = prompt('Name your canvas', `Canvas ${docs.length + 1}`); onOpen(canvasStore.create(n || undefined).id) }}>New canvas</button>
          <button className="btn" onClick={() => { const cur = canvasStore.get(currentId); const n = prompt('Canvas name', cur?.name); if (n) canvasStore.update(currentId, { name: n }) }}>Rename</button>
          {docs.length > 1 && (
            <button className="btn danger" onClick={() => { if (confirm('Delete this canvas?')) { canvasStore.remove(currentId); onOpen(canvasStore.list()[0]?.id || canvasStore.create().id) } }}>
              Delete current
            </button>
          )}
        </div>
      </div>
    </>
  )
}
