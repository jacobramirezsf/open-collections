// Standalone editor: bring your own image instead of finding one in the collections. Every editing
// tool and export works the same; nothing here touches boards, saved edits or the canvas.
import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from './Editor'
import type { Item } from '../../shared/types'

const MAX_EDGE = 6000

function itemFromDataUrl(url: string, name: string): Item {
  return {
    id: `upload:${Date.now()}`,
    source: 'upload',
    sourceName: 'Your upload',
    sourceUrl: '',
    title: name.replace(/\.[^.]+$/, '') || 'Untitled',
    creator: null,
    dateDisplay: null,
    yearStart: null,
    yearEnd: null,
    objectType: 'Upload',
    medium: null,
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
  } as Item
}

export default function UploadEditor({ onClose }: { onClose: () => void }) {
  const [item, setItem] = useState<Item | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const take = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('That is not an image file.')
      return
    }
    setError(null)
    setBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new Image()
      img.onload = () => {
        // very large photos are bounded so the editor stays responsive; exports still go up to 64MP
        const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
        if (k === 1) {
          setItem(itemFromDataUrl(src, file.name))
        } else {
          const c = document.createElement('canvas')
          c.width = Math.round(img.naturalWidth * k)
          c.height = Math.round(img.naturalHeight * k)
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
          setItem(itemFromDataUrl(c.toDataURL('image/png'), file.name))
        }
        setBusy(false)
      }
      img.onerror = () => {
        setError('That image could not be opened.')
        setBusy(false)
      }
      img.src = src
    }
    reader.onerror = () => {
      setError('That file could not be read.')
      setBusy(false)
    }
    reader.readAsDataURL(file)
  }, [])

  // paste straight from the clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files || [])][0]
      if (f) take(f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [take])

  if (item) return <Editor item={item} standalone onClose={() => setItem(null)} />

  return (
    <div className="uploader">
      <div className="uploader-inner">
        <h1 className="intro-title" style={{ marginBottom: 6 }}>Editor</h1>
        <p className="intro-lead" style={{ marginBottom: 22 }}>
          Bring your own image and use the same tools as the rest of the site: cut out the background,
          erase and restore by hand, crop, stack effects, print onto paper or fabric, then export at
          full resolution or as vector. Nothing is uploaded to an account or saved to a board.
        </p>
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
        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        <button className="btn link" style={{ marginTop: 18 }} onClick={onClose}>← Back to the collections</button>
      </div>
    </div>
  )
}
