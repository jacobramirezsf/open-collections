import { useCallback, useEffect, useState } from 'react'
import type { Item } from '../../shared/types'
import { downloadUrl, isLive, proxyImageUrl } from '../lib/api'
import { downloadItem, saveBlob, zipItems } from '../lib/zip'
import { ModelIcon } from './Grid'
import { useBodyLock } from './Panels'
import Editor from './Editor'

interface Props {
  items: Item[]
  index: number
  onClose: () => void
  onNav: (index: number) => void
  onSave: (item: Item, anchor: HTMLElement) => void
  onSimilar: (item: Item) => void
  isFavorite: (id: string) => boolean
  onFavorite: (item: Item) => void
}

function shortLabel(f: { label?: string; filename?: string }): string {
  const l = (f.label || '').split(' · ')[0].trim()
  if (!l || l === f.filename) return ''
  return l.length > 28 ? l.slice(0, 27) + '…' : l
}

const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp']

// One figure sheet of a live item (a patent) as an item of its own, so the editor, the image proxy
// and the ZIP builder, which all work from an item's image URLs, work on that sheet.
function sheetItem(item: Item, url: string, n: number): Item {
  return { ...item, id: `${item.id}-sheet${n}`, title: `${item.title} · sheet ${n}`, imageUrl: url, originalImageUrl: url, thumbnailUrl: url, files: [] }
}

function rightsClass(item: Item) {
  return item.publicDomain === true ? 'pd' : item.publicDomain === null ? 'unclear' : ''
}

export default function Viewer({ items, index, onClose, onNav, onSave, onSimilar, isFavorite, onFavorite }: Props) {
  useBodyLock()
  const item = items[index]
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(0) // 0 = viewer image, 1 = thumb, 2 = proxy, 3 = give up
  const [bigLoaded, setBigLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dlError, setDlError] = useState<string | null>(null)
  // which alternate file is in flight, and which one failed so it can offer a retry
  const [fileBusy, setFileBusy] = useState<number | null>(null)
  const [fileError, setFileError] = useState<{ index: number; message: string } | null>(null)

  // Alternate files used to be a bare anchor navigation: no progress, and an upstream failure was
  // completely silent. They now take the same route as the main download, which times out, falls
  // back to the source host when the proxy is blocked, and reports what went wrong.
  const getFile = useCallback(async (index: number) => {
    setFileBusy(index)
    setFileError(null)
    try {
      await downloadItem(item, index)
    } catch (e) {
      const err = e as Error
      setFileError({
        index,
        message: err.name === 'AbortError' ? 'That file timed out. The source host may be slow.' : err.message,
      })
    } finally {
      setFileBusy(null)
    }
  }, [item])
  const [editing, setEditing] = useState(false)
  // the figure sheet on the stage, as an index into item.files; null = the item's main image
  const [sheet, setSheet] = useState<number | null>(null)
  const [zipping, setZipping] = useState<string | null>(null)

  useEffect(() => {
    setFailed(0)
    setBigLoaded(false)
    setSheet(null)
    setSrc(item?.imageUrl || item?.thumbnailUrl || null)
  }, [item?.id])

  const showSheet = (i: number | null) => {
    setSheet(i)
    setFailed(0)
    setBigLoaded(false)
    setSrc(i == null ? item.imageUrl || item.thumbnailUrl || null : item.files[i].url)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && index < items.length - 1) onNav(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) onNav(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onNav])

  if (!item) return null
  const onImgError = () => {
    if (sheet != null) {
      // a sheet: straight from the source failed, so try once through our proxy
      if (failed === 0 && isLive(item)) {
        setFailed(2)
        setSrc(proxyImageUrl(sheetItem(item, item.files[sheet].url, 0), 'view'))
      } else {
        setFailed(3)
        setSrc(null)
      }
      return
    }
    if (failed === 0 && item.thumbnailUrl && item.thumbnailUrl !== src) {
      setFailed(1)
      setSrc(item.thumbnailUrl)
    } else if (failed <= 1) {
      setFailed(2)
      setSrc(proxyImageUrl(item, 'view'))
    } else {
      setFailed(3)
      setSrc(null)
    }
  }
  const is3d = item.contentType === '3d'
  const imageFiles = item.files.filter((f) => IMAGE_FORMATS.includes(f.format))
  const modelFiles = item.files.filter((f) => !IMAGE_FORMATS.includes(f.format))
  // every image file (a patent's figure sheets) is shown as a thumbnail that opens on the stage;
  // the other files (PDFs, 3D formats) stay download buttons
  const sheets = is3d ? [] : item.files.map((f, i) => ({ f, i })).filter(({ f }) => IMAGE_FORMATS.includes(f.format))
  const otherFiles = item.files.map((f, i) => ({ f, i })).filter(({ f }) => is3d || !IMAGE_FORMATS.includes(f.format))
  const sheetNo = sheet == null ? 0 : sheets.findIndex((s) => s.i === sheet) + 1
  // what Edit opens: the sheet on the stage for live items (their sheets are plain URLs)
  const editItem = sheet != null && isLive(item) ? sheetItem(item, item.files[sheet].url, sheetNo) : item
  const zipSheets = async () => {
    setZipping(`0/${sheets.length}`)
    setDlError(null)
    try {
      const parts = sheets.map(({ f }, n) => sheetItem(item, f.url, n + 1))
      const blob = await zipItems(parts, (p) => setZipping(`${p.done}/${p.total}`))
      saveBlob(blob, `${item.id.split(':').pop()}-sheets.zip`)
    } catch (e) {
      setDlError((e as Error).message || 'Could not build the ZIP.')
    } finally {
      setZipping(null)
    }
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true">
      <div className="vtop">
        <button className="btn" onClick={onClose}>← Back</button>
        <span className="count">{index + 1} / {items.length}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={index === 0} onClick={() => onNav(index - 1)}>‹</button>
        <button className="btn" disabled={index >= items.length - 1} onClick={() => onNav(index + 1)}>›</button>
      </div>
      <div className="vbody">
        <div className="stage">
          {src ? (
            <>
              {!bigLoaded && item.thumbnailUrl && src !== item.thumbnailUrl && <img className="lowres" src={item.thumbnailUrl} alt="" />}
              <img key={src} src={src} alt={item.title} onError={onImgError} onLoad={() => setBigLoaded(true)} className={bigLoaded ? 'big loaded' : 'big'} />
            </>
          ) : (
            <div className="ph">
              <ModelIcon />
              <div>{is3d ? '3D model · no preview image' : 'Image unavailable'}</div>
            </div>
          )}
          {index > 0 && <button className="nav prev" onClick={() => onNav(index - 1)} aria-label="Previous">‹</button>}
          {index < items.length - 1 && <button className="nav next" onClick={() => onNav(index + 1)} aria-label="Next">›</button>}
        </div>
        <div className="info">
          <h2>{item.title}</h2>
          {item.creator && <div className="creator">{item.creator}</div>}
          <dl>
            {item.dateDisplay && (<><dt>Date</dt><dd>{item.dateDisplay}</dd></>)}
            <dt>Source</dt><dd>{item.sourceName}</dd>
            {item.objectType && (<><dt>Type</dt><dd>{item.objectType}</dd></>)}
            {item.medium && (<><dt>Medium</dt><dd>{item.medium}</dd></>)}
            {item.culture && (<><dt>Culture</dt><dd>{item.culture}</dd></>)}
            {item.place && (<><dt>Place</dt><dd>{item.place}</dd></>)}
            {is3d && modelFiles.length > 0 && (<><dt>Formats</dt><dd>{[...new Set(modelFiles.map((f) => f.format.toUpperCase()))].join(', ')}</dd></>)}
          </dl>
          <div>
            <span className={'rights ' + rightsClass(item)} title={item.licenseUrl || undefined}>{item.rightsLabel}</span>
          </div>
          {dlError && <p style={{ color: 'var(--danger)', fontSize: 12, margin: '8px 0 0' }}>{dlError}</p>}
          <div className="actions">
            {!is3d && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  setDlError(null)
                  downloadItem(item, sheet ?? 'image')
                    .catch((e) => setDlError((e as Error).name === 'AbortError' ? 'Download timed out. The source host is slow, so try again or use the original record.' : (e as Error).message))
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'Downloading…' : sheet != null ? `Download sheet ${sheetNo}` : 'Download'}
              </button>
            )}
            <button className={'btn' + (isFavorite(item.id) ? ' active' : '')} onClick={() => onFavorite(item)} title="Favorite">
              {isFavorite(item.id) ? '♥ Favorited' : '♡ Favorite'}
            </button>
            <button className="btn" onClick={(e) => onSave(item, e.currentTarget)}>Save to board</button>
            {!is3d && <button className="btn" onClick={() => setEditing(true)}>{sheet != null && isLive(item) ? `Edit sheet ${sheetNo}` : 'Edit'}</button>}
            <a className="btn" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Original record ↗</a>
            {!is3d && <button className="btn" onClick={() => onSimilar(item)}>Similar</button>}
          </div>
          {sheets.length > 1 && (
            <div className="figs">
              <div className="figs-head">
                <span className="label">{item.source === 'patents' ? 'Figure sheets' : 'Images'} · {sheets.length}</span>
                {isLive(item) && (
                  <button className="btn small" disabled={!!zipping} onClick={() => void zipSheets()} title="Every sheet in one ZIP">
                    {zipping ? `Zipping ${zipping}…` : 'Download all (ZIP)'}
                  </button>
                )}
              </div>
              <div className="figs-grid">
                {sheets.map(({ f, i }, n) => {
                  const on = sheet === i || (sheet == null && f.url === item.imageUrl)
                  return (
                    <button key={i} type="button" className={'fig' + (on ? ' on' : '')} onClick={() => showSheet(f.url === item.imageUrl ? null : i)} title={f.label || `Sheet ${n + 1}`}>
                      <img src={f.url} alt={`Sheet ${n + 1}`} loading="lazy" decoding="async" />
                      <span>{n + 1}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {otherFiles.length > 0 && (is3d || imageFiles.length > 0) && (
            <div className="files">
              <span className="label">{is3d ? 'Download formats' : 'Other files'}</span>
              {otherFiles.map(({ f, i }) => (
                <button
                  key={i}
                  className={'btn small' + (fileError?.index === i ? ' danger' : '')}
                  disabled={fileBusy !== null}
                  onClick={() => void getFile(i)}
                  title={f.filename || f.url}
                >
                  {fileBusy === i ? 'Downloading…' : fileError?.index === i ? 'Retry' : (
                    <>
                      {f.format.toUpperCase()}
                      {shortLabel(f) ? ` · ${shortLabel(f)}` : ''}
                      {f.size ? ` · ${(f.size / 1e6).toFixed(1)} MB` : ''}
                    </>
                  )}
                </button>
              ))}
              {fileError && (
                <p style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0', flexBasis: '100%' }}>
                  {fileError.message} Tap the highlighted file to try again, or open the original record.
                </p>
              )}
            </div>
          )}
          <div className="src">
            {item.id} · <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceUrl.replace(/^https?:\/\//, '').slice(0, 60)}</a>
            {item.licenseUrl && (<> · <a href={item.licenseUrl} target="_blank" rel="noopener noreferrer">license</a></>)}
          </div>
        </div>
      </div>
      {editing && <Editor item={editItem} onClose={() => setEditing(false)} />}
    </div>
  )
}
