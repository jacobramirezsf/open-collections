// Boards live in localStorage for V1. The BoardStore interface is the seam for a future cloud-synced store.
import type { Item } from '../../shared/types'
import { IDB_PREFIX, resolveRef } from './blobstore'

export interface Board {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  items: Item[]
}

export interface BoardStore {
  list(): Board[]
  create(name: string, id?: string): Board
  rename(id: string, name: string): void
  remove(id: string): void
  addItems(id: string, items: Item[]): number
  // Replaces an item with the same id, or adds it. Used so re-saving the same edit updates it
  // rather than quietly piling up near-identical entries.
  upsertItem(id: string, item: Item): 'added' | 'updated'
  // Why the last write did not stick (storage full, private mode), or null when it did.
  lastPersistError(): string | null
  removeItem(id: string, itemId: string): void
  toggleFavorite(item: Item): boolean // returns new state
  isFavorite(id: string): boolean
  setAll(boards: Board[]): void // used by cloud sync (merge result)
  subscribe(fn: () => void): () => void
}

export const FAVORITES_ID = 'favorites'
export const EDITS_ID = 'edits'
// Precise cutouts cost credits, so they get their own board and are never lost.
export const CUTOUTS_ID = 'cutouts'

function withFavorites(boards: Board[]): Board[] {
  let fav = boards.find((b) => b.id === FAVORITES_ID)
  if (!fav) {
    fav = { id: FAVORITES_ID, name: 'Favorites', createdAt: 0, updatedAt: 0, items: [] }
    boards = [fav, ...boards]
  }
  return [fav, ...boards.filter((b) => b.id !== FAVORITES_ID)]
}

export const boardName = (id: string) => (id === CUTOUTS_ID ? 'Cutouts' : id === EDITS_ID ? 'Edits' : 'Favorites')

// Union-merge two board lists (local + cloud): boards by id, items by item id.
export function mergeBoards(a: Board[], b: Board[]): Board[] {
  const byId = new Map<string, Board>()
  for (const src of [a, b]) {
    for (const board of src) {
      const cur = byId.get(board.id)
      if (!cur) {
        byId.set(board.id, { ...board, items: [...board.items] })
        continue
      }
      const newer = board.updatedAt > cur.updatedAt ? board : cur
      const have = new Set(cur.items.map((i) => i.id))
      for (const it of board.items) if (!have.has(it.id)) cur.items.push(it)
      cur.name = newer.id === FAVORITES_ID ? 'Favorites' : newer.name
      cur.updatedAt = Math.max(cur.updatedAt, board.updatedAt)
      cur.createdAt = Math.min(cur.createdAt || board.createdAt, board.createdAt)
    }
  }
  return withFavorites([...byId.values()].sort((x, y) => y.updatedAt - x.updatedAt))
}

const KEY = 'open-collections:boards:v1'

function load(): Board[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let persistError: string | null = null

// Object URLs are per-session, so anything hydrated from IndexedDB is written back as its `idb:`
// reference. Without this a reload would leave dead blob: URLs behind.
function serialize(boards: Board[]): string {
  return JSON.stringify(boards, (key, value) => {
    if (value && typeof value === 'object' && '__ref' in (value as Record<string, unknown>)) {
      const rec = { ...(value as Record<string, unknown>) }
      const ref = rec.__ref as string
      delete rec.__ref
      for (const k of ['thumbnailUrl', 'imageUrl', 'originalImageUrl']) {
        if (typeof rec[k] === 'string' && (rec[k] as string).startsWith('blob:')) rec[k] = ref
      }
      return rec
    }
    void key
    return value
  })
}

function save(boards: Board[]) {
  try {
    localStorage.setItem(KEY, serialize(boards))
    persistError = null
  } catch (e) {
    // Swallowing this is how a save could report success while changing nothing.
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)
    persistError = quota
      ? 'This browser\u2019s storage for the site is full, so the change was not kept. Remove a few saved items, or sign in to store them on your account.'
      : 'This browser would not store the change (private browsing can block it).'
    console.warn('Could not save boards', e)
  }
}

// Board records hold short `idb:` references; swap them for usable object URLs once at startup.
async function hydrate(boards: Board[]): Promise<boolean> {
  let touched = false
  for (const b of boards) {
    for (const it of b.items) {
      for (const k of ['thumbnailUrl', 'imageUrl', 'originalImageUrl'] as const) {
        const v = it[k]
        if (typeof v === 'string' && v.startsWith(IDB_PREFIX)) {
          const url = await resolveRef(v)
          const rec = it as unknown as Record<string, unknown>
          if (url) {
            rec[k] = url
            rec.__ref = v // kept so the reference, not the object URL, is what gets written back
          } else {
            // the bytes are gone (cleared storage, another browser): blank it rather than let the
            // browser request "idb:…" as if it were a path
            rec[k] = ''
            rec.__ref = v
            rec.__missing = true
          }
          touched = true
        }
      }
    }
  }
  return touched
}

export function createLocalBoardStore(): BoardStore {
  let boards = withFavorites(load())
  const listeners = new Set<() => void>()
  // resolve stored blobs without blocking first paint
  void hydrate(boards).then((touched) => {
    if (touched) {
      boards = boards.slice()
      listeners.forEach((l) => l())
    }
  })
  const commit = () => {
    boards = withFavorites(boards) // keeps Favorites pinned first + new identity for React
    save(boards)
    listeners.forEach((l) => l())
    // an item saved a moment ago holds a bare `idb:` reference; resolve it now rather than on the
    // next reload, so the thumbnail shows straight away (only unresolved refs cost anything)
    void hydrate(boards).then((touched) => {
      if (touched) {
        boards = boards.slice()
        listeners.forEach((l) => l())
      }
    })
  }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      boards = withFavorites(load())
      listeners.forEach((l) => l())
    }
  })
  return {
    list: () => boards,
    create(name, id) {
      const existing = id && boards.find((x) => x.id === id)
      if (existing) return existing
      const b: Board = { id: id || Math.random().toString(36).slice(2, 10), name: name.trim() || 'Untitled board', createdAt: Date.now(), updatedAt: Date.now(), items: [] }
      boards = [b, ...boards]
      commit()
      return b
    },
    rename(id, name) {
      const b = boards.find((x) => x.id === id)
      if (!b) return
      b.name = name.trim() || b.name
      b.updatedAt = Date.now()
      commit()
    },
    remove(id) {
      if (id === FAVORITES_ID) return
      boards = boards.filter((x) => x.id !== id)
      commit()
    },
    addItems(id, items) {
      const b = boards.find((x) => x.id === id)
      if (!b) return 0
      const have = new Set(b.items.map((i) => i.id))
      let added = 0
      for (const it of items) {
        if (have.has(it.id)) continue
        b.items.push(it)
        have.add(it.id)
        added++
      }
      if (added) {
        b.updatedAt = Date.now()
        commit()
      }
      return added
    },
    upsertItem(id, item) {
      const b = boards.find((x) => x.id === id)
      if (!b) return 'added'
      const at = b.items.findIndex((i) => i.id === item.id)
      const mode: 'added' | 'updated' = at >= 0 ? 'updated' : 'added'
      if (at >= 0) b.items[at] = item
      else b.items.push(item)
      b.updatedAt = Date.now()
      commit()
      return mode
    },
    lastPersistError: () => persistError,
    removeItem(id, itemId) {
      const b = boards.find((x) => x.id === id)
      if (!b) return
      b.items = b.items.filter((i) => i.id !== itemId)
      b.updatedAt = Date.now()
      commit()
    },
    toggleFavorite(item) {
      const fav = boards.find((b) => b.id === FAVORITES_ID)!
      const had = fav.items.some((i) => i.id === item.id)
      if (had) fav.items = fav.items.filter((i) => i.id !== item.id)
      else fav.items.unshift(item)
      fav.updatedAt = Date.now()
      commit()
      return !had
    },
    isFavorite(id) {
      const fav = boards.find((b) => b.id === FAVORITES_ID)
      return !!fav?.items.some((i) => i.id === id)
    },
    setAll(next) {
      boards = withFavorites(next)
      commit()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export const boardStore = createLocalBoardStore()
