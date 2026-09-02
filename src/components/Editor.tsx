// Halftone editor: item image → optional remove.bg cutout → halftone screen → hi-res PNG or vector
// SVG export (screenprint-ready). The preview is tuned at ≤1800px for interactivity; exports
// re-render the same screen from the full-resolution source (see src/lib/halftone.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Item } from '../../shared/types'
import { proxyImageUrl } from '../lib/api'
import { saveBlob } from '../lib/zip'
import { computeScreen, renderScreen, screenToSvg, type HalftoneParams } from '../lib/halftone'

interface Props {
  item: Item
  onClose: () => void
}

const DEFAULTS: HalftoneParams = { on: true, cell: 8, angle: 22, shape: 'dot', gain: 1.15, ink: '#141414', paper: '#f3f1ec', invert: false }
const PREVIEW_MAX = 1800
const SOURCE_MAX = 6000 // long-edge cap for the in-memory full-res source
const EXPORT_MAX_PIXELS = 64e6 // ~64 MP canvas ceiling for PNG export

function toCanvas(img: HTMLImageElement | HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width
  const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => bad(new Error('load failed'))
    img.src = src
  })
}

export default function Editor({ item, onClose }: Props) {
  const [params, setParams] = useState<HalftoneParams>(DEFAULTS)
  const [full, setFull] = useState<HTMLCanvasElement | null>(null) // full-res working image
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null)
  const [originalFull, setOriginalFull] = useState<HTMLCanvasElement | null>(null)
  const [cutoutApplied, setCutoutApplied] = useState(false)
  const [busy, setBusy] = useState<string | null>('Loading image…')
  const [error, setError] = useState<string | null>(null)
  const [exportScale, setExportScale] = useState(1) // relative to full source
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTimer = useRef<number>(0)

  const adopt = useCallback((c: HTMLCanvasElement) => {
    setFull(c)
    setPreview(toCanvas(c, PREVIEW_MAX))
  }, [])

  // Load the largest browser-decodable rendition (TIFF originals can't decode in <img>).
  useEffect(() => {
    let dead = false
    const isTiff = /\.tiff?($|\?)/i.test(item.originalImageUrl || '')
    const attempts = [...(isTiff ? [] : ['orig' as const]), 'view' as const, 'thumb' as const]
    ;(async () => {
      for (const size of attempts) {
        try {
          const img = await loadImg(proxyImageUrl(item, size))
          if (dead) return
          const c = toCanvas(img, SOURCE_MAX)
          setOriginalFull(c)
          adopt(c)
          setBusy(null)
          return
        } catch {
          /* try the next size */
        }
      }
      if (!dead) {
        setError('Could not load the image for editing.')
        setBusy(null)
      }
    })()
    return () => {
      dead = true
    }
  }, [item.id, adopt])

  // Debounced preview render.
  useEffect(() => {
    if (!preview || !canvasRef.current) return
    window.clearTimeout(renderTimer.current)
    renderTimer.current = window.setTimeout(() => {
      const out = params.on ? renderScreen(computeScreen(preview, params, preview.width), params) : preview
      const c = canvasRef.current!
      c.width = out.width
      c.height = out.height
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(out, 0, 0)
    }, 60)
  }, [preview, params])

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
      const url = URL.createObjectURL(blob)
      try {
        const img = await loadImg(url)
        adopt(toCanvas(img, SOURCE_MAX))
      } finally {
        URL.revokeObjectURL(url)
      }
      setCutoutApplied(true)
      setParams((p) => ({ ...p, paper: 'transparent' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [item.id, adopt])

  const baseName = useMemo(
    () => `${item.source}-${item.id.split(':').pop()}-${params.on ? 'halftone' : cutoutApplied ? 'cutout' : 'edit'}`.replace(/[^a-zA-Z0-9._-]+/g, '-'),
    [item, params.on, cutoutApplied],
  )

  // Export options: long-edge targets relative to the full-res source.
  const exportOptions = useMemo(() => {
    if (!full) return []
    const long = Math.max(full.width, full.height)
    const opts: { scale: number; label: string }[] = []
    for (const s of [1, 1.5, 2]) {
      const w = Math.round(full.width * s)
      const h = Math.round(full.height * s)
      if (w * h > EXPORT_MAX_PIXELS) break
      opts.push({ scale: s, label: `${w} × ${h} px${s === 1 ? (long >= SOURCE_MAX ? ' (source, capped)' : ' (source)') : ` (${s}×)`}` })
    }
    return opts
  }, [full])

  const exportPng = useCallback(() => {
    if (!full) return
    setBusy('Rendering PNG…')
    setTimeout(() => {
      try {
        let target: HTMLCanvasElement
        if (params.on) {
          target = renderScreen(computeScreen(full, params, preview!.width), params, exportScale)
        } else if (exportScale === 1) {
          target = full
        } else {
          target = document.createElement('canvas')
          target.width = Math.round(full.width * exportScale)
          target.height = Math.round(full.height * exportScale)
          target.getContext('2d')!.drawImage(full, 0, 0, target.width, target.height)
        }
        target.toBlob((blob) => {
          setBusy(null)
          if (!blob) {
            setError('Export failed — try a smaller size.')
            return
          }
          saveBlob(blob, `${baseName}-${target.width}px.png`)
        }, 'image/png')
      } catch (e) {
        setBusy(null)
        setError('Export failed (' + (e as Error).message + ') — try a smaller size.')
      }
    }, 30)
  }, [full, preview, params, exportScale, baseName])

  const exportSvg = useCallback(() => {
    if (!full || !params.on) return
    setBusy('Building SVG…')
    setTimeout(() => {
      try {
        const svg = screenToSvg(computeScreen(full, params, preview!.width), params)
        saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}.svg`)
      } catch (e) {
        setError('SVG export failed (' + (e as Error).message + ')')
      } finally {
        setBusy(null)
      }
    }, 30)
  }, [full, preview, params, baseName])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof HalftoneParams>(k: K, v: HalftoneParams[K]) => setParams((p) => ({ ...p, [k]: v }))
  const checker = useMemo(() => ({ backgroundImage: 'repeating-conic-gradient(#e3e0d9 0% 25%, #efece6 0% 50%)', backgroundSize: '16px 16px' }), [])

  return (
    <div className="viewer editor" role="dialog" aria-modal="true">
      <div className="vtop">
        <button className="btn" onClick={onClose}>← Back to item</button>
        <strong style={{ fontSize: 13 }}>Halftone editor</strong>
        <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={exportPng} disabled={!full || !!busy}>Download PNG</button>
      </div>
      <div className="vbody">
        <div className="stage" style={params.paper === 'transparent' ? checker : undefined}>
          {busy && <div className="ph" style={{ position: 'absolute', zIndex: 2 }}>{busy}</div>}
          {error && !busy && !full && <div className="ph" style={{ color: 'var(--danger)' }}>{error}</div>}
          <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', display: full ? 'block' : 'none', opacity: busy ? 0.4 : 1 }} />
        </div>
        <div className="info">
          {error && full && <p style={{ color: 'var(--danger)', marginTop: 0, fontSize: 13 }}>{error}</p>}
          <h3 style={{ marginTop: 0 }}>Image</h3>
          <div className="actions">
            <button className="btn" onClick={removeBg} disabled={!!busy || cutoutApplied || !full}>{cutoutApplied ? 'Background removed ✓' : 'Remove background'}</button>
            {cutoutApplied && originalFull && (
              <button className="btn" onClick={() => { adopt(originalFull); setCutoutApplied(false); setParams((p) => ({ ...p, paper: DEFAULTS.paper })) }}>
                Restore original
              </button>
            )}
          </div>
          <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {full ? `Source ${full.width} × ${full.height}px. ` : ''}Background removal uses remove.bg (rate-limited; spends credits).
          </p>

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

          <h3>Export</h3>
          <div className="ctl">
            <span className="label">PNG size</span>
            <select className="input" value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))}>
              {exportOptions.map((o) => (
                <option key={o.scale} value={o.scale}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={exportPng} disabled={!full || !!busy}>Download PNG</button>
            <button className="btn" onClick={exportSvg} disabled={!full || !!busy || !params.on} title={params.on ? 'Resolution-independent halftone for screenprint separations' : 'Enable halftone first'}>
              Download SVG (vector)
            </button>
            <button className="btn" onClick={() => setParams(DEFAULTS)}>Reset</button>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
            PNG renders the screen at the chosen size; SVG is true vector (dots as shapes) and scales to any print size in Illustrator or Inkscape.
          </p>
          <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
            {item.rightsLabel === 'CC0' || item.publicDomain ? 'This work is open access — remix freely.' : 'Check the rights on the original record before publishing edits.'}
          </p>
        </div>
      </div>
    </div>
  )
}
