// Saving one image on a phone should offer Photos, not bury it in Files.
//
// An <a download> always lands in Files on iOS, so a single image goes through the share sheet
// instead ("Save Image" → Photos). The catch is that iOS only allows navigator.share during a user
// gesture, and by the time a render or a network fetch finishes the tap's activation is usually
// gone, so the call throws. Rather than silently dropping back to a Files download, we surface a
// one-tap "Save to Photos" prompt and share from inside that fresh tap.
import { saveBlob } from './zip'

export const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

export interface PendingSave {
  blob: Blob
  filename: string
  share: () => Promise<void>
  download: () => void
}

type Listener = (p: PendingSave | null) => void
const listeners = new Set<Listener>()
let pending: PendingSave | null = null

export function subscribePendingSave(fn: Listener): () => void {
  listeners.add(fn)
  fn(pending)
  return () => listeners.delete(fn)
}

function setPending(p: PendingSave | null) {
  pending = p
  listeners.forEach((l) => l(pending))
}

export function clearPendingSave() {
  setPending(null)
}

const canShareFile = (file: File) => typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [file] })

/**
 * Save a single image. On touch devices this opens the share sheet so the image can go straight to
 * Photos; if the tap's activation has already expired, it queues a one-tap prompt instead of
 * quietly writing to Files. On desktop it downloads.
 */
export async function saveImage(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'prompted'> {
  const file = new File([blob], filename, { type: blob.type || 'image/png' })
  if (!isTouch() || !canShareFile(file)) {
    saveBlob(blob, filename)
    return 'downloaded'
  }
  // files-only payload: adding a title makes iOS treat it as a mixed share and bury "Save Image"
  try {
    await navigator.share({ files: [file] })
    return 'shared'
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'shared' // the user closed the sheet
    setPending({
      blob,
      filename,
      share: async () => {
        try {
          await navigator.share({ files: [new File([blob], filename, { type: file.type })] })
        } finally {
          setPending(null)
        }
      },
      download: () => {
        saveBlob(blob, filename)
        setPending(null)
      },
    })
    return 'prompted'
  }
}
