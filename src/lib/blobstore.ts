// Images for locally saved edits live in IndexedDB, not in the boards' localStorage record.
//
// A single 1200px edit encoded as a data URL is roughly 3 MB of text, and localStorage caps out
// around 5 MB for the whole origin, so the second save used to blow the quota. Boards now store a
// short `idb:<key>` reference and the bytes go to IndexedDB, which is orders of magnitude larger.
// dedicated database: sharing the app's name risks opening one that already exists at this
// version without our store, and onupgradeneeded would never fire to create it
const DB = 'open-collections-edits'
const STORE = 'edit-blobs'
export const IDB_PREFIX = 'idb:'

let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

export async function putBlob(key: string, blob: Blob): Promise<boolean> {
  const db = await open()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      // resolve on transaction completion, not on the request: a request can succeed while the
      // transaction is still open, and navigating away then aborts the write
      const t = db.transaction(STORE, 'readwrite')
      t.objectStore(STORE).put(blob, key)
      t.oncomplete = () => resolve(true)
      t.onerror = () => resolve(false)
      t.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

export async function getBlob(key: string): Promise<Blob | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = tx(db, 'readonly').get(key)
      req.onsuccess = () => resolve((req.result as Blob) || null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function deleteBlob(key: string): Promise<void> {
  const db = await open()
  if (!db) return
  try {
    tx(db, 'readwrite').delete(key)
  } catch {
    /* nothing to clean up */
  }
}

// Object URLs are cached per key so repeated renders of the same board do not leak them.
const urls = new Map<string, string>()

export async function resolveRef(ref: string): Promise<string | null> {
  if (!ref.startsWith(IDB_PREFIX)) return ref
  const key = ref.slice(IDB_PREFIX.length)
  const cached = urls.get(key)
  if (cached) return cached
  const blob = await getBlob(key)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urls.set(key, url)
  return url
}

export const isRef = (url: string | null | undefined) => !!url && url.startsWith(IDB_PREFIX)
