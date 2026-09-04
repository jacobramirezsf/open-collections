import { useEffect, useRef, useState } from 'react'
import type { Item, SourceInfo } from '../../shared/types'
import { FAVORITES_ID, type Board } from '../lib/boards'
import type { Query } from '../lib/api'

export function useBodyLock() {
  useEffect(() => {
    document.body.classList.add('locked')
    const n = (Number(document.body.dataset.locks) || 0) + 1
    document.body.dataset.locks = String(n)
    return () => {
      const left = (Number(document.body.dataset.locks) || 1) - 1
      document.body.dataset.locks = String(left)
      if (left <= 0) document.body.classList.remove('locked')
    }
  }, [])
}

export function SidePanel({ title, onClose, children, extra }: { title: string; onClose: () => void; children: React.ReactNode; extra?: React.ReactNode }) {
  useBodyLock()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="panel">
        <div className="head">
          <h2>{title}</h2>
          {extra}
          <button className="btn small" onClick={onClose}>Close</button>
        </div>
        <div className="body">{children}</div>
      </aside>
    </>
  )
}

export function BoardsPanel({ boards, signedIn, onClose, onOpen, onCreate, onDelete }: { boards: Board[]; signedIn: boolean; onClose: () => void; onOpen: (b: Board) => void; onCreate: (name: string) => void; onDelete: (b: Board) => void }) {
  const [name, setName] = useState('')
  return (
    <SidePanel title="Boards" onClose={onClose}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onCreate(name)
          setName('')
        }}
      >
        <input className="input" style={{ flex: 1 }} placeholder="New board name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" type="submit">Create</button>
      </form>
      <h3>Your boards</h3>
      {boards.length === 0 && <p className="muted">No boards yet. Open an item or select several and choose “Save to board”.</p>}
      {boards.map((b) => (
        <div className="boardrow" key={b.id} onClick={() => onOpen(b)}>
          <div className="thumbs">
            {[0, 1, 2].map((i) => (
              <div key={i}>{b.items[i]?.thumbnailUrl && <img src={b.items[i].thumbnailUrl!} alt="" loading="lazy" />}</div>
            ))}
          </div>
          <div className="name">
            <b>{b.name}</b>
            <span>{b.items.length} item{b.items.length === 1 ? '' : 's'}</span>
          </div>
          {b.id !== FAVORITES_ID && (
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete board “${b.name}”?`)) onDelete(b)
              }}
            >
              Delete
            </button>
          )}
        </div>
      ))}
      <p className="faint" style={{ marginTop: 16, fontSize: 12 }}>{signedIn ? 'Boards sync to your account and follow you across devices.' : 'Boards are stored in this browser. Sign in to sync them to an account.'}</p>
    </SidePanel>
  )
}

export function StatusPanel({ sources, builtAt, disabled, onToggle, onClose, health }: { sources: SourceInfo[]; builtAt: string | null; disabled: Set<string>; onToggle: (key: string) => void; onClose: () => void; health: 'ok' | 'down' | 'unknown' }) {
  return (
    <SidePanel title="Sources" onClose={onClose}>
      {health === 'down' && <p className="notes warn" style={{ padding: 0 }}>The search service is unreachable right now.</p>}
      {sources.map((s) => (
        <label className="statusrow" key={s.key}>
          <input type="checkbox" checked={!disabled.has(s.key)} onChange={() => onToggle(s.key)} />
          <span className={'dot' + (disabled.has(s.key) ? ' off' : '')} />
          <span className="name">
            {s.name}
            <span className="faint" style={{ fontSize: 11, display: 'block' }}>{s.license}{s.contentTypes.includes('3d') ? ' · 3D' : ''}</span>
          </span>
          <span className="n">{s.count.toLocaleString()}</span>
        </label>
      ))}
      <p className="faint" style={{ marginTop: 16, fontSize: 12 }}>
        Search runs against a normalized index built from each institution's open data, refreshed periodically{builtAt ? ` (last build ${new Date(builtAt).toLocaleDateString()})` : ''}. Images and downloads come from the museums' own servers.
      </p>
    </SidePanel>
  )
}

export function SaveToBoard({ boards, anchor, onPick, onCreate, onClose }: { boards: Board[]; anchor: HTMLElement | null; onPick: (b: Board) => void; onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useBodyLock()
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const r = anchor?.getBoundingClientRect()
  const style: React.CSSProperties = r
    ? { top: Math.min(window.innerHeight - 320, r.bottom + 6), left: Math.max(8, Math.min(window.innerWidth - 290, r.left)) }
    : { top: '40%', left: 'calc(50% - 140px)' }
  return (
    <>
      <div className="backdrop" style={{ zIndex: 75 }} onClick={onClose} />
      <div className="pop" style={style} ref={ref}>
      <span className="label">Save to board</span>
      <div className="list">
        {boards.length === 0 && <div className="faint" style={{ padding: 6, fontSize: 13 }}>No boards yet — create one below.</div>}
        {boards.map((b) => (
          <button key={b.id} onClick={() => onPick(b)}>
            {b.name} <span>{b.items.length}</span>
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onCreate(name)
        }}
      >
        <input className="input" placeholder="New board…" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" type="submit">Add</button>
      </form>
      </div>
    </>
  )
}

export function Filters({ draft, sources, onChange, onApply, onClear }: { draft: Query; sources: SourceInfo[]; onChange: (q: Query) => void; onApply: () => void; onClear: () => void }) {
  const num = (v: string) => (v.trim() === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined)
  const enabled = (key: string) => draft.sources.length === 0 || draft.sources.includes(key)
  const toggleSource = (key: string) => {
    const all = sources.map((s) => s.key)
    const cur = draft.sources.length ? draft.sources : all
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
    onChange({ ...draft, sources: next.length === all.length ? [] : next })
  }
  return (
    <form
      className="filters"
      onSubmit={(e) => {
        e.preventDefault()
        onApply()
      }}
    >
      <div className="wide">
        <span className="label">Sources</span>
        <div className="chips">
          {sources.map((s) => (
            <label className={'chip' + (enabled(s.key) ? '' : ' off')} key={s.key}>
              <input type="checkbox" checked={enabled(s.key)} onChange={() => toggleSource(s.key)} />
              {s.name} <span className="n">{s.count >= 1000 ? Math.round(s.count / 1000) + 'k' : s.count}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Content</span>
        <div className="seg">
          {(['all', 'image', '3d'] as const).map((c) => (
            <button type="button" key={c} className={draft.content === c ? 'active' : ''} onClick={() => onChange({ ...draft, content: c })}>
              {c === 'all' ? 'Both' : c === 'image' ? 'Images' : '3D'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Rights</span>
        <label className="check" style={{ height: 30 }}>
          <input type="checkbox" checked={draft.pd} onChange={(e) => onChange({ ...draft, pd: e.target.checked })} />
          Public domain / open access only
        </label>
      </div>
      <div>
        <span className="label">Year from</span>
        <input className="input" type="number" placeholder="1800" value={draft.from ?? ''} onChange={(e) => onChange({ ...draft, from: num(e.target.value) })} />
      </div>
      <div>
        <span className="label">Year to</span>
        <input className="input" type="number" placeholder="1950" value={draft.to ?? ''} onChange={(e) => onChange({ ...draft, to: num(e.target.value) })} />
      </div>
      <div>
        <span className="label">Object type</span>
        <input className="input" placeholder="furniture, print, textile…" value={draft.type ?? ''} onChange={(e) => onChange({ ...draft, type: e.target.value || undefined })} />
      </div>
      <div>
        <span className="label">Medium / material</span>
        <input className="input" placeholder="wood, silk, bronze…" value={draft.medium ?? ''} onChange={(e) => onChange({ ...draft, medium: e.target.value || undefined })} />
      </div>
      <div>
        <span className="label">Culture / place</span>
        <input className="input" placeholder="Japan, France, Italian…" value={draft.place ?? ''} onChange={(e) => onChange({ ...draft, place: e.target.value || undefined })} />
      </div>
      <div>
        <span className="label">Artist / maker</span>
        <input className="input" placeholder="name" value={draft.creator ?? ''} onChange={(e) => onChange({ ...draft, creator: e.target.value || undefined })} />
      </div>
      <div>
        <span className="label">Sort</span>
        <select className="input" value={draft.sort ?? 'relevance'} onChange={(e) => onChange({ ...draft, sort: e.target.value === 'relevance' ? undefined : (e.target.value as Query['sort']) })}>
          <option value="relevance">Relevance (balanced)</option>
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
          <option value="random">Shuffle</option>
        </select>
      </div>
      <div className="actions">
        <button className="btn primary" type="submit">Apply</button>
        <button className="btn" type="button" onClick={onClear}>Clear filters</button>
        <span className="faint" style={{ fontSize: 12 }}>Filters match normalized metadata; items without a known date are excluded when a year range is set.</span>
      </div>
    </form>
  )
}

export function PatentFilters({ draft, onChange, onApply, onClear }: { draft: Query; onChange: (q: Query) => void; onApply: () => void; onClear: () => void }) {
  const num = (v: string) => (v.trim() === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined)
  return (
    <form
      className="filters"
      onSubmit={(e) => {
        e.preventDefault()
        onApply()
      }}
    >
      <div>
        <span className="label">Date field</span>
        <select className="input" value={draft.pDateType ?? 'publication'} onChange={(e) => onChange({ ...draft, pDateType: e.target.value as Query['pDateType'] })}>
          <option value="publication">Publication date</option>
          <option value="filing">Filing date</option>
          <option value="priority">Priority date</option>
        </select>
      </div>
      <div>
        <span className="label">Year from</span>
        <input className="input" type="number" placeholder="1900" value={draft.from ?? ''} onChange={(e) => onChange({ ...draft, from: num(e.target.value) })} />
      </div>
      <div>
        <span className="label">Year to</span>
        <input className="input" type="number" placeholder="1980" value={draft.to ?? ''} onChange={(e) => onChange({ ...draft, to: num(e.target.value) })} />
      </div>
      <div>
        <span className="label">Inventor</span>
        <input className="input" placeholder="name" value={draft.creator ?? ''} onChange={(e) => onChange({ ...draft, creator: e.target.value || undefined })} />
      </div>
      <div>
        <span className="label">Assignee / company</span>
        <input className="input" placeholder="company" value={draft.pAssignee ?? ''} onChange={(e) => onChange({ ...draft, pAssignee: e.target.value || undefined })} />
      </div>
      <div>
        <span className="label">Country</span>
        <input className="input" placeholder="US, EP, JP…" value={draft.pCountry ?? ''} onChange={(e) => onChange({ ...draft, pCountry: e.target.value || undefined })} />
      </div>
      <div>
        <span className="label">Kind</span>
        <select className="input" value={draft.pType ?? ''} onChange={(e) => onChange({ ...draft, pType: (e.target.value || undefined) as Query['pType'] })}>
          <option value="">Any</option>
          <option value="PATENT">Utility patent</option>
          <option value="DESIGN">Design patent</option>
        </select>
      </div>
      <div>
        <span className="label">Status</span>
        <select className="input" value={draft.pStatus ?? ''} onChange={(e) => onChange({ ...draft, pStatus: (e.target.value || undefined) as Query['pStatus'] })}>
          <option value="">Any</option>
          <option value="GRANT">Granted</option>
          <option value="APPLICATION">Application</option>
        </select>
      </div>
      <div>
        <span className="label">Sort</span>
        <select className="input" value={draft.sort ?? 'relevance'} onChange={(e) => onChange({ ...draft, sort: e.target.value === 'relevance' ? undefined : (e.target.value as Query['sort']) })}>
          <option value="relevance">Relevance</option>
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
      </div>
      <div className="actions">
        <button className="btn primary" type="submit">Apply</button>
        <button className="btn" type="button" onClick={onClear}>Clear filters</button>
        <span className="faint" style={{ fontSize: 12 }}>You can also type operators straight into the search box: inventor:, assignee:, country:, before:, after:, cpc:.</span>
      </div>
    </form>
  )
}

export function AccountPanel({ auth, onClose, onSignIn, onSignOut }: {
  auth: { user: string | null; syncing: boolean; error: string | null }
  onClose: () => void
  onSignIn: (action: 'login' | 'signup', username: string, password: string) => Promise<void>
  onSignOut: () => void
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (auth.user) {
    return (
      <SidePanel title="Account" onClose={onClose}>
        <p style={{ marginTop: 0 }}>Signed in as <b>{auth.user}</b></p>
        <p className="muted" style={{ fontSize: 13 }}>
          {auth.syncing ? 'Syncing…' : auth.error ? auth.error : 'Boards and favorites sync to this account and follow you across browsers and devices.'}
        </p>
        <button className="btn" onClick={onSignOut}>Sign out</button>
        <p className="faint" style={{ marginTop: 16, fontSize: 12 }}>Signing out keeps a copy of your boards in this browser.</p>
      </SidePanel>
    )
  }
  return (
    <SidePanel title={mode === 'login' ? 'Sign in' : 'Create account'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setErr(null)
          setBusy(true)
          try {
            await onSignIn(mode, username.toLowerCase().trim(), password)
            onClose()
          } catch (ex) {
            setErr((ex as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <span className="label">Username</span>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus style={{ marginBottom: 10 }} />
        <span className="label">Password</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} style={{ marginBottom: 10 }} />
        {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || !username || !password}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          <button className="btn link" type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        </div>
      </form>
      <p className="faint" style={{ marginTop: 16, fontSize: 12 }}>
        An account syncs your boards and favorites across devices. Just a username and a password (8+ characters) — no email needed, so there's no password recovery: keep it somewhere safe.
      </p>
    </SidePanel>
  )
}

export function itemsLabel(items: Item[]) {
  return `${items.length} item${items.length === 1 ? '' : 's'}`
}
