import { useEffect, useState } from 'react'
import type { Item } from '../../shared/types'
import { downloadUrl, proxyImageUrl } from '../lib/api'
import { downloadItem, triggerDownload } from '../lib/zip'
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
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setFailed(0)
    setBigLoaded(false)
    setSrc(item?.imageUrl || item?.thumbnailUrl || null)
  }, [item?.id])

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
  const imageFiles = item.files.filter((f) => ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'].includes(f.format))
  const modelFiles = item.files.filter((f) => !['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'].includes(f.format))

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
                  downloadItem(item, 'image')
                    .catch((e) => setDlError((e as Error).name === 'AbortError' ? 'Download timed out. The source host is slow, so try again or use the original record.' : (e as Error).message))
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'Downloading…' : 'Download'}
              </button>
            )}
            <button className={'btn' + (isFavorite(item.id) ? ' active' : '')} onClick={() => onFavorite(item)} title="Favorite">
              {isFavorite(item.id) ? '♥ Favorited' : '♡ Favorite'}
            </button>
            <button className="btn" onClick={(e) => onSave(item, e.currentTarget)}>Save to board</button>
            {!is3d && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
            <a className="btn" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Original record ↗</a>
            {!is3d && <button className="btn" onClick={() => onSimilar(item)}>Similar</button>}
          </div>
          {(is3d || imageFiles.length > 1) && (
            <div className="files">
              <span className="label">{is3d ? 'Download formats' : 'Other files'}</span>
              {item.files.map((f, i) => (
                <button key={i} className="btn small" onClick={() => triggerDownload(downloadUrl(item, i))} title={f.filename || f.url}>
                  {f.format.toUpperCase()}
                  {shortLabel(f) ? ` · ${shortLabel(f)}` : ''}
                  {f.size ? ` · ${(f.size / 1e6).toFixed(1)} MB` : ''}
                </button>
              ))}
            </div>
          )}
          <div className="src">
            {item.id} · <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceUrl.replace(/^https?:\/\//, '').slice(0, 60)}</a>
            {item.licenseUrl && (<> · <a href={item.licenseUrl} target="_blank" rel="noopener noreferrer">license</a></>)}
          </div>
        </div>
      </div>
      {editing && <Editor item={item} onClose={() => setEditing(false)} />}
    </div>
  )
}
