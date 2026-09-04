// Accounts + cloud sync for boards/favorites. Local storage stays the source of truth for the UI;
// when signed in, changes are debounced-pushed to /api/userdata and merged down on sign-in/startup.
import { boardStore, mergeBoards, type Board } from './boards'
import { canvasStore, mergeCanvases, type CanvasDoc } from './canvas'

export interface AuthState {
  user: string | null
  syncing: boolean
  error: string | null
}

type Listener = (s: AuthState) => void
const listeners = new Set<Listener>()
const state: AuthState = { user: null, syncing: false, error: null }
let unsubscribe: (() => void) | null = null
let pushTimer = 0
let dirty = false

function emit() {
  listeners.forEach((l) => l({ ...state }))
}

export function onAuthChange(fn: Listener): () => void {
  listeners.add(fn)
  fn({ ...state })
  return () => listeners.delete(fn)
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

async function pushNow(): Promise<void> {
  if (!state.user) return
  dirty = false
  state.syncing = true
  emit()
  try {
    await api('/api/userdata', { method: 'PUT', body: JSON.stringify({ data: { boards: boardStore.list(), canvases: canvasStore.list() } }) })
    state.error = null
  } catch (e) {
    state.error = 'Sync failed — changes are saved in this browser and will retry.'
    dirty = true
  } finally {
    state.syncing = false
    emit()
  }
}

function schedulePush() {
  if (!state.user) return
  dirty = true
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(pushNow, 1500)
}

async function startSync() {
  try {
    const remote = await api('/api/userdata')
    const remoteBoards: Board[] = Array.isArray(remote?.data?.boards) ? remote.data.boards : []
    boardStore.setAll(mergeBoards(boardStore.list(), remoteBoards))
    const remoteCanvases: CanvasDoc[] = Array.isArray(remote?.data?.canvases) ? remote.data.canvases : []
    canvasStore.setAll(mergeCanvases(canvasStore.list(), remoteCanvases))
  } catch {
    /* keep local; pushes will retry */
  }
  unsubscribe?.()
  const u1 = boardStore.subscribe(schedulePush)
  const u2 = canvasStore.subscribe(schedulePush)
  unsubscribe = () => {
    u1()
    u2()
  }
  void pushNow()
}

function stopSync() {
  unsubscribe?.()
  unsubscribe = null
  window.clearTimeout(pushTimer)
}

export async function restoreSession(): Promise<string | null> {
  try {
    const r = await api('/api/auth')
    if (r?.user) {
      state.user = r.user
      emit()
      await startSync()
    }
    return state.user
  } catch {
    return null
  }
}

export async function signIn(action: 'login' | 'signup', username: string, password: string): Promise<void> {
  const r = await api('/api/auth', { method: 'POST', body: JSON.stringify({ action, username, password }) })
  state.user = r.user
  state.error = null
  emit()
  await startSync()
}

export async function signOut(): Promise<void> {
  stopSync()
  await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }).catch(() => {})
  state.user = null
  emit()
}

// Flush pending changes when the tab is hidden/closed.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty && state.user) {
      const payload = new Blob([JSON.stringify({ data: { boards: boardStore.list(), canvases: canvasStore.list() } })], { type: 'application/json' })
      navigator.sendBeacon('/api/userdata', payload)
      dirty = false
    }
  })
}
