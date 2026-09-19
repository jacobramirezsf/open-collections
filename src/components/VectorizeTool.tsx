// Standalone image → SVG page: bring your own image, optionally crop it or erase parts of it
// (the editor's own Crop and Erase / restore tools), then redraw it as vector shapes (QuiverAI
// through /api/vectorize, same endpoint as the editor's Vectorize button), compare, download the
// SVG. No effects, boards or saved edits live here.
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
import { applyDraft, closePartialSvg, readSse } from '../lib/quiverStream'
import { flattenSvg, type FlattenStats } from '../lib/flattenSvg'

const KEEP_EDGE = 3000 // the pristine upload is kept at up to this size so a crop keeps its detail
const SEND_EDGE = 1024 // the API draws at 1024px, so what we send is bounded to that

// QuiverAI vectorization models (docs.quiver.ai/developers/models); the API allowlists the same ids
export const MODELS: { id: string; label: string; note: string }[] = [
  { id: 'arrow-1.1', label: 'Arrow 1.1', note: 'previous generation · cheapest, flat price per image' },
  { id: 'arrow-2', label: 'Arrow 2', note: 'fastest · built for rapid iteration' },
  { id: 'arrow-2-telos', label: 'Arrow 2 Telos', note: 'most capable · demanding vector work, costs more' },
]
const MODEL_KEY = 'oc:quiver-model'
const FLATTEN_KEY = 'oc:quiver-flatten'
const DEFAULT_MODEL = 'arrow-1.1'

function readFlag(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v == null ? def : v === '1'
  } catch {
    return def
  }
}

function readModel(): string {
  try {
    const m = localStorage.getItem(MODEL_KEY)
    return MODELS.some((x) => x.id === m) ? m! : DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

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

interface Vector {
  svg: string // what is shown and downloaded
  raw: string // as the model drew it (stacked shapes)
  url: string
  sandbox: boolean
  model: string
  flat: FlattenStats | null // set when svg is the flattened version
}

const checker = {
  backgroundImage:
    'linear-gradient(45deg, rgba(0,0,0,0.07) 25%, transparent 25%), linear-gradient(-45deg, rgba(0,0,0,0.07) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.07) 75%), linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.07) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
}

export default function VectorizeTool({ onClose, initialFile }: { onClose: () => void; initialFile?: File | null }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [vector, setVector] = useState<Vector | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [copied, setCopied] = useState(false)
  const [model, setModel] = useState(readModel)
  const [flatten, setFlatten] = useState(() => readFlag(FLATTEN_KEY, true)) // cut shapes to what is visible
  const [tool, setTool] = useState<'crop' | 'erase' | null>(null)
  const [draft, setDraft] = useState<string | null>(null) // blob URL of the vector so far, while streaming
  const [phase, setPhase] = useState<string | null>(null) // what the model says it is doing
  const [saving, setSaving] = useState(false)
  const [savePop, setSavePop] = useState<HTMLElement | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [user, setUser] = useState<string | null>(null)
  const [boards, setBoards] = useState<Board[]>(() => boardStore.list())
  const fileRef = useRef<HTMLInputElement>(null)
  const runRef = useRef<AbortController | null>(null)

  const showDraft = useCallback((svg: string | null) => {
    setDraft((old) => {
      if (old) URL.revokeObjectURL(old)
      return svg ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) : null
    })
  }, [])

  const dropVector = useCallback(() => {
    setVector((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return null
    })
  }, [])

  const reset = useCallback(() => {
    runRef.current?.abort()
    dropVector()
    setPicked(null)
    setTool(null)
    setError(null)
  }, [dropVector])

  const take = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('That is not an image file.')
        return
      }
      reset()
      setBusy('Opening…')
      const reader = new FileReader()
      reader.onload = () => {
        const src = String(reader.result)
        const img = new Image()
        img.onload = () => {
          const c = toCanvas(img, KEEP_EDGE)
          setPicked({ name: file.name.replace(/\.[^.]+$/, '') || 'image', upload: c, original: c, current: c })
          setBusy(null)
        }
        img.onerror = () => {
          setError('That image could not be opened.')
          setBusy(null)
        }
        img.src = src
      }
      reader.onerror = () => {
        setError('That file could not be read.')
        setBusy(null)
      }
      reader.readAsDataURL(file)
    },
    [reset],
  )

  // the preview of what will be sent; erased areas show through to the checker
  const previewUrl = useMemo(() => (picked ? picked.current.toDataURL('image/png') : ''), [picked])
  const edited = !!picked && picked.current !== picked.upload

  // Builds the shown result from what the model drew, flattening to visible shapes when asked.
  const finish = useCallback(async (raw: string, meta: { sandbox: boolean; model: string }, doFlatten: boolean) => {
    let svg = raw
    let flat: FlattenStats | null = null
    if (doFlatten) {
      setBusy('Flattening…')
      try {
        const r = await flattenSvg(raw, (done, total) => setPhase(`Cutting hidden parts · ${done}/${total}`))
        svg = r.svg
        flat = r.stats
      } catch (e) {
        setError('Could not flatten the shapes, showing the vector as drawn (' + (e as Error).message + ').')
      }
      setPhase(null)
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    setVector((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return { svg, raw, url, sandbox: meta.sandbox, model: meta.model, flat }
    })
  }, [])

  const toggleFlatten = async (on: boolean) => {
    setFlatten(on)
    try {
      localStorage.setItem(FLATTEN_KEY, on ? '1' : '0')
    } catch {
      /* private mode */
    }
    // re-derive the current result from what the model drew, no new API call
    if (vector && !busy) {
      await finish(vector.raw, { sandbox: vector.sandbox, model: vector.model }, on)
      setBusy(null)
    }
  }

  // Streams the vectorization so the drawing appears while it is being made: each draft event
  // adds to the SVG so far, which is closed off and shown; the content event is the finished file.
  const vectorize = useCallback(async () => {
    if (!picked) return
    runRef.current?.abort()
    const ctrl = new AbortController()
    runRef.current = ctrl
    setBusy('Vectorizing…')
    setPhase(null)
    setError(null)
    showDraft(null)
    try {
      const image = toCanvas(picked.current, SEND_EDGE).toDataURL('image/png')
      const res = await fetch('/api/vectorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, model, stream: true }),
        signal: ctrl.signal,
      })
      let usedModel = res.headers.get('x-quiver-model') || model
      let sandbox = res.headers.get('x-quiver-environment') === 'test'
      let finalSvg: string | null = null
      if ((res.headers.get('content-type') || '').includes('text/event-stream') && res.body) {
        let sofar = ''
        let lastShown = 0
        for await (const ev of readSse(res.body, ctrl.signal)) {
          const d = ev.data
          if (ev.event === 'error') throw new Error(d?.message || 'Vectorization failed.')
          if (ev.event === 'generating' || ev.event === 'reasoning') {
            if (typeof d?.text === 'string' && d.text.trim()) setPhase(d.text.trim().slice(0, 120))
            continue
          }
          if (ev.event === 'draft') {
            sofar = applyDraft(sofar, d)
            const now = performance.now()
            if (now - lastShown > 120) {
              lastShown = now
              showDraft(closePartialSvg(sofar))
            }
            continue
          }
          if (ev.event === 'content' && typeof d?.svg === 'string') {
            finalSvg = d.svg
            break
          }
        }
        if (!finalSvg && /<\/svg>\s*$/i.test(sofar)) finalSvg = sofar
      } else {
        // a non-streaming answer (older server, or an error before the stream started)
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error || `Vectorization failed (${res.status})`)
        finalSvg = typeof payload?.svg === 'string' ? payload.svg : null
        sandbox = sandbox || !!payload?.sandbox
        if (typeof payload?.model === 'string') usedModel = payload.model
      }
      if (ctrl.signal.aborted) return
      if (!finalSvg) throw new Error('Vectorization ended without a result.')
      sandbox = sandbox || finalSvg.includes('data-quiver-sandbox')
      await finish(finalSvg, { sandbox, model: usedModel }, flatten)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      if (runRef.current === ctrl) {
        setBusy(null)
        setPhase(null)
        showDraft(null)
      }
    }
  }, [picked, model, showDraft, flatten, finish])

  // leaving the page or picking another image stops a run in flight
  useEffect(() => () => runRef.current?.abort(), [])

  const pickModel = (id: string) => {
    setModel(id)
    try {
      localStorage.setItem(MODEL_KEY, id)
    } catch {
      /* private mode */
    }
  }
  const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id

  const download = () => {
    if (!vector || !picked) return
    saveBlob(new Blob([vector.svg], { type: 'image/svg+xml' }), `${picked.name.replace(/[^a-zA-Z0-9._-]+/g, '-')}-vector.svg`)
  }

  const copy = async () => {
    if (!vector) return
    try {
      await navigator.clipboard.writeText(vector.svg)
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
    if (!vector || !picked) return
    setSaving(true)
    setError(null)
    try {
      const blob = new Blob([vector.svg], { type: 'image/svg+xml' })
      let url: string
      if (user) url = await uploadEdit(blob, 'image/svg+xml')
      else {
        const key = `vector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        if (!(await putBlob(key, blob))) throw new Error('This browser would not store the file (private browsing can block it).')
        url = IDB_PREFIX + key
      }
      const label = `vector · ${modelLabel(vector.model)}${vector.flat ? ' · flattened' : ''}`
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
        medium: label,
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

  const kb = vector ? Math.max(1, Math.round(vector.svg.length / 1024)) : 0

  return (
    <div className={'uploader vt' + (picked ? ' has-image' : '')}>
      <div className="uploader-inner">
        <h1 className="intro-title" style={{ marginBottom: 6 }}>Vectorize</h1>
        <p className="intro-lead" style={{ marginBottom: 22 }}>
          {picked
            ? 'Crop to the part you want or erase what should not be traced, then redraw it as clean, editable vector shapes. Best on logos, drawings, lettering and flat artwork.'
            : 'Turn a bitmap into an SVG. Bring a logo, drawing, sticker or any flat artwork and get back clean, editable vector shapes for Illustrator, Inkscape, Figma or a plotter. Nothing is saved.'}
        </p>

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
            <strong>{busy ? 'Opening…' : 'Choose an image'}</strong>
            <span className="faint">or drag one here, or paste from the clipboard</span>
          </div>
        ) : (
          <>
            <div className={'vt-compare' + (vector || busy ? ' two' : '')}>
              <figure className="vt-pane" style={checker}>
                <img src={previewUrl} alt="Original" />
                <figcaption>
                  {edited ? 'Edited' : 'Original'} · {picked.current.width}×{picked.current.height}
                </figcaption>
              </figure>
              {busy ? (
                <figure className="vt-pane vt-live" style={checker}>
                  {draft ? <img src={draft} alt="Vector so far" /> : <div className="vt-wait"><span className="spinner" /></div>}
                  <figcaption>
                    <span className="spinner" style={{ marginRight: 6 }} />
                    {busy === 'Flattening…' ? phase || 'Flattening…' : draft ? 'Drawing…' : phase || 'Starting…'} · {modelLabel(model)}
                  </figcaption>
                </figure>
              ) : (
                vector && (
                  <figure className="vt-pane" style={checker}>
                    <img src={vector.url} alt="Vectorized" />
                    <figcaption>
                      SVG · {kb} KB · {modelLabel(vector.model)}
                      {vector.flat ? ` · ${vector.flat.cut + vector.flat.removed ? `${vector.flat.cut} shapes cut, ${vector.flat.removed} hidden removed` : 'nothing was hidden'}` : ' · as drawn'}
                      {vector.sandbox ? ' · preview mode' : ''}
                    </figcaption>
                  </figure>
                )
              )}
            </div>

            <div className="vt-actions vt-prep">
              <button className="btn" disabled={!!busy} onClick={() => setTool('crop')} title="Take a detail out of the image and vectorize that">Crop</button>
              <button className="btn" disabled={!!busy} onClick={() => setTool('erase')} title="Paint away parts that should not be traced, or paint the original back">Erase / restore</button>
              {edited && (
                <button
                  className="btn"
                  disabled={!!busy}
                  onClick={() => {
                    setPicked((p) => (p ? { ...p, original: p.upload, current: p.upload } : p))
                    dropVector()
                  }}
                  title="Back to the image as you brought it"
                >
                  Undo edits
                </button>
              )}
            </div>

            <div className="vt-actions">
              <label className="vt-model" title={MODELS.find((m) => m.id === model)?.note}>
                Model
                <select className="input" value={model} disabled={!!busy} onChange={(e) => pickModel(e.target.value)}>
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="vt-model" title="Cut every shape down to the part you can see, so nothing is drawn underneath other shapes. Renders the same; opens flat in Illustrator or on a plotter.">
                <input type="checkbox" checked={flatten} disabled={!!busy} onChange={(e) => void toggleFlatten(e.target.checked)} />
                Only visible shapes
              </label>
              {!vector ? (
                <button className="btn primary" onClick={vectorize} disabled={!!busy}>{busy ? 'Vectorizing…' : 'Vectorize'}</button>
              ) : (
                <>
                  <button className="btn primary" onClick={download}>Download SVG</button>
                  <button className="btn" disabled={saving} onClick={(e) => openSave(e.currentTarget)} title={user ? 'Keeps the SVG on a board on your account' : 'Keeps the SVG on a board in this browser; sign in to keep it on your account'}>
                    {saving ? 'Saving…' : 'Save to board'}
                  </button>
                  <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy SVG code'}</button>
                  <button className="btn" onClick={vectorize} disabled={!!busy} title={vector.model === model ? 'Runs the vectorizer again on the same image' : `Redraw with ${modelLabel(model)}`}>
                    {busy ? 'Vectorizing…' : vector.model === model ? 'Redo' : `Redo with ${modelLabel(model)}`}
                  </button>
                </>
              )}
              <button className="btn" onClick={reset} disabled={!!busy}>Another image</button>
            </div>
            {vector?.sandbox && <p className="faint" style={{ fontSize: 12, margin: '10px 0 0' }}>Preview-mode result. Full-quality vectorization is not enabled yet.</p>}
            {!vector && !busy && (
              <p className="faint" style={{ fontSize: 12, margin: '10px 0 0' }}>
                {MODELS.find((m) => m.id === model)?.label}: {MODELS.find((m) => m.id === model)?.note}. Rate-limited to a few runs a day per person; the drawing appears as it is made.
              </p>
            )}
            {busy && (
              <p className="faint" style={{ fontSize: 12, margin: '10px 0 0' }}>
                Watching the vector take shape. <button className="btn link" onClick={() => runRef.current?.abort()}>Stop</button>
              </p>
            )}
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
            dropVector()
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
            dropVector()
            setTool(null)
          }}
          onClose={() => setTool(null)}
        />
      )}
    </div>
  )
}
