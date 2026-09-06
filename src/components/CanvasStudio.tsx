// Canvas studio (mobile-first): arrange saved edits, board items and uploads on one artboard —
// drag to move, pinch to scale/rotate, layer strip, paper backgrounds, undo, export/share.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boardStore, type Board } from '../lib/boards'
import { canvasStore, rememberCanvas, type CanvasDoc, type CanvasPiece } from '../lib/canvas'
import { PAPER_SHEETS, paperUrl, sheetDef } from '../lib/papers'
import { proxyImageUrl, uploadEdit } from '../lib/api'
import { saveImage } from '../lib/save'
import { onAuthChange } from '../lib/account'
import { useBodyLock } from './Panels'
import type { Item } from '../../shared/types'

const CANVAS_W = 1000 // internal units; height = CANVAS_W / aspect
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
    kind: 'move' | 'pinch' | 'handle' | 'marquee'
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
  const boardW = Math.min(stageSize.w - 24, (stageSize.h - 24) * aspect)
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
    } else if (e.target === boardRef.current || e.target === stageRef.current) {
      // drag across empty canvas to sweep up everything inside the rectangle
      const pt = clientToCanvas(e.clientX, e.clientY)
      gesture.current = { kind: 'marquee', ids: [], px: pt.x, py: pt.y, starts: new Map() }
      setMarquee({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
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
        // corner handle: distance from piece center controls scale
        const piece = doc.pieces.find((p) => p.id === g.ids[0])
        const st = g.starts.get(g.ids[0])
        if (piece && st) {
          const d = Math.hypot(pt.x - piece.x, pt.y - piece.y)
          const baseHalfDiag = (Math.hypot(500, (500 * piece.h) / piece.w) * st.scale) / 2
          updatePieces((p) => (p.id === piece.id ? { scale: Math.max(0.05, Math.min(4, (st.scale * d) / Math.max(1, baseHalfDiag))) } : null))
        }
      }
      g.moved = true
    }
  }

  const endGesture = (e: React.PointerEvent) => {
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

  const onHandleDown = (e: React.PointerEvent, p: CanvasPiece) => {
    e.stopPropagation()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    snapshot()
    gesture.current = { kind: 'handle', ids: [p.id], px: 0, py: 0, starts: startsOf([p.id]) }
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
  const selectAll = () => setSelected((doc?.pieces || []).map((p) => p.id))

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
      if (!L.doc || !L.selPieces.length) return
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

  // ---- export ----
  const renderCanvas = useCallback(async (scale = exportScale): Promise<HTMLCanvasElement> => {
    if (!doc) throw new Error('no canvas')
    const W = 2000 * scale
    const H = Math.round(W / doc.aspect)
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    if (doc.background.startsWith('paper:')) {
      const slug = doc.background.slice(6)
      const img = await new Promise<HTMLImageElement>((ok, bad) => {
        const im = new Image()
        im.onload = () => ok(im)
        im.onerror = () => bad(new Error('paper failed'))
        im.src = paperUrl(slug)
      })
      if (sheetDef(slug)?.edge) {
        // silhouette sheet: contained and centered, surround stays transparent
        const fit = Math.min(W / img.naturalWidth, H / img.naturalHeight)
        ctx.drawImage(img, (W - img.naturalWidth * fit) / 2, (H - img.naturalHeight * fit) / 2, img.naturalWidth * fit, img.naturalHeight * fit)
      } else {
        const cover = Math.max(W / img.naturalWidth, H / img.naturalHeight)
        ctx.drawImage(img, (W - img.naturalWidth * cover) / 2, (H - img.naturalHeight * cover) / 2, img.naturalWidth * cover, img.naturalHeight * cover)
      }
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
      ctx.save()
      ctx.translate(p.x * k, p.y * k)
      ctx.rotate((p.rotation * Math.PI) / 180)
      if (p.flipH) ctx.scale(-1, 1)
      ctx.drawImage(img, -wpx / 2, -hpx / 2, wpx, hpx)
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
  const bgSlug = doc.background.startsWith('paper:') ? doc.background.slice(6) : null
  const bgEdge = bgSlug ? sheetDef(bgSlug)?.edge : false
  const bgStyle: React.CSSProperties = bgSlug
    ? bgEdge
      ? {
          // edge sheet: keep its silhouette — contained on a transparent board
          backgroundImage: `url(${paperUrl(bgSlug)}), ${CHECKER}`,
          backgroundSize: 'contain, 16px 16px',
          backgroundRepeat: 'no-repeat, repeat',
          backgroundPosition: 'center, 0 0',
        }
      : { backgroundImage: `url(${paperUrl(bgSlug)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : doc.background === 'transparent'
      ? { backgroundImage: CHECKER, backgroundSize: '16px 16px' }
      : { background: doc.background }

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
        <div className="artboard" ref={boardRef} style={{ width: boardW, height: boardH, ...bgStyle }}>
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
                {one?.id === p.id && <span className="scale-handle" onPointerDown={(e) => onHandleDown(e, p)} />}
              </div>
            )
          })}
        </div>
        {doc.pieces.length > 0 && (
          <div className="layerstrip">
            {[...doc.pieces].reverse().map((p) => (
              <button
                key={p.id}
                className={'layerthumb' + (selSet.has(p.id) ? ' sel' : '')}
                onClick={(e) => setSelected(e.shiftKey ? (selSet.has(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id]) : [p.id])}
              >
                <img src={p.src} alt="" draggable={false} />
              </button>
            ))}
          </div>
        )}
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
          <select className="input btn-like" value={doc.background.startsWith('paper:') ? doc.background : doc.background === 'transparent' ? 'transparent' : 'color'} onChange={(e) => {
            const v = e.target.value
            snapshot()
            if (v === 'color') canvasStore.update(id, { background: '#f3f1e8' })
            else canvasStore.update(id, { background: v })
          }}>
            <option value="color">Color…</option>
            <option value="transparent">Transparent</option>
            <optgroup label="Papers">
              {PAPER_SHEETS.filter((t) => t.group === 'paper').map((t) => (
                <option key={t.slug} value={'paper:' + t.slug}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Deckle and torn edges">
              {PAPER_SHEETS.filter((t) => t.group === 'edge').map((t) => (
                <option key={t.slug} value={'paper:' + t.slug}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Fabric">
              {PAPER_SHEETS.filter((t) => t.group === 'fabric').map((t) => (
                <option key={t.slug} value={'paper:' + t.slug}>{t.label}</option>
              ))}
            </optgroup>
          </select>
          {!doc.background.startsWith('paper:') && doc.background !== 'transparent' && (
            <input type="color" value={doc.background} onChange={(e) => canvasStore.update(id, { background: e.target.value })} style={{ width: 34, height: 28, border: '1px solid var(--line-2)', borderRadius: 3, background: '#fff', padding: 2 }} />
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
        <p className="desktop-hint faint">Drag empty canvas to select several · scroll to scale · alt+scroll rotates · arrows nudge · [ ] reorder · ⌫ removes</p>
        {selPieces.length > 0 && (
          <div className="chips" style={{ margin: '6px 0 0' }}>
            <span className="faint" style={{ fontSize: 11, alignSelf: 'center', flex: '0 0 auto' }}>
              {selPieces.length === 1 ? 'Selected:' : `${selPieces.length} selected:`}
            </span>
            <button className="btn small" onClick={() => mutateSel((p) => ({ flipH: !p.flipH }))}>Flip</button>
            <button className="btn small" onClick={() => mutateSel(() => ({ rotation: 0 }))}>Straighten</button>
            <button className="btn small" onClick={duplicateSel}>Duplicate</button>
            <button className="btn small" onClick={() => reorderSel(1)}>Forward</button>
            <button className="btn small" onClick={() => reorderSel(-1)}>Back</button>
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
