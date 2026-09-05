// First-run introduction: what this is and what you can do with it. Shown once per browser
// (dismissal is remembered), reopenable from the toolbar.
import { useBodyLock } from './Panels'

const SEEN_KEY = 'open-collections:intro-seen:v1'

export function introSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // private mode / storage blocked: don't nag on every load
  }
}

export function markIntroSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

export default function Intro({ onClose, total }: { onClose: () => void; total?: number }) {
  useBodyLock()
  const count = `${total ? (total / 1_000_000).toFixed(1).replace(/\.0$/, '') : '2'} million`
  return (
    <>
      <div className="backdrop" style={{ zIndex: 88 }} onClick={onClose} />
      <div className="intro" role="dialog" aria-modal="true" aria-label="About Open Collections">
        <div className="intro-body">
          <h1 className="intro-title">Open Collections</h1>
          <p className="intro-lead">
            Museums and libraries hold extraordinary art, and a lot of it is already free for anyone to use. It&rsquo;s just
            hard to find, and harder to do anything with once you do. This is built to fix both.
          </p>
          <ul className="intro-list">
            <li>
              <b>{count} works, one search.</b> The Rijksmuseum, the Met, Harvard, the Smithsonian, NYPL, Europeana,
              Flickr Commons and a dozen more, indexed together. Public domain first, so you can actually use what you find.
            </li>
            <li>
              <b>Edit anything.</b> Cut out the background, erase and restore by hand, then stack effects (halftone, riso,
              CMYK separations, ASCII, embroidery, thread paint) and print it onto real paper stock, deckle-edge sheets or fabric.
            </li>
            <li>
              <b>Collage it.</b> Arrange your edits on a canvas, move and scale them, set a paper or fabric background, export the whole thing.
            </li>
            <li>
              <b>Take it with you.</b> Full-resolution downloads, vector SVG where it makes sense, and boards to keep track of what you found.
            </li>
          </ul>
          <p className="intro-foot">
            It&rsquo;s free and everything works without an account. Make one if you want your boards, edits and canvases to
            follow you between your phone and your desk.
          </p>
        </div>
        <div className="intro-actions">
          <button className="btn primary" onClick={onClose}>Start looking</button>
        </div>
      </div>
    </>
  )
}
