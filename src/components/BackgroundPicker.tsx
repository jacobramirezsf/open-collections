// Visual background picker: thumbnails instead of a dropdown. Papers, edge sheets and fabric
// apply on tap; a garment opens its colourway first. Sheets can be rotated in 90 degree steps so a
// wide deckle sheet can stand up tall.
import { useState } from 'react'
import { PAPER_SHEETS, paperUrl, sheetDef } from '../lib/papers'
import { GARMENTS, findGarment, garmentUrl } from '../lib/garments'

export const isSheetValue = (v: string) => v.startsWith('img:') || v.startsWith('garment:')

export function backgroundImageUrl(value: string): string | null {
  if (value.startsWith('img:')) return paperUrl(value.slice(4))
  if (value.startsWith('garment:')) {
    const g = findGarment(value.slice(8))
    return g ? garmentUrl(g.color.file) : null
  }
  return null
}

export const isGarment = (v: string) => v.startsWith('garment:')

// Garments and cut-out sheets keep their own silhouette; full-bleed papers cover the frame.
export function isContainedBackground(value: string): boolean {
  if (value.startsWith('garment:')) return true
  if (value.startsWith('img:')) return !!sheetDef(value.slice(4))?.edge
  return false
}

export function backgroundLabel(value: string): string {
  if (value === 'transparent') return 'Transparent'
  if (value.startsWith('img:')) return sheetDef(value.slice(4))?.label || 'Sheet'
  if (value.startsWith('garment:')) {
    const g = findGarment(value.slice(8))
    return g ? `${g.product.label} · ${g.color.name}` : 'Garment'
  }
  return 'Colour'
}

interface Props {
  value: string
  color: string
  rotate: number
  onPick: (value: string) => void
  onColor: (hex: string) => void
  onRotate: (deg: number) => void
  onClose: () => void
}

export default function BackgroundPicker({ value, color, rotate, onPick, onColor, onRotate, onClose }: Props) {
  const [openGarment, setOpenGarment] = useState<string | null>(
    value.startsWith('garment:') ? value.slice(8).split('/')[0] : null,
  )
  const pick = (v: string) => {
    onPick(v)
    onClose()
  }
  // cutouts and garments show their whole silhouette; full-bleed surfaces fill the tile
  const Tile = ({ v, label, style, img }: { v: string; label: string; style?: React.CSSProperties; img?: string }) => (
    <button className={'bg-tile' + (value === v ? ' sel' : '')} onClick={() => pick(v)} title={label}>
      <span className={'bg-thumb' + (isContainedBackground(v) ? ' fit' : '')} style={style}>{img && <img src={img} alt="" loading="lazy" />}</span>
      <span className="bg-name">{label}</span>
    </button>
  )
  return (
    <>
      <div className="backdrop" style={{ zIndex: 86 }} onClick={onClose} />
      <div className="pop bg-pop" style={{ zIndex: 87 }} role="dialog" aria-modal="true">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="label" style={{ margin: 0 }}>Background</span>
          <div className="row" style={{ gap: 6 }}>
            {isSheetValue(value) && (
              <button className="btn small" onClick={() => onRotate((rotate + 90) % 360)} title="Turn the sheet 90 degrees">
                Rotate {rotate ? `· ${rotate}°` : ''}
              </button>
            )}
            <button className="btn small" onClick={onClose}>Done</button>
          </div>
        </div>

        <div className="bg-scroll">
          <h4 className="picker-h">Colour</h4>
          <div className="bg-grid">
            <button className={'bg-tile' + (value === 'none' ? ' sel' : '')} onClick={() => pick('none')}>
              <span className="bg-thumb" style={{ background: color }} />
              <span className="bg-name">Solid colour</span>
            </button>
            <label className="bg-tile" title="Pick a colour">
              <span className="bg-thumb bg-thumb-color" style={{ background: color }}>
                <input type="color" value={color} onChange={(e) => onColor(e.target.value)} />
              </span>
              <span className="bg-name">Choose colour</span>
            </label>
            <button className={'bg-tile' + (value === 'transparent' ? ' sel' : '')} onClick={() => pick('transparent')}>
              <span className="bg-thumb bg-thumb-checker" />
              <span className="bg-name">Transparent</span>
            </button>
          </div>

          {(['paper', 'edge', 'fabric', 'material'] as const).map((group) => (
            <div key={group}>
              <h4 className="picker-h">
                {group === 'paper' ? 'Papers' : group === 'edge' ? 'Deckle and torn edges' : group === 'fabric' ? 'Fabric' : 'Wood and other surfaces'}
              </h4>
              <div className="bg-grid">
                {PAPER_SHEETS.filter((s) => s.group === group).map((s) => (
                  <Tile key={s.slug} v={'img:' + s.slug} label={s.label} img={paperUrl(s.slug)} />
                ))}
              </div>
            </div>
          ))}

          <h4 className="picker-h">Clothing</h4>
          <p className="faint" style={{ fontSize: 12, margin: '0 0 8px' }}>Pick a piece, then a colour.</p>
          <div className="bg-grid">
            {GARMENTS.map((g) => (
              <button
                key={g.id}
                className={'bg-tile' + (openGarment === g.id ? ' open' : '') + (value.startsWith('garment:' + g.id + '/') ? ' sel' : '')}
                onClick={() => setOpenGarment(openGarment === g.id ? null : g.id)}
              >
                <span className="bg-thumb fit"><img src={garmentUrl(g.colors[0].file)} alt="" loading="lazy" /></span>
                <span className="bg-name">{g.label}</span>
              </button>
            ))}
          </div>
          {openGarment && (
            <div className="bg-sub">
              <h4 className="picker-h" style={{ marginTop: 0 }}>
                {GARMENTS.find((g) => g.id === openGarment)?.label} colours
              </h4>
              <div className="bg-grid">
                {GARMENTS.find((g) => g.id === openGarment)?.colors.map((c) => (
                  <Tile key={c.slug} v={`garment:${openGarment}/${c.slug}`} label={c.name} img={garmentUrl(c.file)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
