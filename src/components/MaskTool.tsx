// Erase & restore (mask refinement): paint away parts of an image or paint the original back,
// with a soft brush, deep pinch-zoom, invert / soften / shrink / expand, and undo — the manual
// mask workflow from collage apps, done non-destructively over the pristine original.
import { useCallback, useEffect, useRef, useState } from 'react'

const WORK_MAX = 2200
const UNDO_CAP = 15

interface Props {
  original: HTMLCanvasElement // pristine RGB source
  current: HTMLCanvasElement // current image (its alpha seeds the mask)
  onApply: (result: HTMLCanvasElement) => void
  onClose: () => void
}

function scaled(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * k))
  c.height = Math.max(1, Math.round(src.height * k))
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return c
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  c.getContext('2d')!.drawImage(src, 0, 0)
  return c
}

export default function MaskTool({ original, current, onApply, onClose }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const initialMask = useRef<HTMLCanvasElement | null>(null)
  const tf = useRef({ z: 1, tx: 0, ty: 0 }) // image → screen: s = t + z·p
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const stroke = useRef<null | { last: { x: number; y: number }; before: HTMLCanvasElement }>(null)
  const pinch = useRef<null | { dist: number; cx: number; cy: number; z: number; tx: number; ty: number }>(null)
  const raf = useRef(0)
  const spaceHeld = useRef(false)
  const undoStack = useRef<Blob[]>([])
  const redoStack = useRef<Blob[]>([])

  const [mode, setMode] = useState<'erase' | 'restore'>('erase')
  const [size, setSize] = useState(44) // screen px
  const [soft, setSoft] = useState(0.55) // 0 hard … 1 soft
  const [histLen, setHistLen] = useState({ u: 0, r: 0 })
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  // ---- setup ----
  useEffect(() => {
    const base = scaled(original, WORK_MAX)
    baseRef.current = base
    // seed the mask from the current image's alpha (white where visible, transparent where erased)
    const mask = document.createElement('canvas')
    mask.width = base.width
    mask.height = base.height
    const mc = mask.getContext('2d')!
    mc.drawImage(current, 0, 0, mask.width, mask.height)
    mc.globalCompositeOperation = 'source-in'
    mc.fillStyle = '#fff'
    mc.fillRect(0, 0, mask.width, mask.height)
    mc.globalCompositeOperation = 'source-over'
    maskRef.current = mask
    initialMask.current = cloneCanvas(mask)
    const view = viewRef.current!
    view.width = base.width
    view.height = base.height
    // fit into the stage
    const st = stageRef.current!.getBoundingClientRect()
    const z = Math.min((st.width - 24) / base.width, (st.height - 24) / base.height)
    tf.current = { z, tx: (st.width - base.width * z) / 2, ty: (st.height - base.height * z) / 2 }
    applyTf()
    compose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyTf = () => {
    const v = viewRef.current
    if (!v) return
    const { z, tx, ty } = tf.current
    v.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`
  }

  const compose = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const v = viewRef.current
      const base = baseRef.current
      const mask = maskRef.current
      if (!v || !base || !mask) return
      const ctx = v.getContext('2d')!
      ctx.clearRect(0, 0, v.width, v.height)
      ctx.drawImage(base, 0, 0)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(mask, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    })
  }, [])

  // ---- history ----
  const pushUndo = useCallback((snapshot: HTMLCanvasElement) => {
    snapshot.toBlob((b) => {
      if (!b) return
      undoStack.current.push(b)
      if (undoStack.current.length > UNDO_CAP) undoStack.current.shift()
      redoStack.current = []
      setHistLen({ u: undoStack.current.length, r: 0 })
    }, 'image/png')
  }, [])

  const restoreBlob = useCallback(async (b: Blob) => {
    const bmp = await createImageBitmap(b)
    const mask = maskRef.current!
    const mc = mask.getContext('2d')!
    mc.clearRect(0, 0, mask.width, mask.height)
    mc.drawImage(bmp, 0, 0)
    bmp.close()
    compose()
  }, [compose])

  const undo = useCallback(async () => {
    const b = undoStack.current.pop()
    if (!b) return
    const cur: Blob | null = await new Promise((r) => maskRef.current!.toBlob(r, 'image/png'))
    if (cur) redoStack.current.push(cur)
    await restoreBlob(b)
    setHistLen({ u: undoStack.current.length, r: redoStack.current.length })
  }, [restoreBlob])

  const redo = useCallback(async () => {
    const b = redoStack.current.pop()
    if (!b) return
    const cur: Blob | null = await new Promise((r) => maskRef.current!.toBlob(r, 'image/png'))
    if (cur) undoStack.current.push(cur)
    await restoreBlob(b)
    setHistLen({ u: undoStack.current.length, r: redoStack.current.length })
  }, [restoreBlob])

  // ---- brushing ----
  const toImage = (cx: number, cy: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    const { z, tx, ty } = tf.current
    return { x: (cx - r.left - tx) / z, y: (cy - r.top - ty) / z }
  }

  const stamp = useCallback((x: number, y: number) => {
    const mask = maskRef.current
    if (!mask) return
    const mc = mask.getContext('2d')!
    const rad = Math.max(1.5, size / tf.current.z / 2)
    const hard = 1 - soft
    const g = mc.createRadialGradient(x, y, rad * Math.max(0.05, hard * 0.95), x, y, rad)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    mc.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
    mc.fillStyle = g
    mc.beginPath()
    mc.arc(x, y, rad, 0, Math.PI * 2)
    mc.fill()
    mc.globalCompositeOperation = 'source-over'
  }, [size, soft, mode])

  const paintTo = useCallback((x: number, y: number) => {
    const st = stroke.current
    if (!st) return
    const rad = Math.max(1.5, size / tf.current.z / 2)
    const spacing = Math.max(0.75, rad * 0.35)
    const dx = x - st.last.x
    const dy = y - st.last.y
    const dist = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.floor(dist / spacing))
    for (let i = 1; i <= steps; i++) stamp(st.last.x + (dx * i) / steps, st.last.y + (dy * i) / steps)
    st.last = { x: st.last.x + (dx * steps) / Math.max(1, steps), y: st.last.y + (dy * steps) / Math.max(1, steps) }
    if (dist > spacing) st.last = { x, y }
    compose()
  }, [size, stamp, compose])

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      // second finger: cancel any in-progress stroke, switch to pinch-zoom/pan
      if (stroke.current) {
        const before = stroke.current.before
        const mask = maskRef.current!
        const mc = mask.getContext('2d')!
        mc.clearRect(0, 0, mask.width, mask.height)
        mc.drawImage(before, 0, 0)
        stroke.current = null
        compose()
      }
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ...tf.current }
    } else if (pointers.current.size === 1) {
      if (spaceHeld.current) {
        pinch.current = { dist: 0, cx: e.clientX, cy: e.clientY, ...tf.current }
        return
      }
      const p = toImage(e.clientX, e.clientY)
      stroke.current = { last: p, before: cloneCanvas(maskRef.current!) }
      pushUndo(stroke.current.before)
      stamp(p.x, p.y)
      compose()
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setCursor({ x: e.clientX, y: e.clientY })
    if (pinch.current) {
      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        const p = pinch.current
        const z = Math.min(24, Math.max(0.1, (p.z * dist) / (p.dist || 1)))
        // keep the pinch midpoint fixed in image space
        const r = stageRef.current!.getBoundingClientRect()
        const ix = (p.cx - r.left - p.tx) / p.z
        const iy = (p.cy - r.top - p.ty) / p.z
        tf.current = { z, tx: cx - r.left - ix * z, ty: cy - r.top - iy * z }
        applyTf()
      } else if (spaceHeld.current && pointers.current.size === 1) {
        const p = pinch.current
        tf.current = { z: p.z, tx: p.tx + (e.clientX - p.cx), ty: p.ty + (e.clientY - p.cy) }
        applyTf()
      }
      return
    }
    if (stroke.current && pointers.current.size === 1) {
      const p = toImage(e.clientX, e.clientY)
      paintTo(p.x, p.y)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = spaceHeld.current && pointers.current.size === 1 ? pinch.current : null
    if (pointers.current.size === 0) stroke.current = null
  }

  // desktop: wheel zoom toward cursor; hold Space to pan
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const { z, tx, ty } = tf.current
      const nz = Math.min(24, Math.max(0.1, z * Math.exp(-e.deltaY * 0.0018)))
      const ix = (e.clientX - r.left - tx) / z
      const iy = (e.clientY - r.top - ty) / z
      tf.current = { z: nz, tx: e.clientX - r.left - ix * nz, ty: e.clientY - r.top - iy * nz }
      applyTf()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = e.type === 'keydown'
        if (e.type === 'keydown') e.preventDefault()
      }
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) void redo()
        else void undo()
      }
      if (e.type === 'keydown' && e.key === 'Escape') onClose()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [undo, redo, onClose])

  // ---- mask ops ----
  const withHistory = useCallback((fn: (mask: HTMLCanvasElement) => void) => {
    const mask = maskRef.current
    if (!mask) return
    pushUndo(cloneCanvas(mask))
    fn(mask)
    compose()
  }, [pushUndo, compose])

  const invert = () => withHistory((mask) => {
    const inv = document.createElement('canvas')
    inv.width = mask.width
    inv.height = mask.height
    const ic = inv.getContext('2d')!
    ic.fillStyle = '#fff'
    ic.fillRect(0, 0, inv.width, inv.height)
    ic.globalCompositeOperation = 'destination-out'
    ic.drawImage(mask, 0, 0)
    const mc = mask.getContext('2d')!
    mc.clearRect(0, 0, mask.width, mask.height)
    mc.drawImage(inv, 0, 0)
  })

  const soften = () => withHistory((mask) => {
    const tmp = cloneCanvas(mask)
    const mc = mask.getContext('2d')!
    mc.clearRect(0, 0, mask.width, mask.height)
    mc.filter = 'blur(1.6px)'
    mc.drawImage(tmp, 0, 0)
    mc.filter = 'none'
  })

  const morph = (grow: boolean) => withHistory((mask) => {
    // blur, then push the soft alpha through a steep ramp: low threshold grows the mask,
    // high threshold chokes it
    const mc = mask.getContext('2d')!
    const tmp = cloneCanvas(mask)
    mc.clearRect(0, 0, mask.width, mask.height)
    mc.filter = 'blur(2.5px)'
    mc.drawImage(tmp, 0, 0)
    mc.filter = 'none'
    const img = mc.getImageData(0, 0, mask.width, mask.height)
    const d = img.data
    const t = grow ? 74 : 182
    for (let i = 3; i < d.length; i += 4) {
      d[i] = Math.max(0, Math.min(255, (d[i] - t) * 6 + 128))
    }
    mc.putImageData(img, 0, 0)
  })

  const reset = () => withHistory((mask) => {
    const mc = mask.getContext('2d')!
    mc.clearRect(0, 0, mask.width, mask.height)
    mc.drawImage(initialMask.current!, 0, 0)
  })

  const apply = () => {
    const base = baseRef.current
    const mask = maskRef.current
    if (!base || !mask) return
    const out = document.createElement('canvas')
    out.width = base.width
    out.height = base.height
    const ctx = out.getContext('2d')!
    ctx.drawImage(base, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(mask, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    onApply(out)
  }

  return (
    <div className="mask-tool" role="dialog" aria-modal="true">
      <div className="vtop">
        <button className="btn" onClick={onClose}>Cancel</button>
        <strong style={{ fontSize: 13 }}>Erase &amp; restore</strong>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => void undo()} disabled={!histLen.u} aria-label="Undo">↩</button>
        <button className="btn small" onClick={() => void redo()} disabled={!histLen.r} aria-label="Redo">↪</button>
        <button className="btn primary" onClick={apply}>Apply</button>
      </div>
      <div
        className="mask-stage"
        ref={stageRef}
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
      >
        <canvas ref={viewRef} className="mask-view" />
        {cursor && (
          <div
            className="brush-ring"
            style={{ width: size, height: size, left: cursor.x - size / 2, top: cursor.y - size / 2 }}
          />
        )}
      </div>
      <div className="mask-dock">
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <div className="seg">
            <button type="button" className={mode === 'erase' ? 'active' : ''} onClick={() => setMode('erase')}>Erase</button>
            <button type="button" className={mode === 'restore' ? 'active' : ''} onClick={() => setMode('restore')}>Restore</button>
          </div>
          <div className="chips" style={{ margin: 0 }}>
            <button className="btn small" onClick={invert}>Invert</button>
            <button className="btn small" onClick={soften}>Soften</button>
            <button className="btn small" onClick={() => morph(false)}>Shrink</button>
            <button className="btn small" onClick={() => morph(true)}>Expand</button>
            <button className="btn small" onClick={reset}>Reset</button>
          </div>
        </div>
        <div className="controls-wrap" style={{ marginTop: 8 }}>
          <label className="slider">
            <span className="label">Brush size · {size}px</span>
            <input type="range" min={10} max={140} step={2} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <label className="slider">
            <span className="label">Softness · {Math.round(soft * 100)}%</span>
            <input type="range" min={0} max={1} step={0.05} value={soft} onChange={(e) => setSoft(Number(e.target.value))} />
          </label>
        </div>
        <p className="faint" style={{ fontSize: 11, margin: '6px 0 0' }}>One finger paints · pinch to zoom in close · on desktop scroll zooms, hold space to pan.</p>
      </div>
    </div>
  )
}
