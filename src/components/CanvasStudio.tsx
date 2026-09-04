// Canvas studio (mobile-first): arrange saved edits, board items and uploads on one artboard —
// drag to move, pinch to scale/rotate, layer strip, paper backgrounds, undo, export/share.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boardStore, type Board } from '../lib/boards'
import { canvasStore, type CanvasDoc, type CanvasPiece } from '../lib/canvas'
import { PAPER_SHEETS, paperUrl } from '../lib/papers'
import { proxyImageUrl, uploadEdit } from '../lib/api'
import { saveBlob } from '../lib/zip'
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

export default function CanvasStudio({ id, onClose }: Props) {
  useBodyLock()
  const [doc, setDoc] = useState<CanvasDoc | null>(canvasStore.get(id) ?? null)
  const [selected, setSelected] = useState<string | null>(null)
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
    kind: 'move' | 'pinch' | 'handle'
    pieceId: string
    startX: number
    startY: number
    px: number
    py: number
    scale: number
    rotation: number
    dist?: number
    angle?: number
    moved?: boolean
  }>(null)

  useEffect(() => onAuthChange((s) => setUser(s.user)), [])
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

  const updatePiece = useCallback(
    (pid: string, patch: Partial<CanvasPiece>, commitDoc = false) => {
      if (!doc) return
      const pieces = doc.pieces.map((p) => (p.id === pid ? { ...p, ...patch } : p))
      if (commitDoc) canvasStore.update(id, { pieces })
      else setDoc({ ...doc, pieces }) // transient while gesturing
    },
    [doc, id],
  )

  // ---- gestures ----
  const clientToCanvas = (cx: number, cy: number) => {
    const r = boardRef.current!.getBoundingClientRect()
    return { x: (cx - r.left) / unit, y: (cy - r.top) / unit }
  }

  const onPiecePointerDown = (e: React.PointerEvent, p: CanvasPiece) => {
    e.stopPropagation()
    setSelected(p.id)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      snapshot()
      const pt = clientToCanvas(e.clientX, e.clientY)
      gesture.current = { kind: 'move', pieceId: p.id, startX: p.x, startY: p.y, px: pt.x, py: pt.y, scale: p.scale, rotation: p.rotation }
    }
  }

  const onStagePointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const sel = doc?.pieces.find((p) => p.id === selected)
    if (pointers.current.size === 2 && sel) {
      const [a, b] = [...pointers.current.values()]
      snapshot()
      gesture.current = {
        kind: 'pinch',
        pieceId: sel.id,
        startX: sel.x,
        startY: sel.y,
        px: 0,
        py: 0,
        scale: sel.scale,
        rotation: sel.rotation,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      }
    } else if (e.target === boardRef.current || e.target === stageRef.current) {
      setSelected(null)
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
      updatePiece(g.pieceId, {
        scale: Math.max(0.05, Math.min(4, (g.scale * dist) / (g.dist || 1))),
        rotation: g.rotation + (angle - (g.angle || 0)),
      })
      g.moved = true
    } else if ((g.kind === 'move' || g.kind === 'handle') && pointers.current.size === 1) {
      const pt = clientToCanvas(e.clientX, e.clientY)
      if (g.kind === 'move') {
        let nx = g.startX + (pt.x - g.px)
        let ny = g.startY + (pt.y - g.py)
        const sv = Math.abs(nx - CANVAS_W / 2) < 14
        const sh = Math.abs(ny - canvasH / 2) < 14
        if (sv) nx = CANVAS_W / 2
        if (sh) ny = canvasH / 2
        setSnap({ v: sv, h: sh })
        updatePiece(g.pieceId, { x: nx, y: ny })
      } else {
        // corner handle: distance from piece center controls scale
        const piece = doc.pieces.find((p) => p.id === g.pieceId)
        if (piece) {
          const d = Math.hypot(pt.x - piece.x, pt.y - piece.y)
          const baseHalfDiag = (Math.hypot(500, (500 * piece.h) / piece.w) * g.scale) / 2
          updatePiece(g.pieceId, { scale: Math.max(0.05, Math.min(4, (g.scale * d) / Math.max(1, baseHalfDiag)) ) })
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
      if (g.moved && doc) canvasStore.update(id, { pieces: doc.pieces })
      else history.current.pop() // no-op gesture: drop the snapshot
    }
  }

  const onHandleDown = (e: React.PointerEvent, p: CanvasPiece) => {
    e.stopPropagation()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    snapshot()
    gesture.current = { kind: 'handle', pieceId: p.id, startX: p.x, startY: p.y, px: 0, py: 0, scale: p.scale, rotation: p.rotation }
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
      }
      canvasStore.update(id, { pieces: [...(canvasStore.get(id)?.pieces || []), piece] })
      setSelected(piece.id)
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
      const s = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight))
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
      setSelected(piece.id)
    }
    img.src = url
  }

  const sel = doc?.pieces.find((p) => p.id === selected) || null
  const mutateSel = (fn: (p: CanvasPiece) => Partial<CanvasPiece>) => {
    if (!doc || !sel) return
    snapshot()
    canvasStore.update(id, { pieces: doc.pieces.map((p) => (p.id === sel.id ? { ...p, ...fn(p) } : p)) })
  }
  const removeSel = () => {
    if (!doc || !sel) return
    snapshot()
    canvasStore.update(id, { pieces: doc.pieces.filter((p) => p.id !== sel.id) })
    setSelected(null)
  }
  const duplicateSel = () => {
    if (!doc || !sel) return
    snapshot()
    const copy = { ...sel, id: Math.random().toString(36).slice(2, 9), x: sel.x + 40, y: sel.y + 40 }
    canvasStore.update(id, { pieces: [...doc.pieces, copy] })
    setSelected(copy.id)
  }
  const reorderSel = (dir: 1 | -1) => {
    if (!doc || !sel) return
    const idx = doc.pieces.findIndex((p) => p.id === sel.id)
    const to = idx + dir
    if (to < 0 || to >= doc.pieces.length) return
    snapshot()
    const pieces = doc.pieces.slice()
    pieces.splice(idx, 1)
    pieces.splice(to, 0, sel)
    canvasStore.update(id, { pieces })
  }

  // ---- desktop: keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Escape') {
        if (picker || menu) return // their backdrops handle it
        if (selected) setSelected(null)
        else onClose()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (!sel) return
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
  const wheelLive = useRef<{ active: boolean; timer: number }>({ active: false, timer: 0 })
  const liveRefs = useRef({ doc, sel, snapshot, updatePiece })
  liveRefs.current = { doc, sel, snapshot, updatePiece }
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const { doc: d, sel: sp, snapshot: snap, updatePiece: upd } = liveRefs.current
      if (!d || !sp) return
      e.preventDefault()
      if (!wheelLive.current.active) {
        wheelLive.current.active = true
        snap()
      }
      if (e.altKey) {
        upd(sp.id, { rotation: sp.rotation + e.deltaY * 0.12 })
      } else {
        const f = Math.exp(-e.deltaY * 0.0016)
        upd(sp.id, { scale: Math.max(0.05, Math.min(4, sp.scale * f)) })
      }
      window.clearTimeout(wheelLive.current.timer)
      wheelLive.current.timer = window.setTimeout(() => {
        wheelLive.current.active = false
        const cur = liveRefs.current.doc
        if (cur) canvasStore.update(cur.id, { pieces: cur.pieces })
      }, 350)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- export ----
  const renderCanvas = useCallback(async (): Promise<HTMLCanvasElement> => {
    if (!doc) throw new Error('no canvas')
    const W = 2000
    const H = Math.round(W / doc.aspect)
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    if (doc.background.startsWith('paper:')) {
      const img = await new Promise<HTMLImageElement>((ok, bad) => {
        const im = new Image()
        im.onload = () => ok(im)
        im.onerror = () => bad(new Error('paper failed'))
        im.src = paperUrl(doc.background.slice(6))
      })
      const cover = Math.max(W / img.naturalWidth, H / img.naturalHeight)
      ctx.drawImage(img, (W - img.naturalWidth * cover) / 2, (H - img.naturalHeight * cover) / 2, img.naturalWidth * cover, img.naturalHeight * cover)
    } else if (doc.background !== 'transparent') {
      ctx.fillStyle = doc.background
      ctx.fillRect(0, 0, W, H)
    }
    const k = W / CANVAS_W
    for (const p of doc.pieces) {
      const img = await new Promise<HTMLImageElement | null>((ok) => {
        const im = new Image()
        if (!p.src.startsWith('data:')) im.crossOrigin = 'anonymous'
        im.onload = () => ok(im)
        im.onerror = () => ok(null)
        im.src = p.src
      })
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
  }, [doc])

  const exportImage = useCallback(() => {
    setBusy('Rendering…')
    setTimeout(async () => {
      try {
        const c = await renderCanvas()
        const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'))
        if (!blob) throw new Error('render failed')
        const file = new File([blob], `${(doc?.name || 'canvas').replace(/[^a-zA-Z0-9._-]+/g, '-')}.png`, { type: 'image/png' })
        if (isTouch() && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: doc?.name }).catch(() => saveBlob(blob, file.name))
        } else {
          saveBlob(blob, file.name)
        }
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
          title: `${doc?.name || 'Canvas'} — collage`,
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

  const bgStyle: React.CSSProperties = doc.background.startsWith('paper:')
    ? { backgroundImage: `url(${paperUrl(doc.background.slice(6))})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : doc.background === 'transparent'
      ? { backgroundImage: 'repeating-conic-gradient(#e3e0d9 0% 25%, #efece6 0% 50%)', backgroundSize: '16px 16px' }
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
          {doc.pieces.map((p) => {
            const wpx = 500 * p.scale * unit
            const hpx = (wpx * p.h) / p.w
            return (
              <div
                key={p.id}
                className={'piece' + (p.id === selected ? ' sel' : '')}
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
                {p.id === selected && <span className="scale-handle" onPointerDown={(e) => onHandleDown(e, p)} />}
              </div>
            )
          })}
        </div>
        {doc.pieces.length > 0 && (
          <div className="layerstrip">
            {[...doc.pieces].reverse().map((p) => (
              <button key={p.id} className={'layerthumb' + (p.id === selected ? ' sel' : '')} onClick={() => setSelected(p.id)}>
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
            {PAPER_SHEETS.filter((t) => !t.edge).map((t) => (
              <option key={t.slug} value={'paper:' + t.slug}>{t.label} paper</option>
            ))}
          </select>
          {!doc.background.startsWith('paper:') && doc.background !== 'transparent' && (
            <input type="color" value={doc.background} onChange={(e) => canvasStore.update(id, { background: e.target.value })} style={{ width: 34, height: 28, border: '1px solid var(--line-2)', borderRadius: 3, background: '#fff', padding: 2 }} />
          )}
          <select className="input btn-like" value={String(doc.aspect)} onChange={(e) => { snapshot(); canvasStore.update(id, { aspect: Number(e.target.value) }) }}>
            {ASPECTS.map((a) => (
              <option key={a.label} value={String(a.value)}>{a.label}</option>
            ))}
          </select>
          <button className="btn small" onClick={saveToEdits} disabled={!!busy || !doc.pieces.length}>Save to Edits</button>
        </div>
        <p className="desktop-hint faint">Drag to move · scroll to scale · alt+scroll rotates · arrows nudge · [ ] reorder · ⌫ removes</p>
        {sel && (
          <div className="chips" style={{ margin: '6px 0 0' }}>
            <span className="faint" style={{ fontSize: 11, alignSelf: 'center', flex: '0 0 auto' }}>Selected:</span>
            <button className="btn small" onClick={() => mutateSel((p) => ({ flipH: !p.flipH }))}>Flip</button>
            <button className="btn small" onClick={() => mutateSel(() => ({ rotation: 0 }))}>Straighten</button>
            <button className="btn small" onClick={duplicateSel}>Duplicate</button>
            <button className="btn small" onClick={() => reorderSel(1)}>Forward</button>
            <button className="btn small" onClick={() => reorderSel(-1)}>Back</button>
            <button className="btn small danger" onClick={removeSel}>Remove</button>
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
          {ordered.length === 0 && <p className="faint" style={{ fontSize: 13 }}>Nothing saved yet — favorite items or save edits first, or upload from your device.</p>}
          {ordered.map((b) => (
            <div key={b.id}>
              <h4 className="picker-h">{b.id === 'edits' ? 'Your edits' : b.name}</h4>
              {b.id === 'edits' && !b.items.length && (
                <p className="faint" style={{ fontSize: 12, margin: '2px 0 8px' }}>Nothing here yet — open any image, tap Edit, and use “Save to Edits”. Your edits land here ready to collage.</p>
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
        <div className="list">
          {docs.map((d) => (
            <button key={d.id} onClick={() => onOpen(d.id)}>
              {d.id === currentId ? '● ' : ''}{d.name} <span>{d.pieces.length}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => onOpen(canvasStore.create().id)}>New canvas</button>
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
