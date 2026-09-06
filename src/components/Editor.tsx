// Image editor: background removal, stackable texture effects (halftone, dithers, riso, embroidery…
// applied in the order you select them), paper surface textures, vectorization, pinch/scroll zoom,
// and exports: hi-res PNG, vector SVG (halftone), share-sheet (straight to Photos on iOS), and
// "Save to Edits" which keeps the original artwork's name + link with the edit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Item } from '../../shared/types'
import { proxyImageUrl, uploadEdit} from '../lib/api'
import { saveBlob } from '../lib/zip'
import { saveImage } from '../lib/save'
import { boardStore, CUTOUTS_ID, EDITS_ID } from '../lib/boards'
import { onAuthChange } from '../lib/account'
import { computeScreen, renderScreen, screenToSvg, type HalftoneParams } from '../lib/halftone'
import {
  CMYK_CHANNELS, EFFECTS, INK_PRESETS, PAPER_TEXTURES, TEXTURE_DEFAULTS, applyPaperTexture, applyTexture, asciiGrid,
  computeCmykScreens, effectDef, type EffectKind, type PaperTexture, type TextureParams,
} from '../lib/textures'
import { PAPER_SHEETS, paperUrl, sheetDef } from '../lib/papers'
import MaskTool from './MaskTool'
import CropTool from './CropTool'
import { backgroundImageUrl, isContainedBackground, isSheetValue } from './BackgroundPicker'
import { useBodyLock } from './Panels'

interface Props {
  item: Item
  onClose: () => void
}

const HT_DEFAULTS: HalftoneParams = { on: true, cell: 8, angle: 22, shape: 'dot', gain: 1.15, ink: '#141414', paper: '#f3f1ec', invert: false }
// does this image carry real transparency (i.e. is it already a cutout)?
function hasAlpha(c: HTMLCanvasElement): boolean {
  const s = document.createElement('canvas')
  s.width = 64
  s.height = 64
  const ctx = s.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(c, 0, 0, 64, 64)
  const d = ctx.getImageData(0, 0, 64, 64).data
  let clear = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] < 8) clear++
  return clear / 4096 > 0.04
}

const PREVIEW_MAX = 1800
const SOURCE_MAX = 6000
const EXPORT_MAX_PIXELS = 64e6
const sheetCache = new Map<string, HTMLImageElement>()
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

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
    if (!src.startsWith('blob:') && !src.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => ok(img)
    img.onerror = () => bad(new Error('image failed to load'))
    img.src = src
  })
}

export default function Editor({ item, onClose }: Props) {
  useBodyLock()
  const [params, setParams] = useState<HalftoneParams>(HT_DEFAULTS) // halftone-specific
  const [tex, setTex] = useState<TextureParams>({ ...TEXTURE_DEFAULTS }) // shared by other effects
  const [stack, setStack] = useState<EffectKind[]>([]) // open on the plain image; effects are opt-in
  const [paperTex, setPaperTex] = useState<string>('none') // PaperTexture or 'img:<slug>'
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null)
  const [sheetMode, setSheetMode] = useState<'ink' | 'behind'>('ink')
  const [full, setFull] = useState<HTMLCanvasElement | null>(null)
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null)
  const [originalFull, setOriginalFull] = useState<HTMLCanvasElement | null>(null)
  const [cutoutApplied, setCutoutApplied] = useState(false)
  const [refining, setRefining] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [sheetRotate, setSheetRotate] = useState(0)
  const [busy, setBusy] = useState<string | null>('Loading image…')
  const [error, setError] = useState<string | null>(null)
  const [exportScale, setExportScale] = useState(1)
  const [vector, setVector] = useState<{ svg: string; url: string; sandbox: boolean } | null>(null)
  const [user, setUser] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const renderTimer = useRef<number>(0)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchBase = useRef<{ dist: number; zoom: number } | null>(null)
  const panBase = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => onAuthChange((s) => setUser(s.user)), [])
  useEffect(() => {
    if (!isSheetValue(paperTex)) {
      setSheet(null)
      return
    }
    const slug = paperTex
    const cached = sheetCache.get(slug)
    if (cached) {
      setSheet(cached)
      return
    }
    let dead = false
    loadImg(backgroundImageUrl(slug)!).then((img) => {
      sheetCache.set(slug, img)
      if (!dead) setSheet(img)
    }).catch(() => {})
    return () => {
      dead = true
    }
  }, [paperTex])
  const say = useCallback((m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 2800)
  }, [])

  const adopt = useCallback((c: HTMLCanvasElement) => {
    setFull(c)
    setPreview(toCanvas(c, PREVIEW_MAX))
  }, [])

  // load the largest browser-decodable rendition
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
          // an image that arrives with real transparency is already a cutout: treat it as one so
          // effects, erase and export all keep the alpha instead of pasting it onto white
          if (hasAlpha(c)) {
            setCutoutApplied(true)
            setParams((p) => ({ ...p, paper: 'transparent' }))
            setTex((t) => ({ ...t, paper: 'transparent' }))
          }
          adopt(c)
          setBusy(null)
          return
        } catch {
          /* try next */
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

  // ---- effect pipeline ----
  const buildOutput = useCallback(
    (base: HTMLCanvasElement, scale: number): HTMLCanvasElement => {
      let cur = base
      if (scale !== 1) {
        const c = document.createElement('canvas')
        c.width = Math.round(base.width * scale)
        c.height = Math.round(base.height * scale)
        c.getContext('2d')!.drawImage(base, 0, 0, c.width, c.height)
        cur = c
      }
      const pw = preview?.width || base.width
      const useSheet = isSheetValue(paperTex) && sheet
      const htP = useSheet ? { ...params, paper: 'transparent' } : params
      const texP = useSheet ? { ...tex, paper: 'transparent' } : tex
      for (const k of stack) {
        cur = k === 'halftone' ? renderScreen(computeScreen(cur, htP, pw), htP) : applyTexture(k, cur, texP, pw, 1)
      }
      if (useSheet) {
        const turned = sheetRotate % 180 !== 0
        const sw = turned ? sheet.naturalHeight : sheet.naturalWidth
        const sh = turned ? sheet.naturalWidth : sheet.naturalHeight
        // draw the sheet at `size`, rotated about its own centre
        const drawSheet = (ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) => {
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate((sheetRotate * Math.PI) / 180)
          if (turned) ctx.drawImage(sheet, -h / 2, -w / 2, h, w)
          else ctx.drawImage(sheet, -w / 2, -h / 2, w, h)
          ctx.restore()
        }
        if (isContainedBackground(paperTex)) {
          // cut-out sheet or garment: it keeps its silhouette, the artwork prints inside it, and
          // the surround stays transparent
          const grow = Math.max(cur.width / sw, cur.height / sh)
          const out = document.createElement('canvas')
          out.width = Math.round(sw * grow)
          out.height = Math.round(sh * grow)
          const ctx = out.getContext('2d')!
          drawSheet(ctx, out.width / 2, out.height / 2, out.width, out.height)
          const inset = 0.07 * Math.min(out.width, out.height)
          const fit = Math.min((out.width - inset * 2) / cur.width, (out.height - inset * 2) / cur.height)
          ctx.drawImage(cur, (out.width - cur.width * fit) / 2, (out.height - cur.height * fit) / 2, cur.width * fit, cur.height * fit)
          if (sheetMode === 'ink') {
            // overlay: press the sheet back over the artwork so its grain, creases and shading
            // read through the ink instead of the ink sitting on top like a sticker
            ctx.globalCompositeOperation = 'multiply'
            drawSheet(ctx, out.width / 2, out.height / 2, out.width, out.height)
          }
          // trim back to the sheet's silhouette so the rough edge survives
          ctx.globalCompositeOperation = 'destination-in'
          drawSheet(ctx, out.width / 2, out.height / 2, out.width, out.height)
          ctx.globalCompositeOperation = 'source-over'
          cur = out
        } else {
          // the sheet becomes the page; the effect output is multiplied over it like ink on stock
          const out = document.createElement('canvas')
          out.width = cur.width
          out.height = cur.height
          const ctx = out.getContext('2d')!
          const cover = Math.max(out.width / sw, out.height / sh)
          drawSheet(ctx, out.width / 2, out.height / 2, sw * cover, sh * cover)
          ctx.drawImage(cur, 0, 0)
          if (sheetMode === 'ink') {
            // overlay: the stock's texture comes back over the ink, so it reads as printed
            ctx.globalCompositeOperation = 'multiply'
            drawSheet(ctx, out.width / 2, out.height / 2, sw * cover, sh * cover)
          }
          ctx.globalCompositeOperation = 'source-over'
          cur = out
        }
      } else if (stack.length && paperTex !== 'none') {
        cur = applyPaperTexture(cur === base ? toCanvas(base, 1e9) : cur, paperTex as PaperTexture, cur.width / pw)
      }
      return cur
    },
    [stack, params, tex, paperTex, sheet, sheetMode, sheetRotate, preview],
  )

  // debounced preview render
  useEffect(() => {
    if (!preview || !canvasRef.current) return
    window.clearTimeout(renderTimer.current)
    renderTimer.current = window.setTimeout(() => {
      const out = buildOutput(preview, 1)
      const c = canvasRef.current!
      c.width = out.width
      c.height = out.height
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(out, 0, 0)
    }, 60)
  }, [preview, buildOutput])

  const toggleEffect = (k: EffectKind | 'none') => {
    if (k === 'none') {
      setStack([])
      return
    }
    setStack((s) => {
      const label = (x: EffectKind) => (x === 'halftone' ? 'Halftone' : effectDef(x).label)
      if (s.includes(k)) {
        const next = s.filter((x) => x !== k)
        if (next.length >= 1) say(`Removed ${label(k)}. Now ${next.map(label).join(' + ')}`)
        return next
      }
      if (k !== 'halftone') {
        const d = effectDef(k).defaults
        const keep = k === 'riso4' ? ['paper'] : ['ink', 'ink2', 'ink3', 'ink4', 'paper']
        setTex((t) => ({ ...t, ...Object.fromEntries(Object.entries(d).filter(([key]) => !keep.includes(key))) }))
      }
      const next = [...s, k]
      if (next.length === 2) say(`Stacking 2 effects: ${next.map(label).join(' then ')}. Tap a selected chip to remove it.`)
      else if (next.length > 2) say(`${next.length} effects stacked: ${next.map(label).join(' → ')}`)
      return next
    })
  }

  // Free on-device cutout (WASM model, runs in the browser — no credits). Default route.
  const removeBgLocal = useCallback(async () => {
    if (!originalFull) return
    setBusy('Removing background on-device…')
    setError(null)
    try {
      const { removeBackground } = await import('@imgly/background-removal')
      const src = toCanvas(originalFull, 2400)
      const input: Blob = await new Promise((r, j) => src.toBlob((b) => (b ? r(b) : j(new Error('encode failed'))), 'image/png'))
      const out = await removeBackground(input, {
        output: { format: 'image/png', quality: 1 },
        progress: (key: string, cur: number, total: number) => {
          if (key.startsWith('fetch:')) setBusy(`Preparing cutout model… ${total ? Math.round((cur / total) * 100) : 0}%`)
          else setBusy('Removing background on-device…')
        },
      })
      const url = URL.createObjectURL(out)
      try {
        adopt(toCanvas(await loadImg(url), SOURCE_MAX))
      } finally {
        URL.revokeObjectURL(url)
      }
      setCutoutApplied(true)
      setParams((p) => ({ ...p, paper: 'transparent' }))
      setTex((t) => ({ ...t, paper: 'transparent' }))
    } catch (e) {
      const msg = (e as Error).message
      if (/MIME type|dynamically imported|Importing a module/i.test(msg)) {
        setError('The app updated in the background. Reload the page to enable the cutout tool.')
      } else {
        setError('On-device cutout failed (' + msg + '). Try the precise cutout.')
      }
    } finally {
      setBusy(null)
    }
  }, [originalFull, adopt])

  // Precise cutout (server-side service, uses studio credits) — for images the free route struggles with.
  // A precise cutout costs a credit, so it is filed on the Cutouts board straight away: reopening
  // it from there gives you the transparent version again without paying for it twice.
  const bankCutout = useCallback(
    async (cut: HTMLCanvasElement) => {
      try {
        const c = toCanvas(cut, 2000)
        let blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'))
        if (!blob) return
        let url: string
        if (user) {
          let shrunk = c
          while (blob && blob.size > 4_200_000 && shrunk.width > 700) {
            shrunk = toCanvas(shrunk, Math.round(shrunk.width * 0.8))
            blob = await new Promise((r) => shrunk.toBlob(r, 'image/png'))
          }
          if (!blob) return
          url = await uploadEdit(blob, 'image/png')
        } else {
          url = toCanvas(cut, 1200).toDataURL('image/png')
        }
        const cutItem: Item = {
          ...item,
          id: `cutouts:${Date.now()}`,
          source: 'edits',
          sourceName: 'My cutouts',
          title: `${item.title} · cutout`,
          creator: `Cut out from ${item.sourceName}`,
          dateDisplay: new Date().toLocaleDateString(),
          objectType: 'Cutout',
          medium: 'precise cutout',
          rightsLabel: `Derived from: ${item.title} (${item.sourceName})`,
          thumbnailUrl: url,
          imageUrl: url,
          originalImageUrl: url,
          width: null,
          height: null,
          files: [],
        }
        const board = boardStore.create('Cutouts', CUTOUTS_ID)
        boardStore.addItems(board.id, [cutItem])
        say('Cutout saved to your Cutouts board, ready to reopen any time.')
      } catch {
        /* the cutout itself still worked; filing it is best effort */
      }
    },
    [item, user, say],
  )

  const removeBgPrecise = useCallback(async () => {
    if (!originalFull) return
    setBusy('Removing background (precise)…')
    setError(null)
    try {
      // send the pixels we already have — provider hosts often block third-party fetches of the URL
      const dataUrl = toCanvas(originalFull, 2200).toDataURL('image/jpeg', 0.92)
      const res = await fetch('/api/removebg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: dataUrl }) })
      if (!res.ok) {
        let msg = `Background removal failed (${res.status})`
        try {
          msg = (await res.json())?.error || msg
        } catch { /* ignore */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      let cut: HTMLCanvasElement
      try {
        cut = toCanvas(await loadImg(url), SOURCE_MAX)
        adopt(cut)
      } finally {
        URL.revokeObjectURL(url)
      }
      setCutoutApplied(true)
      // banked so this credit never has to be spent on the same image twice
      void bankCutout(cut)
      setParams((p) => ({ ...p, paper: 'transparent' }))
      setTex((t) => ({ ...t, paper: 'transparent' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [originalFull, adopt])

  const restoreOriginal = useCallback(() => {
    if (!originalFull) return
    adopt(originalFull)
    setCutoutApplied(false)
    setParams((p) => ({ ...p, paper: HT_DEFAULTS.paper }))
    setTex((t) => ({ ...t, paper: TEXTURE_DEFAULTS.paper }))
  }, [originalFull, adopt])

  const vectorize = useCallback(async () => {
    if (!full) return
    setBusy('Vectorizing… (can take ~30s)')
    setError(null)
    try {
      const body = !cutoutApplied ? JSON.stringify({ id: item.id }) : JSON.stringify({ image: toCanvas(full, 1024).toDataURL('image/png') })
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

  const stackName = stack.length ? stack.join('-') : vector ? 'vector' : cutoutApplied ? 'cutout' : 'edit'
  const baseName = useMemo(() => `${item.source}-${item.id.split(':').pop()}-${stackName}`.replace(/[^a-zA-Z0-9._-]+/g, '-'), [item, stackName])

  const exportOptions = useMemo(() => {
    if (!full) return []
    const opts: { scale: number; label: string }[] = []
    for (const s of [1, 1.5, 2]) {
      const w = Math.round(full.width * s)
      const h = Math.round(full.height * s)
      if (w * h > EXPORT_MAX_PIXELS) break
      opts.push({ scale: s, label: `${w} × ${h} px${s === 1 ? '' : ` (${s}×)`}` })
    }
    return opts
  }, [full])

  // Transparency decides the format: PNG only when we need the alpha, JPEG otherwise. A
  // photographic PNG runs to tens of megabytes, which makes phone saves slow and unreliable.
  const isTransparent =
    (isSheetValue(paperTex)
      ? isContainedBackground(paperTex)
      : (stack.includes('halftone') && stack.length === 1 ? params.paper : tex.paper) === 'transparent') ||
    (!stack.length && cutoutApplied)

  const renderExport = useCallback((): Promise<Blob | null> => {
    if (!full) return Promise.resolve(null)
    return new Promise((resolve) => {
      const target = buildOutput(full, exportScale)
      if (isTransparent) target.toBlob((b) => resolve(b), 'image/png')
      else target.toBlob((b) => resolve(b), 'image/jpeg', 0.94)
    })
  }, [full, exportScale, buildOutput, isTransparent])

  const exportPng = useCallback(() => {
    setBusy('Rendering PNG…')
    setTimeout(async () => {
      try {
        const blob = await renderExport()
        if (!blob) throw new Error('render failed')
        await saveImage(blob, `${baseName}.${blob.type === 'image/png' ? 'png' : 'jpg'}`)
      } catch (e) {
        setError('Export failed (' + (e as Error).message + '). Try a smaller size.')
      } finally {
        setBusy(null)
      }
    }, 30)
  }, [renderExport, baseName, item.title])

  const shareEdit = useCallback(() => {
    setBusy('Preparing image…')
    setTimeout(async () => {
      try {
        const blob = vector ? new Blob([vector.svg], { type: 'image/svg+xml' }) : await renderExport()
        if (!blob) throw new Error('render failed')
        const file = new File([vector ? blob : blob], `${baseName}.${vector ? 'svg' : 'png'}`, { type: blob.type })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: item.title }).catch(() => {})
        } else {
          saveBlob(blob, file.name)
        }
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(null)
      }
    }, 30)
  }, [renderExport, baseName, vector, item.title])

  const saveEdit = useCallback(() => {
    setBusy('Saving edit…')
    setTimeout(async () => {
      try {
        let url: string
        if (user) {
          // the request body must stay under the platform's 4.5 MB cap — encode a bounded rendition
          // (full-resolution output is always available via Download)
          const transparent = isTransparent
          const mime = transparent ? 'image/png' : 'image/jpeg'
          // render the effect stack ONCE, then only downscale the finished pixels to fit the
          // upload cap — re-running heavy effects per rendition froze phones
          let c = buildOutput(toCanvas(full!, 1600), 1)
          let blob: Blob | null = await new Promise((r) => c.toBlob(r, mime, 0.88))
          while (blob && blob.size > 4_200_000 && c.width > 700) {
            const s2 = document.createElement('canvas')
            s2.width = Math.round(c.width * 0.8)
            s2.height = Math.round(c.height * 0.8)
            s2.getContext('2d')!.drawImage(c, 0, 0, s2.width, s2.height)
            c = s2
            blob = await new Promise((r) => c.toBlob(r, mime, 0.85))
          }
          if (!blob) throw new Error('render failed')
          url = await uploadEdit(blob, mime)
        } else {
          // local-only: store a compact data URL in the browser
          const smallSrc = full ? buildOutput(toCanvas(full, 1200), 1) : null
          if (!smallSrc) throw new Error('render failed')
          url = smallSrc.toDataURL('image/jpeg', 0.85)
        }
        const label = vector ? 'vector' : stack.length ? stack.map((k) => (k === 'halftone' ? 'halftone' : effectDef(k).label.toLowerCase())).join(' + ') : 'edit'
        const editItem: Item = {
          id: `edits:${Date.now()}`,
          source: 'edits',
          sourceName: 'My edits',
          sourceUrl: item.sourceUrl, // link back to the original record
          title: `${item.title} · ${label}`,
          creator: `Edited from ${item.sourceName}`,
          dateDisplay: new Date().toLocaleDateString(),
          yearStart: null,
          yearEnd: null,
          objectType: 'Edit',
          medium: label,
          culture: null,
          place: null,
          publicDomain: item.publicDomain,
          rightsLabel: `Derived from: ${item.title} (${item.sourceName})`,
          licenseUrl: item.licenseUrl,
          thumbnailUrl: url,
          imageUrl: url,
          originalImageUrl: url,
          width: null,
          height: null,
          contentType: 'image',
          files: [],
        }
        const board = boardStore.create('Edits', EDITS_ID)
        boardStore.addItems(board.id, [editItem])
        say(user ? 'Saved to your Edits board' : 'Saved to Edits (this browser). Sign in to sync.')
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(null)
      }
    }, 30)
  }, [user, renderExport, buildOutput, full, stack, vector, item, say, cutoutApplied, paperTex, params.paper, tex.paper])

  const exportSvg = useCallback(() => {
    if (!full || !(stack.length === 1 && stack[0] === 'halftone')) return
    setBusy('Building SVG…')
    setTimeout(() => {
      try {
        const screen = computeScreen(full, params, preview!.width)
        // one vector shape per dot: a very fine screen would build a file too large to open
        if (screen.dots.length > 260_000) {
          setError(`That screen is too fine for a vector file (${(screen.dots.length / 1000) | 0}k dots). Raise the dot size for SVG, or save it as a PNG instead.`)
          return
        }
        const svg = screenToSvg(screen, params)
        saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}.svg`)
      } catch (e) {
        setError('SVG export failed (' + (e as Error).message + ')')
      } finally {
        setBusy(null)
      }
    }, 30)
  }, [full, preview, params, stack, baseName])

  // ---- zoom & pan ----
  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => Math.max(1, Math.min(8, z * (e.deltaY < 0 ? 1.12 : 0.9))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 })
  }, [zoom])
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchBase.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }
      panBase.current = null
    } else if (pointers.current.size === 1 && zoom > 1) {
      panBase.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinchBase.current) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      setZoom(Math.max(1, Math.min(8, (pinchBase.current.zoom * d) / pinchBase.current.dist)))
    } else if (pointers.current.size === 1 && panBase.current) {
      setPan({ x: panBase.current.x + (e.clientX - panBase.current.px), y: panBase.current.y + (e.clientY - panBase.current.py) })
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchBase.current = null
    if (pointers.current.size === 0) panBase.current = null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // union of controls across the stack (excluding halftone, which has its own block)
  const stackDefs = stack.filter((k) => k !== 'halftone').map((k) => effectDef(k))
  const controls = stackDefs.flatMap((d) => d.controls).filter((c, i, arr) => arr.findIndex((x) => x.k === c.k) === i)
  const colorSlots = [...new Set(stackDefs.flatMap((d) => d.colors))]
  const showInvert = stackDefs.some((d) => d.invert)
  const showColorize = stackDefs.some((d) => d.colorize)
  const htActive = stack.includes('halftone')
  const svgOk = stack.length === 1 && stack[0] === 'halftone' && !vector
  const activePaper = htActive && stack.length === 1 ? params.paper : tex.paper
  const checker = useMemo(() => ({ backgroundImage: 'repeating-conic-gradient(#e3e0d9 0% 25%, #efece6 0% 50%)', backgroundSize: '16px 16px' }), [])
  const set = <K extends keyof HalftoneParams>(k: K, v: HalftoneParams[K]) => setParams((p) => ({ ...p, [k]: v }))

  return (
    <div className="viewer editor" role="dialog" aria-modal="true">
      <div className="vtop">
        <button className="btn" onClick={onClose}>← Back</button>
        <strong style={{ fontSize: 13 }}>Edit</strong>
        <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
        <span style={{ flex: 1 }} />
        {zoom > 1 && <button className="btn small" onClick={resetView}>{Math.round(zoom * 100)}% ↺</button>}
        <button className="btn primary" onClick={vector ? shareEdit : exportPng} disabled={!full || !!busy}>{isTouch() ? 'Save' : 'Download'}</button>
      </div>
      <div className="vbody">
        <div
          className="stage"
          ref={stageRef}
          style={{ ...(activePaper === 'transparent' || (vector && cutoutApplied) ? checker : {}), touchAction: 'none', overflow: 'hidden' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={resetView}
        >
          {busy && <div className="busy-pill" style={{ position: 'absolute', zIndex: 2 }}>{busy}</div>}
          {error && !busy && !full && <div className="ph" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
            {vector && <img src={vector.url} alt="Vectorized" style={{ maxWidth: '100%', maxHeight: '100%', opacity: busy ? 0.4 : 1 }} />}
            <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', display: full && !vector ? 'block' : 'none', opacity: busy ? 0.4 : 1 }} />
          </div>
        </div>
        <div className="info">
          {error && full && <p style={{ color: 'var(--danger)', marginTop: 0, fontSize: 13 }}>{error}</p>}
          <h3 className="sec-image-h" style={{ marginTop: 0 }}>Image</h3>
          <div className="actions sec-image">
            <button className="btn" onClick={removeBgLocal} disabled={!!busy || cutoutApplied || !full}>{cutoutApplied ? 'Background removed ✓' : 'Remove background'}</button>
            <button className="btn" onClick={removeBgPrecise} disabled={!!busy || !full} title="Higher-fidelity cutout for tricky edges. Uses studio credits, so try the standard one first.">
              Precise cutout
            </button>
            <button className="btn" disabled={!!busy || !full} onClick={() => setCropping(true)} title="Take a detail out of the image and work on that">
              Crop
            </button>
            <button className="btn" disabled={!!busy || !full} onClick={() => setRefining(true)} title="Paint away parts of the image, or paint the original back">
              Erase / restore
            </button>
            {cutoutApplied && <button className="btn" onClick={restoreOriginal}>Restore original</button>}
          </div>
          <p className="faint hide-mobile" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {full ? `Source ${full.width} × ${full.height}px. ` : ''}Standard cutout runs free on your device; Precise re-cuts the original with a higher-fidelity service (rate-limited). Scroll or pinch to zoom.
          </p>

          <h3 className="sec-vector-h">Vectorize</h3>
          <div className="sec-vector">
            {!vector ? (
              <>
                <button className="btn" onClick={vectorize} disabled={!full || !!busy}>Vectorize</button>
                <p className="faint hide-mobile" style={{ fontSize: 12, margin: '6px 0 0' }}>Redraws the {cutoutApplied ? 'cutout' : 'image'} as clean, editable vector shapes (rate-limited).</p>
              </>
            ) : (
              <>
                <div className="actions">
                  <button className="btn primary" onClick={() => saveBlob(new Blob([vector.svg], { type: 'image/svg+xml' }), `${baseName}-vector.svg`)}>Download SVG</button>
                  <button className="btn" onClick={() => { URL.revokeObjectURL(vector.url); setVector(null) }}>Back to bitmap</button>
                </div>
                <p className="faint hide-mobile" style={{ fontSize: 12, margin: '6px 0 0' }}>{vector.sandbox ? 'Preview-mode result. Full-quality vectorization is not enabled yet.' : 'Editable vector shapes that scale to any size.'}</p>
              </>
            )}
          </div>

          <h3 style={{ opacity: vector ? 0.45 : 1 }}>Texture{stack.length > 1 ? ` · ${stack.length} stacked` : ''}</h3>
          <div className="chips" style={{ marginBottom: 10 }}>
            <button type="button" className={'btn small mobile-only' + (cutoutApplied ? ' active' : '')} disabled={!!busy || !full} onClick={() => (cutoutApplied ? restoreOriginal() : void removeBgLocal())}>
              {cutoutApplied ? 'Cutout ✓' : 'Cutout'}
            </button>
            <button type="button" className="btn small mobile-only" disabled={!!busy || !full} onClick={() => void removeBgPrecise()} title="Higher-fidelity cutout. Uses studio credits.">
              Precise cutout
            </button>
            <button type="button" className="btn small mobile-only" disabled={!!busy || !full} onClick={() => setCropping(true)}>
              Crop
            </button>
            <button type="button" className="btn small mobile-only" disabled={!!busy || !full} onClick={() => setRefining(true)}>
              Erase
            </button>
            <button type="button" className={'btn small mobile-only' + (vector ? ' active' : '')} disabled={!!busy || !full} onClick={() => { if (vector) { URL.revokeObjectURL(vector.url); setVector(null) } else void vectorize() }}>
              Vectorize
            </button>
            <span className="chip-div mobile-only" />
            <button type="button" className={'btn small' + (stack.length === 0 ? ' active' : '')} onClick={() => toggleEffect('none')}>None</button>
            {EFFECTS.map((e) => (
              <button key={e.key} type="button" className={'btn small' + (stack.includes(e.key) ? ' active' : '')} onClick={() => toggleEffect(e.key)} title={stack.includes(e.key) ? 'Tap to remove' : 'Tap to add (effects stack in order)'}>
                {e.key === 'halftone' ? 'Halftone' : e.label}
                {stack.length > 1 && stack.includes(e.key) ? ` ${stack.indexOf(e.key) + 1}` : ''}
              </button>
            ))}
          </div>

          {stack.length > 1 && (
            <p className="stackline">
              Stacked in order: <b>{stack.map((k) => (k === 'halftone' ? 'Halftone' : effectDef(k).label)).join(' → ')}</b>. Tap a highlighted chip to remove it.
            </p>
          )}
          {controls.length > 0 && (
            <div className="controls-wrap">
              {controls.map((c) => (
                <div className="ctl" key={c.k}>
                  <span className="label">{c.label} · {typeof tex[c.k] === 'number' ? (c.step < 1 ? (tex[c.k] as number).toFixed(2) : tex[c.k]) : ''}</span>
                  <input type="range" min={c.min} max={c.max} step={c.step} value={tex[c.k] as number} onChange={(e) => setTex((t) => ({ ...t, [c.k]: Number(e.target.value) }))} />
                </div>
              ))}
            </div>
          )}
          {(colorSlots.length > 0 || stack.length > 0) && (
            <div className="ctl row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
              {colorSlots.includes('ink') && (
                <div>
                  <span className="label">Ink</span>
                  <input type="color" value={tex.ink} onChange={(e) => setTex((t) => ({ ...t, ink: e.target.value }))} />
                </div>
              )}
              {colorSlots.includes('ink2') && (
                <div>
                  <span className="label">Ink 2</span>
                  <input type="color" value={tex.ink2} onChange={(e) => setTex((t) => ({ ...t, ink2: e.target.value }))} />
                </div>
              )}
              {colorSlots.includes('ink3') && (
                <div>
                  <span className="label">Ink 3</span>
                  <input type="color" value={tex.ink3} onChange={(e) => setTex((t) => ({ ...t, ink3: e.target.value }))} />
                </div>
              )}
              {colorSlots.includes('ink4') && (
                <div>
                  <span className="label">Ink 4</span>
                  <input type="color" value={tex.ink4} onChange={(e) => setTex((t) => ({ ...t, ink4: e.target.value }))} />
                </div>
              )}
              {stack.includes('riso4') && (
                <div>
                  <span className="label">Ink presets</span>
                  <div className="row" style={{ gap: 4 }}>
                    {INK_PRESETS.map((pr) => (
                      <button key={pr.name} type="button" className="btn small" onClick={() => setTex((t) => ({ ...t, ink: pr.inks[0], ink2: pr.inks[1], ink3: pr.inks[2], ink4: pr.inks[3] }))}>
                        {pr.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {stack.length > 0 && (
                <>
                  <div className="ctl row">
                    <span className="label">Background</span>
                    <div className="row" style={{ gap: 6 }}>
                      <select
                        className="input"
                        style={{ width: 'auto', flex: '1 1 auto', minWidth: 0 }}
                        value={paperTex.startsWith('img:') ? paperTex : activePaper === 'transparent' ? 'transparent' : paperTex}
                        onChange={(e) => {
                          const v = e.target.value
                          setSheetRotate(0)
                          if (v === 'transparent') {
                            setPaperTex('none')
                            setTex((t) => ({ ...t, paper: 'transparent' }))
                            setParams((p) => ({ ...p, paper: 'transparent' }))
                            return
                          }
                          setPaperTex(v)
                          if (!v.startsWith('img:') && activePaper === 'transparent') {
                            setTex((t) => ({ ...t, paper: TEXTURE_DEFAULTS.paper }))
                            setParams((p) => ({ ...p, paper: HT_DEFAULTS.paper }))
                          }
                        }}
                      >
                        <option value="none">Colour…</option>
                        <option value="transparent">Transparent</option>
                        <optgroup label="Colour with a finish">
                          {PAPER_TEXTURES.filter((t) => t.key !== 'none').map((t) => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Papers">
                          {PAPER_SHEETS.filter((t) => t.group === 'paper').map((t) => (
                            <option key={t.slug} value={'img:' + t.slug}>{t.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Deckle and torn edges">
                          {PAPER_SHEETS.filter((t) => t.group === 'edge').map((t) => (
                            <option key={t.slug} value={'img:' + t.slug}>{t.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Fabric">
                          {PAPER_SHEETS.filter((t) => t.group === 'fabric').map((t) => (
                            <option key={t.slug} value={'img:' + t.slug}>{t.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Wood and other surfaces">
                          {PAPER_SHEETS.filter((t) => t.group === 'material').map((t) => (
                            <option key={t.slug} value={'img:' + t.slug}>{t.label}</option>
                          ))}
                        </optgroup>
                      </select>
                      {!paperTex.startsWith('img:') && activePaper !== 'transparent' && (
                        <input
                          type="color"
                          aria-label="Background colour"
                          value={activePaper}
                          onChange={(e) => {
                            setTex((t) => ({ ...t, paper: e.target.value }))
                            setParams((p) => ({ ...p, paper: e.target.value }))
                          }}
                        />
                      )}
                      {paperTex.startsWith('img:') && (
                        <button className="btn" onClick={() => setSheetRotate((r) => (r + 90) % 360)} title="Turn the sheet 90 degrees">
                          Rotate
                        </button>
                      )}
                    </div>
                  </div>
                  {paperTex.startsWith('img:') && (
                    <div>
                      <span className="label">Sheet mode</span>
                      <div className="seg">
                        <button type="button" className={sheetMode === 'ink' ? 'active' : ''} onClick={() => setSheetMode('ink')} title="Artwork multiplies into the paper like ink on stock">overlay</button>
                        <button type="button" className={sheetMode === 'behind' ? 'active' : ''} onClick={() => setSheetMode('behind')} title="Paper sits behind the artwork as a background">background</button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {showInvert && (
                <label className="check">
                  <input type="checkbox" checked={tex.invert} onChange={(e) => setTex((t) => ({ ...t, invert: e.target.checked }))} /> Invert
                </label>
              )}
              {showColorize && (
                <label className="check">
                  <input type="checkbox" checked={tex.colorize} onChange={(e) => setTex((t) => ({ ...t, colorize: e.target.checked }))} /> Color from image
                </label>
              )}
            </div>
          )}
          {htActive && (
            <div className="controls-wrap">
              <div className="ctl">
                <span className="label">Dot size · {params.cell % 1 ? params.cell.toFixed(1) : params.cell}px</span>
                <input type="range" min={1.5} max={28} step={0.5} value={params.cell} onChange={(e) => set('cell', Number(e.target.value))} />
              </div>
              <div className="ctl">
                <span className="label">Angle · {params.angle}°</span>
                <input type="range" min={0} max={90} step={1} value={params.angle} onChange={(e) => set('angle', Number(e.target.value))} />
              </div>
              <div className="ctl">
                <span className="label">Dot gain · {params.gain.toFixed(2)}</span>
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
              <div className="ctl">
                <span className="label">Halftone ink</span>
                <input type="color" value={params.ink} onChange={(e) => set('ink', e.target.value)} />
              </div>
              <div className="ctl">
                <span className="label">Halftone invert</span>
                <label className="check" style={{ height: 30 }}>
                  <input type="checkbox" checked={params.invert} onChange={(e) => set('invert', e.target.checked)} /> Invert
                </label>
              </div>
            </div>
          )}

          <h3>Export</h3>
          <div className="ctl">
            <span className="label">Size</span>
            <select className="input" value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))}>
              {exportOptions.map((o) => (
                <option key={o.scale} value={o.scale}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="actions export-actions">
            <button className="btn primary" onClick={exportPng} disabled={!full || !!busy}>{isTouch() ? 'Save image' : 'Download PNG'}</button>
            <button className="btn" onClick={saveEdit} disabled={!full || !!busy} title="Keeps this edit on your Edits board with a link to the original work">Save to Edits</button>
            <button className="btn" onClick={exportSvg} disabled={!full || !!busy || !svgOk} title={svgOk ? 'Resolution-independent halftone for screenprint separations' : 'Vector SVG export is available when Halftone is the only texture'}>
              SVG
            </button>
            {stack.length === 1 && stack[0] === 'ascii' && (
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
                TXT
              </button>
            )}
            {stack.length === 1 && stack[0] === 'cmyk' && (
              <button
                className="btn"
                disabled={!full || !!busy}
                title="One vector SVG per ink: C/M/Y/K separations at classic screen angles"
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
                Plates
              </button>
            )}
            <button className="btn" onClick={() => { setParams(HT_DEFAULTS); setTex({ ...TEXTURE_DEFAULTS }); setStack([]); setPaperTex('none'); setSheet(null); resetView() }}>Reset</button>
          </div>
          <p className="faint hide-mobile" style={{ fontSize: 12, marginTop: 10 }}>
            Tap texture chips to stack effects in order; tap again to remove. “Save to Edits” keeps the edit on a board with a link to the original work.
          </p>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
          {cropping && originalFull && (
        <CropTool
          source={originalFull}
          onApply={(c) => {
            setOriginalFull(c)
            adopt(c)
            setCutoutApplied(false)
            setVector(null)
            setCropping(false)
            say(`Cropped to ${c.width} × ${c.height}px. Effects and cutout now work on this.`)
          }}
          onClose={() => setCropping(false)}
        />
      )}
      {refining && originalFull && full && (
        <MaskTool
          original={originalFull}
          current={full}
          onApply={(c) => {
            adopt(c)
            setCutoutApplied(true)
            setParams((p) => ({ ...p, paper: 'transparent' }))
            setTex((t) => ({ ...t, paper: 'transparent' }))
            setRefining(false)
          }}
          onClose={() => setRefining(false)}
        />
      )}
</div>
  )
}
