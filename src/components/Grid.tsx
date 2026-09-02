import { useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react'
import type { Item } from '../../shared/types'
import { proxyImageUrl } from '../lib/api'

interface Props {
  items: Item[]
  dense: boolean
  selectMode: boolean
  selected: Set<string>
  favorites: Set<string>
  onFavorite: (item: Item) => void
  onOpen: (item: Item, index: number) => void
  onToggle: (item: Item, index: number, shift: boolean) => void
  onBroken: (id: string) => void
  onMarquee?: (ids: string[], additive: boolean) => void
}

export function ModelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 3 7v10l9 4.5 9-4.5V7l-9-4.5Z" />
      <path d="M3 7l9 4.5L21 7M12 11.5V21.5" />
    </svg>
  )
}

function useColumnCount(ref: React.RefObject<HTMLDivElement | null>, dense: boolean) {
  const [cols, setCols] = useState(4)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      const target = dense ? (w < 600 ? 110 : 150) : w < 600 ? 170 : 240
      setCols(Math.max(2, Math.min(12, Math.floor(w / target))))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, dense])
  return cols
}

const Card = memo(function Card({ item, index, selected, fav, selectMode, onOpen, onToggle, onBroken, onFavorite }: {
  item: Item
  index: number
  selected: boolean
  fav: boolean
  selectMode: boolean
  onOpen: Props['onOpen']
  onToggle: Props['onToggle']
  onBroken: Props['onBroken']
  onFavorite: Props['onFavorite']
}) {
  const [loaded, setLoaded] = useState(false)
  // Museum CDNs occasionally throttle or return non-image responses; retry once through our proxy before giving up.
  const [src, setSrc] = useState(item.thumbnailUrl)
  const [attempt, setAttempt] = useState(0)
  const fail = () => {
    if (attempt === 0 && item.thumbnailUrl) {
      setAttempt(1)
      setSrc(proxyImageUrl(item, 'thumb'))
    } else onBroken(item.id)
  }
  const ratio = item.width && item.height ? item.width / item.height : null
  const isModel = item.contentType === '3d'
  return (
    <div
      className={'card' + (selected ? ' selected' : '')}
      data-id={item.id}
      onClick={(e) => {
        if (selectMode || e.metaKey || e.ctrlKey) onToggle(item, index, e.shiftKey)
        else onOpen(item, index)
      }}
      title={item.title}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={loaded ? 'loaded' : ''}
          ref={(el) => {
            // cached images can be complete before React attaches onLoad
            if (el && !loaded && el.complete && el.naturalWidth > 8) setLoaded(true)
          }}
          style={ratio && !loaded ? { aspectRatio: String(ratio) } : undefined}
          onLoad={(e) => {
            const img = e.currentTarget
            if (img.naturalWidth < 8 || img.naturalHeight < 8) fail()
            else setLoaded(true)
          }}
          onError={fail}
        />
      ) : (
        <div className="ph">
          <ModelIcon />
          <span>{isModel ? '3D model' : 'No image'}</span>
        </div>
      )}
      {isModel && <span className="tag">3D</span>}
      <span
        className="tick"
        onClick={(e) => {
          e.stopPropagation()
          onToggle(item, index, e.shiftKey)
        }}
      />
      <button
        className={'heart' + (fav ? ' on' : '')}
        title={fav ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(e) => {
          e.stopPropagation()
          onFavorite(item)
        }}
      >
        {fav ? '♥' : '♡'}
      </button>
      <div className="cap">
        <b>{item.title}</b>
        {item.sourceName}
        {item.dateDisplay ? ` · ${item.dateDisplay}` : ''}
      </div>
    </div>
  )
})

export default function Grid({ items, dense, selectMode, selected, favorites, onFavorite, onOpen, onToggle, onBroken, onMarquee }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cols = useColumnCount(ref, dense)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const drag = useRef<{ x0: number; y0: number; additive: boolean; moved: boolean } | null>(null)

  // Distribute into columns by estimated height (shortest column first). Unknown ratios assume ~1.
  const columns = useMemo(() => {
    const heights = new Array(cols).fill(0)
    const out: { item: Item; index: number }[][] = Array.from({ length: cols }, () => [])
    items.forEach((item, index) => {
      const r = item.width && item.height ? item.width / item.height : 1
      let c = 0
      for (let i = 1; i < cols; i++) if (heights[i] < heights[c]) c = i
      out[c].push({ item, index })
      heights[c] += 1 / Math.max(0.3, Math.min(3, r)) + 0.05
    })
    return out
  }, [items, cols])

  // Drag-to-select marquee (desktop, select mode, pointer starts on grid background or a card).
  useEffect(() => {
    const el = ref.current
    if (!el || !onMarquee) return
    const onDown = (e: PointerEvent) => {
      if (!selectMode || e.button !== 0 || e.pointerType === 'touch') return
      const rect = el.getBoundingClientRect()
      drag.current = { x0: e.clientX - rect.left, y0: e.clientY - rect.top + el.scrollTop, additive: e.shiftKey || e.metaKey, moved: false }
    }
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return
      const rect = el.getBoundingClientRect()
      const x1 = e.clientX - rect.left
      const y1 = e.clientY - rect.top
      const { x0, y0 } = drag.current
      if (!drag.current.moved && Math.hypot(x1 - x0, y1 - y0) < 6) return
      drag.current.moved = true
      e.preventDefault()
      setMarquee({ x0, y0, x1, y1 })
    }
    const onUp = () => {
      if (!drag.current) return
      const d = drag.current
      drag.current = null
      setMarquee((m) => {
        if (m && d.moved) {
          const rect = el.getBoundingClientRect()
          const left = Math.min(m.x0, m.x1) + rect.left
          const right = Math.max(m.x0, m.x1) + rect.left
          const top = Math.min(m.y0, m.y1) + rect.top
          const bottom = Math.max(m.y0, m.y1) + rect.top
          const ids: string[] = []
          el.querySelectorAll<HTMLElement>('.card').forEach((c) => {
            const r = c.getBoundingClientRect()
            if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) ids.push(c.dataset.id!)
          })
          // defer so the click event from this drag doesn't toggle a card
          setTimeout(() => onMarquee(ids, d.additive), 0)
          suppressClick.current = true
          setTimeout(() => (suppressClick.current = false), 50)
        }
        return null
      })
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [selectMode, onMarquee])
  const suppressClick = useRef(false)

  return (
    <div ref={ref} className={'gridwrap' + (dense ? ' dense' : '') + (selectMode ? ' selecting' : '')} onClickCapture={(e) => suppressClick.current && e.stopPropagation()}>
      <div className="masonry">
        {columns.map((col, ci) => (
          <div className="column" key={ci}>
            {col.map(({ item, index }) => (
              <Card key={item.id} item={item} index={index} selected={selected.has(item.id)} fav={favorites.has(item.id)} selectMode={selectMode} onOpen={onOpen} onToggle={onToggle} onBroken={onBroken} onFavorite={onFavorite} />
            ))}
          </div>
        ))}
      </div>
      {marquee && (
        <div
          className="marquee"
          style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
        />
      )}
    </div>
  )
}
