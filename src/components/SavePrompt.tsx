// One-tap "Save to Photos" prompt, shown when a render or download finished after the original
// tap's activation expired (iOS will only open the share sheet from inside a gesture).
import { useEffect, useState } from 'react'
import { clearPendingSave, subscribePendingSave, type PendingSave } from '../lib/save'

export default function SavePrompt() {
  const [pending, setPending] = useState<PendingSave | null>(null)
  useEffect(() => subscribePendingSave(setPending), [])
  if (!pending) return null
  const mb = pending.blob.size / 1e6
  return (
    <>
      <div className="backdrop" style={{ zIndex: 92 }} onClick={clearPendingSave} />
      <div className="save-prompt" role="dialog" aria-modal="true">
        <p className="save-prompt-title">Your image is ready</p>
        <p className="faint" style={{ margin: '0 0 12px', fontSize: 12 }}>
          {pending.filename} · {mb < 1 ? `${Math.round(mb * 1000)} KB` : `${mb.toFixed(1)} MB`}
        </p>
        <button className="btn primary" onClick={() => void pending.share()}>Save to Photos</button>
        <button className="btn" style={{ marginTop: 8 }} onClick={pending.download}>Save to Files</button>
        <button className="btn link" style={{ marginTop: 6 }} onClick={clearPendingSave}>Cancel</button>
      </div>
    </>
  )
}
