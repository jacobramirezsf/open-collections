// Image editor: background removal (remove.bg), halftone screening (client-side, hi-res PNG or
// vector SVG export), and AI vectorization (QuiverAI image→SVG). The preview is tuned at ≤1800px for interactivity; exports
// re-render the same screen from the full-resolution source (see src/lib/halftone.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Item } from '../../shared/types'
import { proxyImageUrl } from '../lib/api'
import { saveBlob } from '../lib/zip'
import { computeScreen, renderScreen, screenToSvg, type HalftoneParams } from '../lib/halftone'
import { CMYK_CHANNELS, EFFECTS, TEXTURE_DEFAULTS, applyTexture, asciiGrid, computeCmykScreens, effectDef, type EffectKind, type TextureParams } from '../lib/textures'

interface Props {
  item: Item
  onClose: () => void
}

const DEFAULTS: HalftoneParams = { on: true, cell: 8, angle: 22, shape: 'dot', gain: 1.15, ink: '#141414', paper: '#f3f1ec', invert: false }
type Effect = 'none' | EffectKind
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
  const [effect, setEffect] = useState<Effect>('halftone')
  const [tex, setTex] = useState<TextureParams>({ ...TEXTURE_DEFAULTS })
  const [full, setFull] = useState<HTMLCanvasElement | null>(null) // full-res working image
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null)
  const [originalFull, setOriginalFull] = useState<HTMLCanvasElement | null>(null)
  const [cutoutApplied, setCutoutApplied] = useState(false)
  const [busy, setBusy] = useState<string | null>('Loading image…')
  const [error, setError] = useState<string | null>(null)
  const [exportScale, setExportScale] = useState(1) // relative to full source
  const [vector, setVector] = useState<{ svg: string; url: string; sandbox: boolean } | null>(null)
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
      const out =
        effect === 'halftone'
          ? renderScreen(computeScreen(preview, params, preview.width), params)
          : effect === 'none'
            ? preview
            : applyTexture(effect, preview, tex, preview.width, 1)
      const c = canvasRef.current!
      c.width = out.width
      c.height = out.height
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(out, 0, 0)
    }, 60)
  }, [preview, params, effect, tex])

  const vectorize = useCallback(async () => {
    if (!full) return
    setBusy('Vectorizing… (can take ~30s)')
    setError(null)
    try {
      // untouched original → let the server pass the image URL; edited (cutout) → send the pixels
      let body: string
      if (!cutoutApplied) {
        body = JSON.stringify({ id: item.id })
      } else {
        const c = toCanvas(full, 1024)
        body = JSON.stringify({ image: c.toDataURL('image/png') })
      }
      const res = await fetch('/api/vectorize', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || `Vectorization failed (${res.status})`)
      const url = URL.createObjectURL(new Blob([payload.svg], { type: 'image/svg+xml' }))
      setVector((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return { svg: payload.svg, url, sandbox: !!payload.sandbox }
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [full, cutoutApplied, item.id])

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
      setTex((t) => ({ ...t, paper: 'transparent' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [item.id, adopt])

  const baseName = useMemo(
    () => `${item.source}-${item.id.split(':').pop()}-${effect !== 'none' ? effect : cutoutApplied ? 'cutout' : 'edit'}`.replace(/[^a-zA-Z0-9._-]+/g, '-'),
    [item, effect, cutoutApplied],
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
        if (effect === 'halftone') {
          target = renderScreen(computeScreen(full, params, preview!.width), params, exportScale)
        } else if (effect !== 'none') {
          target = applyTexture(effect, full, tex, preview!.width, exportScale)
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
  }, [full, preview, params, effect, tex, exportScale, baseName])

  const exportSvg = useCallback(() => {
    if (!full || effect !== 'halftone') return
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
  }, [full, preview, params, effect, baseName])

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
        <strong style={{ fontSize: 13 }}>Edit</strong>
        <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
        <span style={{ flex: 1 }} />
        {vector ? (
          <button className="btn primary" onClick={() => saveBlob(new Blob([vector.svg], { type: 'image/svg+xml' }), `${baseName.replace(/-(halftone|cutout|edit)$/, '')}-vector.svg`)}>Download SVG</button>
        ) : (
          <button className="btn primary" onClick={exportPng} disabled={!full || !!busy}>Download PNG</button>
        )}
      </div>
      <div className="vbody">
        <div className="stage" style={(effect === 'halftone' ? params.paper : effect === 'none' ? (cutoutApplied ? 'transparent' : 'x') : tex.paper) === 'transparent' ? checker : undefined}>
          {busy && <div className="ph" style={{ position: 'absolute', zIndex: 2 }}>{busy}</div>}
          {error && !busy && !full && <div className="ph" style={{ color: 'var(--danger)' }}>{error}</div>}
          {vector && <img src={vector.url} alt="Vectorized" style={{ maxWidth: '100%', maxHeight: '100%', opacity: busy ? 0.4 : 1 }} />}
          <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', display: full && !vector ? 'block' : 'none', opacity: busy ? 0.4 : 1 }} />
        </div>
        <div className="info">
          {error && full && <p style={{ color: 'var(--danger)', marginTop: 0, fontSize: 13 }}>{error}</p>}
          <h3 className="sec-image-h" style={{ marginTop: 0 }}>Image</h3>
          <div className="actions sec-image">
            <button className="btn" onClick={removeBg} disabled={!!busy || cutoutApplied || !full}>{cutoutApplied ? 'Background removed ✓' : 'Remove background'}</button>
            {cutoutApplied && originalFull && (
              <button className="btn" onClick={() => { adopt(originalFull); setCutoutApplied(false); setParams((p) => ({ ...p, paper: DEFAULTS.paper })); setTex((t) => ({ ...t, paper: TEXTURE_DEFAULTS.paper })) }}>
                Restore original
              </button>
            )}
          </div>
          <p className="faint hide-mobile" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {full ? `Source ${full.width} × ${full.height}px. ` : ''}Automatic background removal (rate-limited).
          </p>

          <h3 className="sec-vector-h">Vectorize</h3>
          <div className="sec-vector">
          {!vector ? (
            <>
              <button className="btn" onClick={vectorize} disabled={!full || !!busy}>Vectorize</button>
              <p className="faint hide-mobile" style={{ fontSize: 12, margin: '6px 0 0' }}>
                Redraws the {cutoutApplied ? 'cutout' : 'image'} as clean, editable vector shapes (rate-limited).
              </p>
            </>
          ) : (
            <>
              <div className="actions">
                <button className="btn primary" onClick={() => saveBlob(new Blob([vector.svg], { type: 'image/svg+xml' }), `${baseName.replace(/-(halftone|cutout|edit)$/, '')}-vector.svg`)}>
                  Download SVG
                </button>
                <button className="btn" onClick={() => { URL.revokeObjectURL(vector.url); setVector(null) }}>Back to bitmap</button>
              </div>
              <p className="faint hide-mobile" style={{ fontSize: 12, margin: '6px 0 0' }}>
                {vector.sandbox ? 'Preview-mode result — full-quality vectorization is not enabled yet.' : 'Editable vector shapes — scales to any size.'}
              </p>
            </>
          )}
          </div>

          <h3 style={{ opacity: vector ? 0.45 : 1 }}>Texture</h3>
          <div className="chips" style={{ marginBottom: 10 }}>
            <button type="button" className={'btn small mobile-only' + (cutoutApplied ? ' active' : '')} disabled={!!busy || !full} onClick={() => { if (!cutoutApplied) void removeBg(); else if (originalFull) { adopt(originalFull); setCutoutApplied(false); setParams((pp) => ({ ...pp, paper: DEFAULTS.paper })); setTex((t) => ({ ...t, paper: TEXTURE_DEFAULTS.paper })) } }}>
              {cutoutApplied ? 'Cutout ✓' : 'Cutout'}
            </button>
            <button type="button" className={'btn small mobile-only' + (vector ? ' active' : '')} disabled={!!busy || !full} onClick={() => { if (vector) { URL.revokeObjectURL(vector.url); setVector(null) } else void vectorize() }}>
              Vectorize
            </button>
            <span className="chip-div mobile-only" />
            {(['none', ...EFFECTS.map((e) => e.key)] as Effect[]).map((k) => (
              <button
                key={k}
                type="button"
                className={'btn small' + (effect === k ? ' active' : '')}
                onClick={() => {
                  setEffect(k)
                  if (k !== 'none' && k !== 'halftone') {
                    const d = effectDef(k as EffectKind).defaults
                    setTex((t) => ({ ...TEXTURE_DEFAULTS, ink: t.ink, paper: t.paper, ...d, ...(t.paper === 'transparent' ? { paper: 'transparent' } : {}) }))
                  }
                }}
              >
                {k === 'none' ? 'None' : k === 'halftone' ? 'Halftone' : effectDef(k as EffectKind).label}
              </button>
            ))}
          </div>
          {effect !== 'none' && effect !== 'halftone' && (
            <div className="controls-wrap">
              {effectDef(effect as EffectKind).controls.map((c) => (
                <div className="ctl" key={c.k}>
                  <span className="label">{c.label} — {typeof tex[c.k] === 'number' ? (c.step < 1 ? (tex[c.k] as number).toFixed(2) : tex[c.k]) : ''}</span>
                  <input type="range" min={c.min} max={c.max} step={c.step} value={tex[c.k] as number} onChange={(e) => setTex((t) => ({ ...t, [c.k]: Number(e.target.value) }))} />
                </div>
              ))}
              {effectDef(effect as EffectKind).colors.length > 0 && (
                <div className="ctl row">
                  {effectDef(effect as EffectKind).colors.includes('ink') && (
                    <div>
                      <span className="label">Ink</span>
                      <input type="color" value={tex.ink} onChange={(e) => setTex((t) => ({ ...t, ink: e.target.value }))} />
                    </div>
                  )}
                  {effectDef(effect as EffectKind).colors.includes('ink2') && (
                    <div>
                      <span className="label">Ink 2</span>
                      <input type="color" value={tex.ink2} onChange={(e) => setTex((t) => ({ ...t, ink2: e.target.value }))} />
                    </div>
                  )}
                  {effectDef(effect as EffectKind).colors.includes('paper') && (
                    <div>
                      <span className="label">Paper</span>
                      <div className="row">
                        <input type="color" value={tex.paper === 'transparent' ? '#ffffff' : tex.paper} disabled={tex.paper === 'transparent'} onChange={(e) => setTex((t) => ({ ...t, paper: e.target.value }))} />
                        <label className="check"><input type="checkbox" checked={tex.paper === 'transparent'} onChange={(e) => setTex((t) => ({ ...t, paper: e.target.checked ? 'transparent' : TEXTURE_DEFAULTS.paper }))} /> transparent</label>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {effectDef(effect as EffectKind).invert && (
                <label className="check" style={{ marginTop: 4, marginRight: 12 }}>
                  <input type="checkbox" checked={tex.invert} onChange={(e) => setTex((t) => ({ ...t, invert: e.target.checked }))} /> Invert
                </label>
              )}
              {effectDef(effect as EffectKind).colorize && (
                <label className="check" style={{ marginTop: 4 }}>
                  <input type="checkbox" checked={tex.colorize} onChange={(e) => setTex((t) => ({ ...t, colorize: e.target.checked }))} /> Color from image
                </label>
              )}
            </div>
          )}
          {effect === 'halftone' && (
            <div className="controls-wrap">
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
            </div>
          )}

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
            <button className="btn" onClick={exportSvg} disabled={!full || !!busy || effect !== 'halftone'} title={effect === 'halftone' ? 'Resolution-independent halftone for screenprint separations' : 'Vector export is available for the Halftone texture'}>
              Download SVG (vector)
            </button>
            {effect === 'ascii' && (
              <button
                className="btn"
                disabled={!full || !!busy}
                onClick={() => {
                  if (!full || !preview) return
                  const cellPx = Math.max(3, tex.size * (full.width / preview.width))
                  const text = asciiGrid(full, cellPx, tex.invert).rows.join('\n').replace(/[ ]+$/gm, '')
                  saveBlob(new Blob([text], { type: 'text/plain' }), `${baseName}.txt`)
                }}
              >
                Download TXT
              </button>
            )}
            {effect === 'cmyk' && (
              <button
                className="btn"
                disabled={!full || !!busy}
                title="One vector SVG per ink — C/M/Y/K separations at classic screen angles, ready to burn"
                onClick={() => {
                  if (!full || !preview) return
                  const cellPx = Math.max(2, tex.size * (full.width / preview.width))
                  const screens = computeCmykScreens(full, cellPx, tex.amount)
                  for (const { ch, name, angle } of CMYK_CHANNELS) {
                    const svg = screenToSvg(screens[ch], { on: true, cell: 0, angle, shape: 'dot', gain: 1, ink: '#141414', paper: 'transparent', invert: false })
                    saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}-plate-${ch}-${name.toLowerCase()}-${angle}deg.svg`)
                  }
                }}
              >
                Download plates (4× SVG)
              </button>
            )}
            <button className="btn" onClick={() => { setParams(DEFAULTS); setTex({ ...TEXTURE_DEFAULTS }); setEffect('halftone') }}>Reset</button>
          </div>
          <p className="faint hide-mobile" style={{ fontSize: 12, marginTop: 10 }}>
            PNG renders the screen at the chosen size; SVG is true vector (dots as shapes) and scales to any print size in Illustrator or Inkscape.
          </p>
          <p className="faint hide-mobile" style={{ fontSize: 12, marginTop: 10 }}>
            {item.rightsLabel === 'CC0' || item.publicDomain ? 'This work is open access — remix freely.' : 'Check the rights on the original record before publishing edits.'}
          </p>
        </div>
      </div>
    </div>
  )
}
