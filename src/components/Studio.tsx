// Studio: one front door for working on your own images. Two tiles take an upload (or a drop, or a
// paste) straight into the editor or the vectorizer; both save to boards the same way the rest of
// the site does. Boards and sign-in live here too, so the account is one tap away: saves stay in
// this browser until you sign in, then they persist on the account and follow you between devices.
import { useCallback, useEffect, useRef, useState } from 'react'
import { boardStore, EDITS_ID, type Board } from '../lib/boards'
import { onAuthChange, signIn, signOut, type AuthState } from '../lib/account'
import { AccountPanel, BoardsPanel } from './Panels'
import UploadEditor from './UploadEditor'
import VectorizeTool from './VectorizeTool'

export type StudioMode = 'hub' | 'editor' | 'vectorize'

interface Props {
  mode: StudioMode
  onMode: (m: StudioMode) => void
  onClose: () => void
}

const TILES: { mode: Exclude<StudioMode, 'hub'>; title: string; text: string }[] = [
  { mode: 'editor', title: 'Editor', text: 'Cut out the background, erase and restore, crop, stack effects, print onto paper or fabric. Export at full resolution or save to your Edits board.' },
  { mode: 'vectorize', title: 'Vectorize', text: 'Redraw a logo, drawing or flat artwork as clean, editable vector shapes. Watch it take shape, flatten to visible shapes, download the SVG or save it to a board.' },
]

function Tile({ title, text, hot, onFile, onHot }: { title: string; text: string; hot: boolean; onFile: (f: File) => void; onHot: () => void }) {
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div
      className={'dropzone studio-tile' + (over ? ' over' : '') + (hot ? ' hot' : '')}
      onClick={() => ref.current?.click()}
      onMouseEnter={onHot}
      onFocus={onHot}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => e.key === 'Enter' && ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
        onHot()
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <strong>{title}</strong>
      <span className="faint">{text}</span>
      <span className="studio-cta">Choose an image · drag · paste</span>
    </div>
  )
}

export default function Studio({ mode, onMode, onClose }: Props) {
  const [seed, setSeed] = useState<{ mode: StudioMode; file: File } | null>(null)
  const [hot, setHot] = useState<Exclude<StudioMode, 'hub'>>('editor') // where a paste goes
  const [panel, setPanel] = useState<'boards' | 'account' | null>(null)
  const [auth, setAuth] = useState<AuthState>({ user: null, syncing: false, error: null })
  const [boards, setBoards] = useState<Board[]>(() => boardStore.list())
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => onAuthChange(setAuth), [])
  useEffect(() => boardStore.subscribe(() => setBoards(boardStore.list())), [])
  useEffect(() => {
    if (mode === 'hub') document.title = 'Studio · Open Collections'
  }, [mode])

  const say = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 2600)
  }

  const open = useCallback(
    (m: Exclude<StudioMode, 'hub'>, file: File) => {
      if (!file.type.startsWith('image/')) {
        say('That is not an image file.')
        return
      }
      setSeed({ mode: m, file })
      onMode(m)
    },
    [onMode],
  )

  // a paste on the hub opens the tile last hovered or focused
  useEffect(() => {
    if (mode !== 'hub') return
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files || [])][0]
      if (f) open(hot, f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [mode, hot, open])

  useEffect(() => {
    if (mode !== 'hub') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (panel ? setPanel(null) : onClose())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, panel, onClose])

  const back = () => {
    setSeed(null)
    onMode('hub')
  }

  if (mode === 'editor') return <UploadEditor initialFile={seed?.mode === 'editor' ? seed.file : null} onClose={back} />
  if (mode === 'vectorize') return <VectorizeTool initialFile={seed?.mode === 'vectorize' ? seed.file : null} onClose={back} />

  const edits = boards.find((b) => b.id === EDITS_ID)
  const recent = (edits?.items ?? []).slice(-12).reverse()
  const saved = boards.reduce((n, b) => n + b.items.filter((i) => i.source === 'edits').length, 0)

  return (
    <div className="studio">
      <header className="studio-top">
        <h1>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault()
              onClose()
            }}
          >
            Open Collections
          </a>{' '}
          <span className="faint">/ Studio</span>
        </h1>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn" onClick={onClose}>Collections</button>
          <button className="btn" onClick={() => setPanel('boards')}>Boards{boards.length > 1 ? ` (${boards.length})` : ''}</button>
          <button className={'btn' + (auth.user ? ' active' : '')} onClick={() => setPanel('account')} title={auth.user ? `Signed in as ${auth.user}` : 'Sign in so saves persist on your account'}>
            {auth.user ? `@${auth.user}` : 'Sign in'}
          </button>
        </div>
      </header>

      <div className="studio-body">
        <p className="intro-lead" style={{ maxWidth: 640 }}>
          Bring your own images. Edit them or turn them into vectors, and save what you make to boards, the same boards as the
          rest of the site.{' '}
          {auth.user ? (
            <>Signed in as <b>@{auth.user}</b>: saves persist on your account and follow you between devices.</>
          ) : (
            <>
              Saves stay in this browser until you{' '}
              <button className="btn link" onClick={() => setPanel('account')}>sign in</button>, then they persist on your account.
            </>
          )}
        </p>

        <div className="studio-tiles">
          {TILES.map((t) => (
            <Tile key={t.mode} title={t.title} text={t.text} hot={hot === t.mode} onHot={() => setHot(t.mode)} onFile={(f) => open(t.mode, f)} />
          ))}
        </div>

        {recent.length > 0 && (
          <section className="studio-recent">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2>Recent saves</h2>
              <button
                className="btn link"
                onClick={() => {
                  location.hash = `#/board/${EDITS_ID}`
                }}
              >
                Open the Edits board{saved ? ` (${saved})` : ''} →
              </button>
            </div>
            <div className="studio-strip">
              {recent.map((it) => (
                <figure key={it.id} title={it.title}>
                  {it.thumbnailUrl ? <img src={it.thumbnailUrl} alt={it.title} loading="lazy" /> : <div className="ph" />}
                  <figcaption>{it.medium || it.objectType || 'edit'}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>

      {panel === 'account' && (
        <AccountPanel
          auth={auth}
          onClose={() => setPanel(null)}
          onSignIn={async (action, u, pw, em) => {
            await signIn(action, u, pw, em)
            say(action === 'signup' ? `Welcome, ${u}! Saves now persist on your account.` : `Signed in as ${u}. Boards synced.`)
          }}
          onSignOut={() => {
            void signOut()
            say('Signed out. Saves stay in this browser.')
          }}
        />
      )}
      {panel === 'boards' && (
        <BoardsPanel
          boards={boards}
          signedIn={!!auth.user}
          onClose={() => setPanel(null)}
          onOpen={(b) => {
            setPanel(null)
            location.hash = `#/board/${b.id}`
          }}
          onCreate={(name) => boardStore.create(name)}
          onDelete={(b) => boardStore.remove(b.id)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
