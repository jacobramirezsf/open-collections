// Standalone image → SVG page: bring your own image, optionally crop it or erase parts of it
// (the editor's own Crop and Erase / restore tools), pick an engine (centerline strokes, outlines,
// or flat colour, see lib/vector/engines), tune it while the vector redraws, then download the SVG,
// copy it, or save it to a board. Built for plotter, CNC and embroidery work first.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CropTool from './CropTool'
import MaskTool from './MaskTool'
import { saveBlob } from '../lib/zip'
import { boardStore, EDITS_ID, type Board } from '../lib/boards'
import { IDB_PREFIX, putBlob } from '../lib/blobstore'
import { onAuthChange } from '../lib/account'
import { uploadEdit } from '../lib/api'
import { SaveToBoard } from './Panels'
import type { Item } from '../../shared/types'
import {
  CENTERLINE_KNOBS,
  COLOR_KNOBS,
  DEFAULT_SETTINGS,
  ENGINES,
  OUTLINE_KNOBS,
  PREP_KNOBS,
  loadSettings,
  runVector,
  saveSettings,
  type Knob,
  type VectorResult,
  type VectorSettings,
} from '../lib/vector/engines'

const KEEP_EDGE = 3000 // the pristine upload is kept at up to this size so a crop keeps its detail
const SIZES = [1000, 1600, 2400, 3000] // longest edge the image is traced at

function toCanvas(img: HTMLImageElement | HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width
  const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height
  const k = Math.min(1, maxEdge / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c
}

interface Picked {
  name: string
  upload: HTMLCanvasElement // as brought in (bounded), so edits can be reset
  original: HTMLCanvasElement // pristine RGB source the tools work from (changes on crop)
  current: HTMLCanvasElement // what gets vectorized (crop + erase applied)
}

const checker = {
  backgroundImage:
    'linear-gradient(45deg, rgba(0,0,0,0.07) 25%, transparent 25%), linear-gradient(-45deg, rgba(0,0,0,0.07) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.07) 75%), linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.07) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
}

// The overlay view draws the vector in red over the faded original, thin enough to see the fit.
function overlaySvg(r: VectorResult): string {
  if (r.engine === 'centerline') {
    const sw = Math.max(1, (r.stats.lineWidth ?? 2) / 3).toFixed(2)
    return r.svg.replace(/stroke="#000"/, 'stroke="#e0002a"').replace(/stroke-width="[^"]*"/, `stroke-width="${sw}"`)
  }
  return r.svg.replace('</svg>', '<style>path{fill:none!important;stroke:#e0002a!important;stroke-width:1px!important;vector-effect:non-scaling-stroke}</style></svg>')
}

function KnobRow({ k, s, onChange }: { k: Knob; s: VectorSettings; onChange: (s: VectorSettings) => void }) {
  const v = k.get(s)
  return (
    <label className="vt-knob" title={k.hint}>
      <span className="vt-knob-label">
        {k.label} <b>{k.show ? k.show(v) : v}</b>
      </span>
      <input type="range" min={k.min} max={k.max} step={k.step} value={v} onChange={(e) => onChange(k.set(s, Number(e.target.value)))} />
    </label>
  )
}

export default function VectorizeTool({ onClose, initialFile }: { onClose: () => void; initialFile?: File | null }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [settings, setSettings] = useState<VectorSettings>(loadSettings)
  const [result, setResult] = useState<VectorResult | null>(null)
  const [view, setView] = useState<'vector' | 'overlay'>('vector')
  const [opening, setOpening] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tool, setTool] = useState<'crop' | 'erase' | null>(null)
  const [saving, setSaving] = useState(false)
  const [savePop, setSavePop] = useState<HTMLElement | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [user, setUser] = useState<string | null>(null)
  const [boards, setBoards] = useState<Board[]>(() => boardStore.list())
  const fileRef = useRef<HTMLInputElement>(null)
  const runRef = useRef<AbortController | null>(null)

  const change = useCallback((s: VectorSettings) => {
    setSettings(s)
    saveSettings(s)
  }, [])

  const reset = useCallback(() => {
    runRef.current?.abort()
    setResult(null)
    setPicked(null)
    setTool(null)
    setError(null)
  }, [])

  const take = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('That is not an image file.')
        return
      }
      reset()
      setOpening(true)
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          const c = toCanvas(img, KEEP_EDGE)
          setPicked({ name: file.name.replace(/\.[^.]+$/, '') || 'image', upload: c, original: c, current: c })
          setOpening(false)
        }
        img.onerror = () => {
          setError('That image could not be opened.')
          setOpening(false)
        }
        img.src = String(reader.result)
      }
      reader.onerror = () => {
        setError('That file could not be read.')
        setOpening(false)
      }
      reader.readAsDataURL(file)
    },
    [reset],
  )

  const previewUrl = useMemo(() => (picked ? picked.current.toDataURL('image/png') : ''), [picked])
  const edited = !!picked && picked.current !== picked.upload

  // Redraws whenever the image or a setting changes, shortly after the last change. Centerline
  // and colour run in the worker; outline makes a quick round trip to the server.
  useEffect(() => {
    if (!picked) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      runRef.current?.abort()
      runRef.current = ctrl
      setRunning(true)
      setError(null)
      try {
        const r = await runVector(picked.current, settings, ctrl.signal)
        if (!ctrl.signal.aborted) setResult(r)
      } catch (e) {
        if ((e as Error).name !== 'AbortError' && !ctrl.signal.aborted) setError((e as Error).message)
      } finally {
        if (runRef.current === ctrl) setRunning(false)
      }
    }, settings.engine === 'outline' ? 450 : 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [picked, settings])

  useEffect(() => () => runRef.current?.abort(), [])

  const resultUrl = useMemo(() => {
    if (!result) return null
    return URL.createObjectURL(new Blob([view === 'overlay' ? overlaySvg(result) : result.svg], { type: 'image/svg+xml' }))
  }, [result, view])
  useEffect(() => () => void (resultUrl && URL.revokeObjectURL(resultUrl)), [resultUrl])

  const engineLabel = (id: string) => ENGINES.find((e) => e.id === id)?.label ?? id
  const fileName = () => `${(picked?.name || 'image').replace(/[^a-zA-Z0-9._-]+/g, '-')}-${result?.engine || 'vector'}.svg`

  const download = () => {
    if (result) saveBlob(new Blob([result.svg], { type: 'image/svg+xml' }), fileName())
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.svg)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy to the clipboard.')
    }
  }

  // paste straight from the clipboard; Escape leaves (the open tool handles its own Escape)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files || [])][0]
      if (f) take(f)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !tool && (picked ? reset() : onClose())
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [take, reset, picked, onClose, tool])

  useEffect(() => {
    document.title = 'Vectorize · Open Collections'
  }, [])
  useEffect(() => onAuthChange((a) => setUser(a.user)), [])
  useEffect(() => boardStore.subscribe(() => setBoards(boardStore.list())), [])
  useEffect(() => {
    if (initialFile) take(initialFile)
  }, [initialFile, take])

  const say = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 2600)
  }

  // Keeps the SVG on a board: the bytes go to IndexedDB in this browser, or to the account's
  // storage when signed in, and the board holds a reference, like a saved edit.
  const openSave = (anchor: HTMLElement) => {
    boardStore.create('Edits', EDITS_ID) // the usual home for generated work, created on first use
    setSavePop(anchor)
  }

  const saveTo = async (b: Board) => {
    setSavePop(null)
    if (!result || !picked) return
    setSaving(true)
    setError(null)
    try {
      const blob = new Blob([result.svg], { type: 'image/svg+xml' })
      let url: string
      if (user) url = await uploadEdit(blob, 'image/svg+xml')
      else {
        const key = `vector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        if (!(await putBlob(key, blob))) throw new Error('This browser would not store the file (private browsing can block it).')
        url = IDB_PREFIX + key
      }
      const item: Item = {
        id: `edits:vector-${Date.now()}`,
        source: 'edits',
        sourceName: 'My edits',
        sourceUrl: '',
        title: `${picked.name} · vector`,
        creator: 'Vectorized from your upload',
        dateDisplay: new Date().toLocaleDateString(),
        yearStart: null,
        yearEnd: null,
        objectType: 'Vector',
        medium: `vector · ${engineLabel(result.engine).toLowerCase()}`,
        culture: null,
        place: null,
        publicDomain: null,
        rightsLabel: 'Your own image',
        licenseUrl: null,
        thumbnailUrl: url,
        imageUrl: url,
        originalImageUrl: url,
        width: null,
        height: null,
        contentType: 'image',
        files: [],
      }
      const n = boardStore.addItems(b.id, [item])
      const failed = boardStore.lastPersistError()
      if (failed) throw new Error(failed)
      say(n ? (user ? `Saved to “${b.name}” on your account` : `Saved to “${b.name}” (this browser). Sign in to keep it on your account.`) : `Already in “${b.name}”`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const s = settings
  const engine = ENGINES.find((e) => e.id === s.engine)!
  const engineKnobs = s.engine === 'centerline' ? CENTERLINE_KNOBS : s.engine === 'outline' ? OUTLINE_KNOBS : COLOR_KNOBS
  // distances in the traced bitmap's pixels, shown in mm once a physical width is set
  const dist = (px: number) => {
    if (!result) return ''
    if (s.widthMm > 0) {
      const mm = (px * s.widthMm) / result.w
      return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`
    }
    return `${Math.round(px).toLocaleString()} px`
  }
  const resetEngine = () => {
    const d = DEFAULT_SETTINGS
    change(s.engine === 'color' ? { ...s, color: d.color } : { ...s, prep: d.prep, [s.engine]: d[s.engine] })
  }

  return (
    <div className={'uploader vt' + (picked ? ' has-image' : '')}>
      <div className="uploader-inner">
        <h1 className="intro-title" style={{ marginBottom: 6 }}>Vectorize<span className="wip">Work in progress</span></h1>
        <p className="intro-lead" style={{ marginBottom: 22 }}>
          {picked
            ? 'Pick an engine and tune it; the vector redraws as you go. Crop to the part you want or erase what should not be traced.'
            : 'Turn a bitmap into an SVG for a plotter, CNC, cutter or embroidery machine, or for Illustrator, Inkscape and Figma. Line art can become single strokes, outlines or flat colour shapes. Runs in your browser; nothing is saved.'}
        </p>
        <p className="wip-note" role="note">We are rebuilding the vectorizer with new tracing engines. Results and settings may change while we work on it.</p>

        {!picked ? (
          <div
            className={'dropzone' + (over ? ' over' : '')}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files[0]
              if (f) take(f)
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) take(f)
                e.target.value = ''
              }}
            />
            <strong>{opening ? 'Opening…' : 'Choose an image'}</strong>
            <span className="faint">or drag one here, or paste from the clipboard</span>
          </div>
        ) : (
          <>
            <div className="vt-engines" role="radiogroup" aria-label="Engine">
              {ENGINES.map((e) => (
                <button key={e.id} type="button" role="radio" aria-checked={s.engine === e.id} className={'btn' + (s.engine === e.id ? ' active' : '')} onClick={() => change({ ...s, engine: e.id })}>
                  {e.label}
                </button>
              ))}
              <span className="vt-engine-blurb faint">{engine.blurb}</span>
            </div>

            <div className="vt-compare two">
              <figure className="vt-pane" style={checker}>
                <img src={previewUrl} alt="Original" />
                <figcaption>
                  {edited ? 'Edited' : 'Original'} · {picked.current.width}×{picked.current.height}
                </figcaption>
              </figure>
              <figure className={'vt-pane vt-live' + (running ? ' busy' : '')} style={checker}>
                {resultUrl ? (
                  <div className="vt-stack">
                    {view === 'overlay' && <img src={previewUrl} alt="" className="vt-under" />}
                    <img src={resultUrl} alt="Vectorized" />
                  </div>
                ) : (
                  <div className="vt-wait"><span className="spinner" /></div>
                )}
                <figcaption>
                  <span className="vt-views">
                    <button type="button" className={'btn link' + (view === 'vector' ? ' on' : '')} onClick={() => setView('vector')}>Vector</button>
                    <button type="button" className={'btn link' + (view === 'overlay' ? ' on' : '')} onClick={() => setView('overlay')} title="The vector in red over the faded original, to check the fit">Overlay</button>
                  </span>
                  {running && <span className="spinner" style={{ margin: '0 6px' }} />}
                  {result && (
                    <>
                      {' '}· {result.stats.paths.toLocaleString()} paths · {result.stats.points.toLocaleString()} nodes · {Math.max(1, Math.round(result.stats.bytes / 1024))} KB
                      {result.stats.length != null && <> · stroke {dist(result.stats.length)} · jumps {dist(result.stats.travel ?? 0)}</>}
                    </>
                  )}
                </figcaption>
              </figure>
            </div>

            <div className="vt-actions">
              <button className="btn primary" onClick={download} disabled={!result}>Download SVG</button>
              <button className="btn" disabled={!result || saving} onClick={(e) => openSave(e.currentTarget)} title={user ? 'Keeps the SVG on a board on your account' : 'Keeps the SVG on a board in this browser; sign in to keep it on your account'}>
                {saving ? 'Saving…' : 'Save to board'}
              </button>
              <button className="btn" onClick={copy} disabled={!result}>{copied ? 'Copied' : 'Copy SVG code'}</button>
              <span className="vt-sep" />
              <button className="btn" onClick={() => setTool('crop')} title="Take a detail out of the image and vectorize that">Crop</button>
              <button className="btn" onClick={() => setTool('erase')} title="Paint away parts that should not be traced, or paint the original back">Erase / restore</button>
              {edited && (
                <button className="btn" onClick={() => setPicked((p) => (p ? { ...p, original: p.upload, current: p.upload } : p))} title="Back to the image as you brought it">
                  Undo edits
                </button>
              )}
              <button className="btn" onClick={reset}>Another image</button>
            </div>

            <div className="vt-settings">
              {s.engine !== 'color' && (
                <section>
                  <h3>Ink</h3>
                  {PREP_KNOBS.map((k) => (
                    <KnobRow key={k.key} k={k} s={s} onChange={change} />
                  ))}
                  <label className="vt-check" title="Compare each pixel with its neighbourhood instead of one threshold for the whole image. For photos of paper and uneven scans.">
                    <input type="checkbox" checked={s.prep.adaptive} onChange={(e) => change({ ...s, prep: { ...s.prep, adaptive: e.target.checked } })} />
                    Adaptive threshold
                  </label>
                  <label className="vt-check" title="Trace light lines on a dark ground">
                    <input type="checkbox" checked={s.prep.invert} onChange={(e) => change({ ...s, prep: { ...s.prep, invert: e.target.checked } })} />
                    Light lines on dark
                  </label>
                </section>
              )}
              <section>
                <h3>{engine.label}</h3>
                {engineKnobs.map((k) => (
                  <KnobRow key={k.key} k={k} s={s} onChange={change} />
                ))}
                {s.engine === 'color' && (
                  <>
                    <label className="vt-field">
                      Shapes
                      <select className="input" value={s.color.mode} onChange={(e) => change({ ...s, color: { ...s.color, mode: e.target.value as 'spline' | 'polygon' } })}>
                        <option value="spline">Curves</option>
                        <option value="polygon">Straight edges</option>
                      </select>
                    </label>
                    <label className="vt-field" title="Cut out: shapes sit side by side and never overlap (one layer of stitches or cuts). Stacked: shapes sit on top of each other, smaller files.">
                      Layering
                      <select className="input" value={s.color.layering} onChange={(e) => change({ ...s, color: { ...s.color, layering: e.target.value as 'cutout' | 'stacked' } })}>
                        <option value="cutout">Cut out (no overlaps)</option>
                        <option value="stacked">Stacked</option>
                      </select>
                    </label>
                    <label className="vt-field" title="Watershed often keeps soft-edged regions together better">
                      Regions
                      <select className="input" value={s.color.clustering} onChange={(e) => change({ ...s, color: { ...s.color, clustering: e.target.value as 'color-cluster' | 'watershed' } })}>
                        <option value="color-cluster">Colour clusters</option>
                        <option value="watershed">Watershed</option>
                      </select>
                    </label>
                  </>
                )}
                <button type="button" className="btn link" onClick={resetEngine}>Reset {engine.label.toLowerCase()} settings</button>
              </section>
              <section>
                <h3>Output</h3>
                <label className="vt-field" title="Longest edge the image is traced at. Bigger keeps finer detail and takes longer.">
                  Trace at
                  <select className="input" value={s.size} onChange={(e) => change({ ...s, size: Number(e.target.value) })}>
                    {SIZES.map((n) => (
                      <option key={n} value={n}>{n}px</option>
                    ))}
                  </select>
                </label>
                <label className="vt-field" title="Physical width written into the SVG, so a plotter, cutter or embroidery program opens it at this size. Empty = pixels.">
                  Width
                  <span className="vt-mm">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={1}
                      placeholder="px"
                      value={s.widthMm || ''}
                      onChange={(e) => change({ ...s, widthMm: Math.max(0, Number(e.target.value) || 0) })}
                    />
                    mm
                  </span>
                </label>
                {s.engine !== 'centerline' && (
                  <label className="vt-check" title="Hairline outlines in each shape's colour instead of filled shapes. For pens, lasers and knives.">
                    <input type="checkbox" checked={s.outlinesOnly} onChange={(e) => change({ ...s, outlinesOnly: e.target.checked })} />
                    Outlines only, no fills
                  </label>
                )}
                {result && s.engine === 'centerline' && result.stats.lineWidth != null && (
                  <p className="faint vt-note">
                    Traced lines are about {dist(result.stats.lineWidth)} wide; each path also carries its own width as <code>data-width</code>.
                  </p>
                )}
              </section>
            </div>
          </>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        <button className="btn link" style={{ marginTop: 18 }} onClick={onClose}>← Back to the studio</button>
      </div>

      {savePop && (
        <SaveToBoard
          boards={boards}
          anchor={savePop}
          onPick={(b) => void saveTo(b)}
          onCreate={(name) => void saveTo(boardStore.create(name))}
          onClose={() => setSavePop(null)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}

      {tool === 'crop' && picked && (
        <CropTool
          source={picked.original}
          onApply={(c) => {
            // like the editor: the crop becomes the new pristine source, and erasing starts over on it
            setPicked((p) => (p ? { ...p, original: c, current: c } : p))
            setTool(null)
          }}
          onClose={() => setTool(null)}
        />
      )}
      {tool === 'erase' && picked && (
        <MaskTool
          original={picked.original}
          current={picked.current}
          onApply={(c) => {
            setPicked((p) => (p ? { ...p, current: c } : p))
            setTool(null)
          }}
          onClose={() => setTool(null)}
        />
      )}
    </div>
  )
}
