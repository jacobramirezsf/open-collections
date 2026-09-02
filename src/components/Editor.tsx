// Halftone editor: item image → optional remove.bg cutout → canvas halftone → PNG download.
// Everything except background removal runs client-side.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Item } from '../../shared/types'
import { proxyImageUrl } from '../lib/api'
import { saveBlob } from '../lib/zip'

interface Props {
  item: Item
  onClose: () => void
}

export interface HalftoneParams {
  on: boolean
  cell: number // grid size px
  angle: number // degrees
  shape: 'dot' | 'line' | 'square'
  gain: number // dot gain multiplier
  ink: string
  paper: string // css color or 'transparent'
  invert: boolean
}

const DEFAULTS: HalftoneParams = { on: true, cell: 8, angle: 22, shape: 'dot', gain: 1.15, ink: '#141414', paper: '#f3f1ec', invert: false }
const WORK_MAX = 1800

function drawHalftone(src: HTMLCanvasElement, params: HalftoneParams): HTMLCanvasElement {
  const { cell, angle, shape, gain, ink, paper, invert } = params
  const w = src.width
  const h = src.height
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  if (paper !== 'transparent') {
    ctx.fillStyle = paper
    ctx.fillRect(0, 0, w, h)
  }
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  const data = sctx.getImageData(0, 0, w, h).data
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  // iterate the rotated grid over the bounding diagonal
  const diag = Math.sqrt(w * w + h * h)
  const cx = w / 2
  const cy = h / 2
  const steps = Math.ceil(diag / cell / 2) + 1
  const sample = Math.max(1, Math.floor(cell / 3))
  for (let gu = -steps; gu <= steps; gu++) {
    for (let gv = -steps; gv <= steps; gv++) {
      const px = cx + (gu * cos - gv * sin) * cell
      const py = cy + (gu * sin + gv * cos) * cell
      if (px < -cell || py < -cell || px > w + cell || py > h + cell) continue
      // average luminance + alpha over the cell
      let lum = 0
      let alpha = 0
      let cnt = 0
      const half = cell / 2
      for (let sy = Math.max(0, py - half) | 0; sy < Math.min(h, py + half); sy += sample) {
        for (let sx = Math.max(0, px - half) | 0; sx < Math.min(w, px + half); sx += sample) {
          const i = (sy * w + sx) * 4
          const a = data[i + 3] / 255
          lum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a)
          alpha += a
          cnt++
        }
      }
      if (!cnt) continue
      lum /= cnt * 255
      alpha /= cnt
      if (alpha < 0.12) continue // keep transparency from remove.bg
      let v = 1 - lum // ink amount
      if (invert) v = 1 - v
      const r = half * gain * Math.sqrt(Math.max(0, Math.min(1, v)))
      if (r < 0.28) continue
      ctx.globalAlpha = Math.min(1, alpha * 1.4)
      if (shape === 'dot') {
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
      } else if (shape === 'square') {
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(rad)
        ctx.fillRect(-r, -r, r * 2, r * 2)
        ctx.restore()
      } else {
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(rad)
        ctx.lineWidth = Math.min(cell, r * 1.6)
        ctx.beginPath()
        ctx.moveTo(-half, 0)
        ctx.lineTo(half, 0)
        ctx.stroke()
        ctx.restore()
      }
    }
  }
  ctx.globalAlpha = 1
  return out
}

export default function Editor({ item, onClose }: Props) {
  const [params, setParams] = useState<HalftoneParams>(DEFAULTS)
  const [source, setSource] = useState<HTMLCanvasElement | null>(null) // current working image (maybe cutout)
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null)
  const [cutoutApplied, setCutoutApplied] = useState(false)
  const [busy, setBusy] = useState<string | null>('Loading image…')
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTimer = useRef<number>(0)

  // load the image via our proxy (same-origin → canvas-readable)
  useEffect(() => {
    let dead = false
    const img = new Image()
    img.onload = () => {
      if (dead) return
      const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * scale)
      c.height = Math.round(img.naturalHeight * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      setOriginal(c)
      setSource(c)
      setBusy(null)
    }
    img.onerror = () => {
      if (!dead) {
        setError('Could not load the image for editing.')
        setBusy(null)
      }
    }
    img.src = proxyImageUrl(item, 'view')
    return () => {
      dead = true
    }
  }, [item.id])

  // re-render preview (debounced)
  useEffect(() => {
    if (!source || !canvasRef.current) return
    window.clearTimeout(renderTimer.current)
    renderTimer.current = window.setTimeout(() => {
      const out = params.on ? drawHalftone(source, params) : source
      const c = canvasRef.current!
      c.width = out.width
      c.height = out.height
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(out, 0, 0)
    }, 60)
  }, [source, params])

  const removeBg = useCallback(async () => {
    setBusy('Removing background…')
    setError(null)
    try {
      const res = await fetch('/api/removebg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
      if (!res.ok) {
        let msg = `Background removal failed (${res.status})`
        try {
          msg = (await res.json())?.error || msg
        } catch { /* ignore */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const img = new Image()
      const url = URL.createObjectURL(blob)
      await new Promise<void>((ok, bad) => {
        img.onload = () => ok()
        img.onerror = () => bad(new Error('bad cutout image'))
        img.src = url
      })
      const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * scale)
      c.height = Math.round(img.naturalHeight * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      setSource(c)
      setCutoutApplied(true)
      setParams((p) => ({ ...p, paper: 'transparent' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [item.id])

  const download = useCallback(() => {
    if (!source) return
    const out = params.on ? drawHalftone(source, params) : source
    out.toBlob((blob) => {
      if (!blob) return
      const name = `${item.source}-${item.id.split(':').pop()}-${params.on ? 'halftone' : cutoutApplied ? 'cutout' : 'edit'}.png`
      saveBlob(blob, name.replace(/[^a-zA-Z0-9._-]+/g, '-'))
    }, 'image/png')
  }, [source, params, item, cutoutApplied])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof HalftoneParams>(k: K, v: HalftoneParams[K]) => setParams((p) => ({ ...p, [k]: v }))
  const checker = useMemo(
    () => ({ backgroundImage: 'repeating-conic-gradient(#e3e0d9 0% 25%, #efece6 0% 50%)', backgroundSize: '16px 16px' }),
    [],
  )

  return (
    <div className="viewer editor" role="dialog" aria-modal="true">
      <div className="vtop">
        <button className="btn" onClick={onClose}>← Back to item</button>
        <strong style={{ fontSize: 13 }}>Halftone editor</strong>
        <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={download} disabled={!source}>Download PNG</button>
      </div>
      <div className="vbody">
        <div className="stage" style={params.paper === 'transparent' ? checker : undefined}>
          {busy && <div className="ph">{busy}</div>}
          {error && !busy && <div className="ph" style={{ color: 'var(--danger)' }}>{error}</div>}
          <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', display: busy || (error && !source) ? 'none' : 'block' }} />
        </div>
        <div className="info">
          <h3 style={{ marginTop: 0 }}>Image</h3>
          <div className="actions">
            <button className="btn" onClick={removeBg} disabled={!!busy || cutoutApplied}>{cutoutApplied ? 'Background removed ✓' : 'Remove background'}</button>
            {cutoutApplied && (
              <button className="btn" onClick={() => { setSource(original); setCutoutApplied(false); setParams((p) => ({ ...p, paper: DEFAULTS.paper })) }}>
                Restore original
              </button>
            )}
          </div>
          <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>Background removal uses remove.bg (rate-limited; spends credits).</p>

          <h3>Halftone</h3>
          <label className="check" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={params.on} onChange={(e) => set('on', e.target.checked)} /> Enable halftone
          </label>
          <div className="ctl">
            <span className="label">Dot size — {params.cell}px</span>
            <input type="range" min={4} max={28} step={1} value={params.cell} onChange={(e) => set('cell', Number(e.target.value))} />
          </div>
          <div className="ctl">
            <span className="label">Angle — {params.angle}°</span>
            <input type="range" min={0} max={90} step={1} value={params.angle} onChange={(e) => set('angle', Number(e.target.value))} />
          </div>
          <div className="ctl">
            <span className="label">Dot gain — {params.gain.toFixed(2)}</span>
            <input type="range" min={0.5} max={1.6} step={0.05} value={params.gain} onChange={(e) => set('gain', Number(e.target.value))} />
          </div>
          <div className="ctl">
            <span className="label">Shape</span>
            <div className="seg">
              {(['dot', 'line', 'square'] as const).map((sh) => (
                <button key={sh} className={params.shape === sh ? 'active' : ''} onClick={() => set('shape', sh)}>{sh}</button>
              ))}
            </div>
          </div>
          <div className="ctl row">
            <div>
              <span className="label">Ink</span>
              <input type="color" value={params.ink} onChange={(e) => set('ink', e.target.value)} />
            </div>
            <div>
              <span className="label">Paper</span>
              <div className="row">
                <input type="color" value={params.paper === 'transparent' ? '#ffffff' : params.paper} onChange={(e) => set('paper', e.target.value)} disabled={params.paper === 'transparent'} />
                <label className="check"><input type="checkbox" checked={params.paper === 'transparent'} onChange={(e) => set('paper', e.target.checked ? 'transparent' : DEFAULTS.paper)} /> transparent</label>
              </div>
            </div>
          </div>
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={params.invert} onChange={(e) => set('invert', e.target.checked)} /> Invert
          </label>
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => setParams(DEFAULTS)}>Reset</button>
            <button className="btn primary" onClick={download} disabled={!source}>Download PNG</button>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>
            Edits happen in your browser at up to {WORK_MAX}px. {item.rightsLabel === 'CC0' || item.publicDomain ? 'This work is open access — remix freely.' : 'Check the rights on the original record before publishing edits.'}
          </p>
        </div>
      </div>
    </div>
  )
}
