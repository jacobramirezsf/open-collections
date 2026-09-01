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
  subscribe(fn: () => void): () => void
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
  let boards = load()
  const listeners = new Set<() => void>()
  const commit = () => {
    boards = boards.slice() // new identity for React
    save(boards)
    listeners.forEach((l) => l())
  }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      boards = load()
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
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export const boardStore = createLocalBoardStore()
