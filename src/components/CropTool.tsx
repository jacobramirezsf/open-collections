// Crop: drag a frame over the image, or drag on empty space to draw a new one. The crop is taken
// from the pristine original at full resolution, so cropping into a small detail gives you that
// detail at the size it deserves rather than an upscale of the preview.
import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  source: HTMLCanvasElement // pristine full-resolution original
  onApply: (cropped: HTMLCanvasElement) => void
  onClose: () => void
}

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move' | 'new'

const RATIOS: { label: string; value: number | null }[] = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
]

export default function CropTool({ source, onApply, onClose }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [fit, setFit] = useState({ scale: 1, ox: 0, oy: 0 }) // image → screen
  // crop rect in image pixels
  // start inset so the frame reads as a frame, its corners are grabbable, and there is room to
  // drag a fresh selection on the image around it
  const [rect, setRect] = useState({
    x: source.width * 0.1,
    y: source.height * 0.1,
    w: source.width * 0.8,
    h: source.height * 0.8,
  })
  const [ratio, setRatio] = useState<number | null>(null)
  const drag = useRef<null | { handle: Handle; sx: number; sy: number; start: typeof rect }>(null)

  // fit the image into the stage
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const scale = Math.min((r.width - 32) / source.width, (r.height - 32) / source.height)
      setFit({ scale, ox: (r.width - source.width * scale) / 2, oy: (r.height - source.height * scale) / 2 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [source])

  const toImage = (cx: number, cy: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: (cx - r.left - fit.ox) / fit.scale, y: (cy - r.top - fit.oy) / fit.scale }
  }

  const clampRect = useCallback(
    (next: { x: number; y: number; w: number; h: number }) => {
      let { x, y, w, h } = next
      w = Math.max(24, Math.min(source.width, w))
      h = Math.max(24, Math.min(source.height, h))
      x = Math.max(0, Math.min(source.width - w, x))
      y = Math.max(0, Math.min(source.height - h, y))
      return { x, y, w, h }
    },
    [source],
  )

  const applyRatio = (r: { x: number; y: number; w: number; h: number }, anchor: Handle) => {
    if (!ratio) return r
    let { x, y, w, h } = r
    if (w / h > ratio) w = h * ratio
    else h = w / ratio
    if (anchor === 'nw') { x = r.x + r.w - w; y = r.y + r.h - h }
    else if (anchor === 'ne') { y = r.y + r.h - h }
    else if (anchor === 'sw') { x = r.x + r.w - w }
    return { x, y, w, h }
  }

  const onDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toImage(e.clientX, e.clientY)
    if (handle === 'new') {
      drag.current = { handle: 'se', sx: p.x, sy: p.y, start: { x: p.x, y: p.y, w: 0, h: 0 } }
      setRect({ x: p.x, y: p.y, w: 1, h: 1 })
      return
    }
    drag.current = { handle, sx: p.x, sy: p.y, start: rect }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toImage(e.clientX, e.clientY)
    const dx = p.x - d.sx
    const dy = p.y - d.sy
    const s = d.start
    let next = { ...s }
    if (d.handle === 'move') {
      next = { ...s, x: s.x + dx, y: s.y + dy }
    } else {
      if (d.handle === 'se') next = { x: s.x, y: s.y, w: s.w + dx, h: s.h + dy }
      if (d.handle === 'sw') next = { x: s.x + dx, y: s.y, w: s.w - dx, h: s.h + dy }
      if (d.handle === 'ne') next = { x: s.x, y: s.y + dy, w: s.w + dx, h: s.h - dy }
      if (d.handle === 'nw') next = { x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy }
      if (next.w < 24) next.w = 24
      if (next.h < 24) next.h = 24
      next = applyRatio(next, d.handle)
    }
    setRect(clampRect(next))
  }

  const onUp = () => {
    drag.current = null
  }

  const reset = () => setRect({ x: 0, y: 0, w: source.width, h: source.height })

  const apply = () => {
    const r = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.max(1, Math.round(rect.w)),
      h: Math.max(1, Math.round(rect.h)),
    }
    const out = document.createElement('canvas')
    out.width = r.w
    out.height = r.h
    out.getContext('2d')!.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    onApply(out)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') apply()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const box = {
    left: fit.ox + rect.x * fit.scale,
    top: fit.oy + rect.y * fit.scale,
    width: rect.w * fit.scale,
    height: rect.h * fit.scale,
  }

  return (
    <div className="crop-tool" role="dialog" aria-modal="true">
      <div className="vtop">
        <button className="btn" onClick={onClose}>Cancel</button>
        <strong style={{ fontSize: 13 }}>Crop</strong>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={reset}>Reset</button>
        <button className="btn primary" onClick={apply}>Crop</button>
      </div>
      <div
        className="crop-stage"
        ref={stageRef}
        style={{ touchAction: 'none' }}
        onPointerDown={onDown('new')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img
          ref={imgRef}
          src={source.toDataURL()}
          alt=""
          draggable={false}
          style={{ position: 'absolute', left: fit.ox, top: fit.oy, width: source.width * fit.scale, height: source.height * fit.scale }}
        />
        <div className="crop-box" style={box} onPointerDown={onDown('move')}>
          <span className="crop-h nw" onPointerDown={onDown('nw')} />
          <span className="crop-h ne" onPointerDown={onDown('ne')} />
          <span className="crop-h sw" onPointerDown={onDown('sw')} />
          <span className="crop-h se" onPointerDown={onDown('se')} />
        </div>
      </div>
      <div className="crop-dock">
        <div className="chips" style={{ margin: 0 }}>
          <span className="faint" style={{ fontSize: 11, alignSelf: 'center', flex: '0 0 auto' }}>Ratio:</span>
          {RATIOS.map((r) => (
            <button
              key={r.label}
              className={'btn small' + (ratio === r.value ? ' active' : '')}
              onClick={() => {
                setRatio(r.value)
                if (r.value) setRect((cur) => clampRect(applyRatioTo(cur, r.value!)))
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 11, margin: '6px 0 0' }}>
          {Math.round(rect.w)} × {Math.round(rect.h)} px. Drag the frame or its corners, or drag on the image to start a new one.
          Effects and background removal run on the crop.
        </p>
      </div>
    </div>
  )
}

function applyRatioTo(r: { x: number; y: number; w: number; h: number }, ratio: number) {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  let w = r.w
  let h = r.h
  if (w / h > ratio) w = h * ratio
  else h = w / ratio
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}
