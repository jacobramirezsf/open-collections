// Boards live in localStorage for V1. The BoardStore interface is the seam for a future cloud-synced store.
import type { Item } from '../../shared/types'

export interface Board {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  items: Item[]
}

export interface BoardStore {
  list(): Board[]
  create(name: string): Board
  rename(id: string, name: string): void
  remove(id: string): void
  addItems(id: string, items: Item[]): number
  removeItem(id: string, itemId: string): void
  toggleFavorite(item: Item): boolean // returns new state
  isFavorite(id: string): boolean
  setAll(boards: Board[]): void // used by cloud sync (merge result)
  subscribe(fn: () => void): () => void
}

export const FAVORITES_ID = 'favorites'

function withFavorites(boards: Board[]): Board[] {
  let fav = boards.find((b) => b.id === FAVORITES_ID)
  if (!fav) {
    fav = { id: FAVORITES_ID, name: 'Favorites', createdAt: 0, updatedAt: 0, items: [] }
    boards = [fav, ...boards]
  }
  return [fav, ...boards.filter((b) => b.id !== FAVORITES_ID)]
}

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

function save(boards: Board[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(boards))
  } catch (e) {
    console.warn('Could not save boards', e)
  }
}

export function createLocalBoardStore(): BoardStore {
  let boards = withFavorites(load())
  const listeners = new Set<() => void>()
  const commit = () => {
    boards = boards.slice() // new identity for React
    save(boards)
    listeners.forEach((l) => l())
  }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      boards = withFavorites(load())
      listeners.forEach((l) => l())
    }
  })
  return {
    list: () => boards,
    create(name) {
      const b: Board = { id: Math.random().toString(36).slice(2, 10), name: name.trim() || 'Untitled board', createdAt: Date.now(), updatedAt: Date.now(), items: [] }
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
