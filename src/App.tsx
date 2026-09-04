import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Item } from '../shared/types'
import { ApiError, DEFAULT_PATENT_QUERY, DEFAULT_QUERY, fetchStatus, paramsToQuery, queryToParams, search, searchPatents, type Query, type Status, type Tool } from './lib/api'
import { boardStore, FAVORITES_ID, type Board } from './lib/boards'
import { onAuthChange, restoreSession, signIn, signOut, type AuthState } from './lib/account'
import { rankSimilar } from './lib/similarity'
import { saveBlob, zipItems } from './lib/zip'
import { downloadFiles, type BatchProgress, type BatchSize } from './lib/download'
import Grid from './components/Grid'
import Viewer from './components/Viewer'
import ContactSheet from './components/ContactSheet'
import CanvasStudio from './components/CanvasStudio'
import { canvasStore, lastCanvasId } from './lib/canvas'
import Intro, { introSeen, markIntroSeen } from './components/Intro'
import { AccountPanel, BoardsPanel, Filters, PatentFilters, SaveToBoard, StatusPanel } from './components/Panels'

const HINTS: Record<Tool, string[]> = {
  museums: ['chair', 'woman', 'helmet', 'embroidery', 'bicycle', 'goggles', 'poster', 'tool', 'sewing machine', 'packaging', 'lettering', 'ceramics', 'Japanese textile', 'Italian furniture', 'rome', 'map', 'spacecraft'],
  patents: ['goggles', 'sewing machine', 'bicycle', 'espresso machine', 'roller skate', 'diving suit', 'typewriter', 'kite', 'surfboard', 'toy robot', 'climbing', 'chair', 'synthesizer', 'camera'],
}

type View = { kind: 'search' } | { kind: 'board'; id: string } | { kind: 'similar'; base: Item } | { kind: 'sheet'; title: string; items: Item[] } | { kind: 'canvas'; id: string }

function readUrl(): { query: Query; view: View; tool: Tool } {
  const p = new URLSearchParams(location.search)
  const m = location.hash.match(/^#\/board\/([a-z0-9]+)/)
  const cv = location.hash.match(/^#\/canvas\/([a-z0-9]+)/)
  const tool: Tool = location.pathname.startsWith('/patents') ? 'patents' : 'museums'
  const query = paramsToQuery(p)
  if (tool === 'patents' && !p.get('n') && !p.get('limit')) query.limit = 100
  return { query, view: cv ? { kind: 'canvas', id: cv[1] } : m ? { kind: 'board', id: m[1] } : { kind: 'search' }, tool }
}

function useBoards(): Board[] {
  const [boards, setBoards] = useState(boardStore.list())
  useEffect(() => boardStore.subscribe(() => setBoards(boardStore.list())), [])
  return boards
}

export default function App() {
  const initial = useMemo(readUrl, [])
  const [query, setQuery] = useState<Query>(initial.query) // applied query
  const [draft, setDraft] = useState<Query>(initial.query) // filters being edited
  const [text, setText] = useState(initial.query.q)
  const [view, setView] = useState<View>(initial.view)
  const [tool, setTool] = useState<Tool>(initial.tool)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [intro, setIntro] = useState(() => !introSeen())
  const [perSource, setPerSource] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [seed] = useState(() => Math.floor(Math.random() * 1e6))
  const [status, setStatus] = useState<Status | null>(null)
  const [health, setHealth] = useState<'ok' | 'down' | 'unknown'>('unknown')
  const [showFilters, setShowFilters] = useState(false)
  const [dense, setDense] = useState(() => localStorage.getItem('oc:dense') === '1')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClick = useRef<number | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [panel, setPanel] = useState<'boards' | 'sources' | 'account' | null>(null)
  const [auth, setAuth] = useState<AuthState>({ user: null, syncing: false, error: null })
  const [savePop, setSavePop] = useState<{ items: Item[]; anchor: HTMLElement | null } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dl, setDl] = useState<{ mode: 'files' | 'zip'; p: BatchProgress } | null>(null)
  const [dlPop, setDlPop] = useState<HTMLElement | null>(null)
  const [similarItems, setSimilarItems] = useState<Item[] | null>(null)
  const [similarProgress, setSimilarProgress] = useState<string | null>(null)
  const boards = useBoards()
  const abortRef = useRef<AbortController | null>(null)

  const say = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }, [])

  const favIds = useMemo(() => new Set(boards.find((b) => b.id === FAVORITES_ID)?.items.map((i) => i.id) ?? []), [boards])
  const toggleFavorite = useCallback((item: Item) => {
    const now = boardStore.toggleFavorite(item)
    say(now ? 'Added to favorites ♥' : 'Removed from favorites')
  }, [say])

  useEffect(() => {
    const off = onAuthChange(setAuth)
    void restoreSession()
    return off
  }, [])

  // Source status (once)
  useEffect(() => {
    fetchStatus()
      .then((s) => {
        setStatus(s)
        setHealth(s.ok ? 'ok' : 'down')
      })
      .catch(() => setHealth('down'))
  }, [])

  // Run the search whenever the applied query changes; keep URL in sync.
  const runSearch = useCallback(
    async (q: Query, more = false) => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const off = more ? offset + q.limit : 0
      if (more) setLoadingMore(true)
      else {
        setLoading(true)
        setError(null)
      }
      try {
        const res = tool === 'patents' ? await searchPatents(q, off, ctrl.signal) : await search(q, off, seed, ctrl.signal)
        if (ctrl.signal.aborted) return
        if (!more) window.scrollTo(0, 0)
        setItems((prev) => {
          if (!more) return res.items
          const have = new Set(prev.map((i) => i.id))
          return prev.concat(res.items.filter((i) => !have.has(i.id)))
        })
        setTotal(res.total)
        setPerSource(res.perSource)
        setOffset(off)
        setHealth('ok')
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        const msg = e instanceof ApiError ? e.message : 'Could not reach the search service.'
        setError(msg)
        if (!(e instanceof ApiError)) setHealth('down')
      } finally {
        if (!ctrl.signal.aborted) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [offset, seed, tool],
  )

  useEffect(() => {
    if (view.kind !== 'search') return
    const p = queryToParams(query)
    p.delete('limit')
    if (query.limit !== 250) p.set('n', String(query.limit))
    p.delete('pd')
    if (!query.pd) p.set('pd', '0')
    const qs = p.toString()
    const path = tool === 'patents' ? '/patents' : '/'
    history.replaceState(null, '', path + (qs ? '?' + qs : '') + location.hash)
    document.title = (query.q ? `${query.q} — ` : '') + (tool === 'patents' ? 'Open Collections · Patents' : 'Open Collections')
    if (tool === 'patents' && !query.q.trim()) {
      setItems([])
      setTotal(0)
      setPerSource({})
      setLoading(false)
      return
    }
    runSearch(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, view.kind, tool])

  useEffect(() => {
    // hash routing for boards
    const onHash = () => setView(readUrl().view)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const switchTool = (t: Tool) => {
    if (t === tool) return
    setTool(t)
    const base = t === 'patents' ? DEFAULT_PATENT_QUERY : DEFAULT_QUERY
    const next = { ...base, q: text.trim() }
    setDraft(next)
    setQuery(next)
    setItems([])
    setSimilarItems(null)
    setSelected(new Set())
    setOffset(0)
    if (view.kind !== 'search') {
      location.hash = ''
      setView({ kind: 'search' })
    }
  }

  const apply = (patch: Partial<Query>) => {
    const next = { ...draft, ...patch, q: text.trim() }
    setDraft(next)
    setQuery(next)
    setSimilarItems(null)
    if (view.kind !== 'search') {
      location.hash = ''
      setView({ kind: 'search' })
    }
    setSelected(new Set())
  }

  // Which items are on screen right now
  const board = view.kind === 'board' ? boards.find((b) => b.id === view.id) : null
  const shown: Item[] = view.kind === 'board' ? board?.items ?? [] : view.kind === 'similar' ? similarItems ?? [] : items
  const shownRef = useRef(shown)
  shownRef.current = shown

  const removeBroken = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
    setSimilarItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev))
  }, [])

  const toggle = useCallback((item: Item, index: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const list = shownRef.current
      if (shift && lastClick.current != null) {
        const [a, b] = [Math.min(lastClick.current, index), Math.max(lastClick.current, index)]
        for (let i = a; i <= b; i++) next.add(list[i].id)
      } else if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      lastClick.current = index
      return next
    })
    setSelectMode(true)
  }, [])

  const onMarquee = useCallback((ids: string[], additive: boolean) => {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>()
      ids.forEach((id) => next.add(id))
      return next
    })
  }, [])

  const selectedItems = useMemo(() => {
    const all = new Map<string, Item>()
    for (const i of items) all.set(i.id, i)
    for (const i of similarItems ?? []) all.set(i.id, i)
    for (const b of boards) for (const i of b.items) all.set(i.id, i)
    return [...selected].map((id) => all.get(id)).filter(Boolean) as Item[]
  }, [selected, items, similarItems, boards])

  const openSave = (its: Item[], anchor: HTMLElement | null) => setSavePop({ items: its, anchor })
  const saveTo = (b: Board) => {
    if (!savePop) return
    const n = boardStore.addItems(b.id, savePop.items)
    say(n ? `Saved ${n} to “${b.name}”` : `Already in “${b.name}”`)
    setSavePop(null)
  }

  const downloadSelected = async (mode: 'files' | 'zip', size: BatchSize) => {
    setDlPop(null)
    const its = selectedItems.slice(0, 100)
    if (!its.length) return
    if (selectedItems.length > 100) say('Downloading the first 100 selected items')
    try {
      localStorage.setItem('oc:dl', mode + ':' + size)
    } catch { /* private mode */ }
    const onP = (p: BatchProgress) => setDl({ mode, p })
    setDl({ mode, p: { done: 0, total: its.length, failed: [] } })
    try {
      if (mode === 'files') {
        const p = await downloadFiles(its, size, onP)
        if (p.failed.length) say(`${p.failed.length} file(s) failed`)
      } else {
        const blob = await zipItems(its, onP, undefined, size)
        const name = `open-collections-${(query.q || board?.name || 'selection').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${its.length}.zip`
        saveBlob(blob, name)
      }
    } catch (e) {
      say('Download failed: ' + (e as Error).message)
    } finally {
      setDl(null)
    }
  }

  const similarTo = async (base: Item) => {
    const pool = view.kind === 'board' ? shown : items
    if (pool.length < 2) {
      say('Load some results first')
      return
    }
    setViewerIndex(null)
    setView({ kind: 'similar', base })
    setSimilarItems([])
    setSimilarProgress('Comparing 0 images…')
    const ranked = await rankSimilar(base, pool, (done, tot) => setSimilarProgress(`Comparing ${done} / ${tot} images…`))
    setSimilarItems([base, ...ranked])
    setSimilarProgress(null)
  }

  const closeSpecial = () => {
    setView({ kind: 'search' })
    location.hash = ''
    setSelected(new Set())
  }

  const sources = status?.sources ?? []
  const disabledSources = useMemo(() => {
    if (!query.sources.length) return new Set<string>()
    return new Set(sources.map((s) => s.key).filter((k) => !query.sources.includes(k)))
  }, [query.sources, sources])

  if (view.kind === 'canvas')
    return (
      <CanvasStudio
        id={view.id}
        onClose={() => {
          location.hash = ''
          setView({ kind: 'search' })
        }}
      />
    )
  if (view.kind === 'sheet') return <ContactSheet items={view.items} title={view.title} onClose={() => setView(similarItems ? { kind: 'similar', base: similarItems[0] } : board ? { kind: 'board', id: board.id } : { kind: 'search' })} />

  const statusText = () => {
    if (view.kind === 'board') return board ? <>Board <b>{board.name}</b> · {board.items.length} items</> : 'Board not found'
    if (view.kind === 'similar') return similarProgress ? <>{similarProgress}</> : <>Visually similar to <b>{view.base.title}</b> among loaded results</>
    if (loading) return <><span className="spinner" /> Searching…</>
    if (error) return <span style={{ color: 'var(--danger)' }}>{error}</span>
    if (tool === 'patents') {
      if (!query.q) return 'Search patent drawings'
      return <><b>{items.length.toLocaleString()}</b> of ~{total.toLocaleString()} patents · Google Patents</>
    }
    if (!query.q && !items.length) return 'Search open museum collections'
    const n = Object.values(perSource).filter((v) => v > 0).length
    return <><b>{items.length.toLocaleString()}</b> of ~{total.toLocaleString()} results{n ? ` from ${n} sources` : ''}</>
  }

  return (
    <>
      <header className="top">
        <div className="brand">
          <h1><a href="/" onClick={(e) => { e.preventDefault(); setText(''); switchTool('museums'); if (tool === 'museums') apply({ ...DEFAULT_QUERY }) }}>Open Collections</a></h1>
          <nav className="tools" aria-label="Tools">
            <button className={tool === 'museums' ? 'active' : ''} onClick={() => switchTool('museums')}>Museums</button>
            <button className={tool === 'patents' ? 'active' : ''} onClick={() => switchTool('patents')}>Patents</button>
          </nav>
          <div className="right">
            <span className="faint">{tool === 'patents' ? 'Google Patents · live' : status ? `${status.total.toLocaleString()} objects · ${status.sources.length} sources` : ''}</span>
            <button className="btn link about-link" onClick={() => setIntro(true)}>About</button>
          </div>
        </div>
        <form
          className="searchrow"
          onSubmit={(e) => {
            e.preventDefault()
            apply({})
          }}
        >
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={tool === 'patents' ? 'Search patent drawings: goggles, sewing machine, roller skate…' : 'Search chairs, helmets, posters, embroidery, spacecraft…'} autoFocus={!initial.query.q} aria-label="Search" />
          <button className="btn primary" type="submit">Search</button>
        </form>
        <div className="toolbar">
          <div className="status">{statusText()}</div>
          <div className="seg" title="Results per page">
            {(tool === 'patents' ? [50, 100] : [100, 250, 500]).map((n) => (
              <button key={n} className={query.limit === n ? 'active' : ''} onClick={() => apply({ limit: n })}>{n}</button>
            ))}
          </div>
          <button className={'btn' + (showFilters ? ' active' : '')} onClick={() => setShowFilters((v) => !v)}>Filters</button>
          <button className="btn" onClick={() => setPanel('boards')}>Boards{boards.length > 1 ? ` (${boards.length})` : ''}</button>
          <button
            className="btn"
            onClick={() => {
              const last = lastCanvasId()
              const d = (last && canvasStore.get(last)) || canvasStore.list()[0] || canvasStore.create('My canvas')
              location.hash = `#/canvas/${d.id}`
              setView({ kind: 'canvas', id: d.id })
            }}
          >
            Canvas
          </button>
          <button className={'btn' + (auth.user ? ' active' : '')} onClick={() => setPanel('account')} title={auth.user ? `Signed in as ${auth.user}` : 'Sign in to sync boards'}>
            {auth.user ? `@${auth.user}` : 'Sign in'}
          </button>
          <button className={'btn' + (selectMode ? ' active' : '')} onClick={() => { setSelectMode((v) => !v); if (selectMode) setSelected(new Set()) }}>Select</button>
          <button className="btn" onClick={() => { setDense((v) => { localStorage.setItem('oc:dense', v ? '0' : '1'); return !v }) }}>{dense ? 'Comfortable' : 'Dense grid'}</button>
          {tool === 'museums' && (
            <button className="btn" onClick={() => setPanel('sources')} title="Source status">
              <span className="statusrow" style={{ padding: 0, border: 0, gap: 6 }}><span className={'dot' + (health === 'down' ? ' off' : '')} />Sources</span>
            </button>
          )}
        </div>
        <div className="statusline hide-desktop">{statusText()}</div>
        {showFilters && tool === 'museums' && (
          <Filters
            draft={draft}
            sources={sources}
            onChange={setDraft}
            onApply={() => apply({})}
            onClear={() => {
              const cleared = { ...DEFAULT_QUERY, q: text.trim(), limit: draft.limit }
              setDraft(cleared)
              setQuery(cleared)
            }}
          />
        )}
        {showFilters && tool === 'patents' && (
          <PatentFilters
            draft={draft}
            onChange={setDraft}
            onApply={() => apply({})}
            onClear={() => {
              const cleared = { ...DEFAULT_PATENT_QUERY, q: text.trim(), limit: draft.limit }
              setDraft(cleared)
              setQuery(cleared)
            }}
          />
        )}
      </header>

      {view.kind !== 'search' && (
        <div className="notes">
          <button className="btn small" onClick={closeSpecial}>← Back to search</button>
          {view.kind === 'board' && board && (
            <>
              <button className="btn small" onClick={() => setView({ kind: 'sheet', title: board.name, items: board.items })} disabled={!board.items.length}>Contact sheet</button>
              <button className="btn small" onClick={() => { setSelected(new Set(board.items.map((i) => i.id))); setSelectMode(true) }} disabled={!board.items.length}>Select all</button>
              <button className="btn small" onClick={() => { const n = prompt('Rename board', board.name); if (n) boardStore.rename(board.id, n) }}>Rename</button>
              {selected.size > 0 && <button className="btn small danger" onClick={() => { [...selected].forEach((id) => boardStore.removeItem(board.id, id)); setSelected(new Set()) }}>Remove selected from board</button>}
            </>
          )}
          {view.kind === 'similar' && <span className="faint">Similarity is computed in your browser from the images already loaded — load more results for a wider pool.</span>}
        </div>
      )}
      {view.kind === 'search' && query.q && !loading && !error && items.length === 0 && (
        <div className="empty">
          <p>No results for “{query.q}”{tool === 'museums' && query.pd ? ' with public-domain filter' : ''}{query.from != null || query.to != null ? ' in that date range' : ''}.</p>
          <p className="faint">{tool === 'patents' ? 'Try a broader word or fewer filters.' : 'Try a broader word, clear filters, or enable more sources.'}</p>
        </div>
      )}
      {view.kind === 'search' && !query.q && items.length === 0 && !loading && (
        <div className="empty">
          {tool === 'patents' ? (
            <p>Browse patent drawings from Google Patents — an image-first view of a century of invention. Downloads, boards and the halftone editor all work here too.</p>
          ) : (
            <p>Search across {status ? status.total.toLocaleString() : 'hundreds of thousands of'} open-access objects from museums, archives and 3D repositories.</p>
          )}
          <div className="hints">
            {HINTS[tool].map((h) => (
              <button key={h} onClick={() => { setText(h); setDraft({ ...draft, q: h }); setQuery({ ...draft, q: h }) }}>{h}</button>
            ))}
          </div>
        </div>
      )}

      <Grid
        items={shown}
        dense={dense}
        selectMode={selectMode}
        selected={selected}
        favorites={favIds}
        onFavorite={toggleFavorite}
        onOpen={(_, i) => setViewerIndex(i)}
        onToggle={toggle}
        onBroken={removeBroken}
        onMarquee={onMarquee}
      />
      {view.kind === 'search' && items.length > 0 && !loading && (
        <div className="more">
          {items.length < total && (tool === 'patents' ? offset + query.limit < 1000 : offset + query.limit < 1500) ? (
            <button className="btn" disabled={loadingMore} onClick={() => runSearch(query, true)}>{loadingMore ? 'Loading…' : `Load ${query.limit} more`}</button>
          ) : (
            <span className="faint">{items.length < total ? 'Narrow the search to see more.' : 'End of results.'}</span>
          )}
          <button className="btn" onClick={() => { setSelected(new Set(items.map((i) => i.id))); setSelectMode(true) }}>Select all loaded</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="batchbar">
          <b>{selected.size} selected</b>
          <button className="btn primary" onClick={(e) => setDlPop(e.currentTarget)} disabled={!!dl}>
            {dl ? `${dl.mode === 'zip' ? 'Zipping' : 'Saving'} ${dl.p.done}/${dl.p.total}…` : 'Download'}
          </button>
          <button className="btn" onClick={(e) => openSave(selectedItems, e.currentTarget)}>Save to board</button>
          {selectedItems.length === 1 && selectedItems[0].contentType === 'image' && <button className="btn" onClick={() => similarTo(selectedItems[0])}>Similar</button>}
          <button className="btn" onClick={() => setView({ kind: 'sheet', title: query.q || board?.name || 'Selection', items: selectedItems })}>Contact sheet</button>
          <button className="btn" onClick={() => setSelected(new Set(shown.map((i) => i.id)))}>All ({shown.length})</button>
          <button className="btn" onClick={() => { setSelected(new Set()); setSelectMode(false) }}>Clear</button>
        </div>
      )}

      {viewerIndex != null && shown[viewerIndex] && (
        <Viewer
          items={shown}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNav={setViewerIndex}
          onSave={(item, anchor) => openSave([item], anchor)}
          onSimilar={similarTo}
          isFavorite={(id) => favIds.has(id)}
          onFavorite={toggleFavorite}
        />
      )}
      {intro && <Intro total={status?.total} onClose={() => { markIntroSeen(); setIntro(false) }} />}
      {panel === 'account' && (
        <AccountPanel
          auth={auth}
          onClose={() => setPanel(null)}
          onSignIn={async (action, u, pw, em) => {
            await signIn(action, u, pw, em)
            say(action === 'signup' ? `Welcome, ${u}! Boards now sync to your account.` : `Signed in as ${u} — boards synced.`)
          }}
          onSignOut={() => {
            void signOut()
            say('Signed out. Boards stay in this browser.')
          }}
        />
      )}
      {panel === 'boards' && (
        <BoardsPanel
          boards={boards}
          signedIn={!!auth.user}
          onClose={() => setPanel(null)}
          onOpen={(b) => { setPanel(null); setSelected(new Set()); location.hash = `#/board/${b.id}`; setView({ kind: 'board', id: b.id }) }}
          onCreate={(name) => boardStore.create(name)}
          onDelete={(b) => { boardStore.remove(b.id); if (view.kind === 'board' && view.id === b.id) closeSpecial() }}
        />
      )}
      {panel === 'sources' && (
        <StatusPanel
          sources={sources}
          builtAt={status?.builtAt ?? null}
          disabled={disabledSources}
          health={health}
          onClose={() => setPanel(null)}
          onToggle={(key) => {
            const all = sources.map((s) => s.key)
            const cur = query.sources.length ? query.sources : all
            const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
            apply({ sources: next.length === all.length ? [] : next })
          }}
        />
      )}
      {savePop && (
        <SaveToBoard
          boards={boards}
          anchor={savePop.anchor}
          onPick={saveTo}
          onCreate={(name) => saveTo(boardStore.create(name))}
          onClose={() => setSavePop(null)}
        />
      )}
      {dlPop && (
        <div className="pop" style={{ bottom: 64, left: Math.max(8, Math.min(window.innerWidth - 290, dlPop.getBoundingClientRect().left - 40)) }}>
          <span className="label">Download {selected.size} item{selected.size === 1 ? '' : 's'}</span>
          <div className="list">
            <button onClick={() => downloadSelected('files', 'orig')}>Individual files — originals <span>best</span></button>
            <button onClick={() => downloadSelected('files', 'view')}>Individual files — large JPG <span>fast</span></button>
            <button onClick={() => downloadSelected('zip', 'orig')}>One ZIP — originals</button>
            <button onClick={() => downloadSelected('zip', 'view')}>One ZIP — large JPG</button>
          </div>
          <div className="faint" style={{ fontSize: 11 }}>Your browser may ask once to allow multiple downloads.</div>
          <button className="btn small" style={{ marginTop: 6 }} onClick={() => setDlPop(null)}>Cancel</button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
