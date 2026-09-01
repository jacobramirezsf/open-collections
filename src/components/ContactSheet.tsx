import { useEffect } from 'react'
import type { Item } from '../../shared/types'

export default function ContactSheet({ items, title, onClose }: { items: Item[]; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet">
      <div className="stop">
        <h1>Open Collections</h1>
        <span>{title} · {items.length} items · {new Date().toLocaleDateString()}</span>
        <div className="noprint">
          <button className="btn" onClick={onClose}>← Back</button>
          <button className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </div>
      <div className="cells">
        {items.map((it) => (
          <div className="cell" key={it.id}>
            <div className="im">{it.thumbnailUrl ? <img src={it.thumbnailUrl} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <span className="faint">3D</span>}</div>
            <div className="t">
              <b>{it.title}</b>
              <span>{[it.creator, it.dateDisplay].filter(Boolean).join(' · ')}</span>
              <span>{it.sourceName}{it.publicDomain ? ` · ${it.rightsLabel}` : ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
