// POST /api/upload-edit (binary PNG/JPEG body, signed-in users) → { url }
// Stores user-made edits in the Blob store so the "Edits" board can sync across devices.
import { handler, json, error } from './_lib/http.js'
import { sessionUser } from './_lib/auth.js'

export const config = { maxDuration: 60 }
const MAX_BYTES = 14 * 1024 * 1024
const MAX_PER_DAY = 80

const memCounts = new Map<string, number>()

export default handler(async (req: Request) => {
  if (req.method !== 'POST') return error('POST only', 405)
  const username = sessionUser(req)
  if (!username) return error('Sign in to save edits to your account.', 401)
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return error('Storage not configured', 501)
  const type = req.headers.get('content-type') || ''
  if (!/^image\/(png|jpeg|webp)$/.test(type)) return error('PNG, JPEG or WebP only')
  const buf = await req.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) return error('Edit is too large to save (14 MB limit).', 413)
  const day = new Date().toISOString().slice(0, 10)
  const used = (memCounts.get(day + username) || 0) + 1
  memCounts.set(day + username, used)
  if (used > MAX_PER_DAY) return error('Daily edit-save limit reached.', 429)
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
  const { put } = await import('@vercel/blob')
  const blob = await put(`edits/${username}/${Date.now()}.${ext}`, buf, { access: 'public', addRandomSuffix: false, contentType: type, token })
  return json({ url: blob.url }, { headers: { 'cache-control': 'no-store' } })
})
