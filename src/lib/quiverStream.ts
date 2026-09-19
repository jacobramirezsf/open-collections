// Reading QuiverAI's vectorization stream (proxied by /api/vectorize with stream: true).
//
// The body is server-sent events: each frame is an `event:` line (generating | reasoning | draft |
// content | error) plus a `data:` line of JSON, frames end with a blank line, and the stream ends
// with `data: [DONE]`. A draft carries partial SVG markup, either a delta to append to the previous
// draft or a snapshot that replaces it; the content event carries the finished SVG.

export interface StreamEvent {
  event: string
  data: any
}

// Parses SSE frames out of a fetch body, yielding each one as it arrives.
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      if (signal?.aborted) return
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let cut: number
      // frames are separated by a blank line (\n\n or \r\n\r\n)
      while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
        const frame = buf.slice(0, cut)
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, '')
        const ev = parseFrame(frame)
        if (ev) {
          if (ev.data === '[DONE]') return
          yield ev
        }
      }
    }
    const tail = parseFrame(buf)
    if (tail && tail.data !== '[DONE]') yield tail
  } finally {
    reader.releaseLock()
  }
}

function parseFrame(frame: string): StreamEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const raw of frame.split(/\r?\n/)) {
    if (!raw || raw.startsWith(':')) continue
    const i = raw.indexOf(':')
    const field = i < 0 ? raw : raw.slice(0, i)
    const value = i < 0 ? '' : raw.slice(i + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  const text = data.join('\n')
  if (text.trim() === '[DONE]') return { event, data: '[DONE]' }
  try {
    const parsed = JSON.parse(text)
    // the payload's own `type` is the phase; trust it over the event line when they disagree
    return { event: typeof parsed?.type === 'string' ? parsed.type : event, data: parsed }
  } catch {
    return { event, data: text }
  }
}

// Folds a draft event into the SVG built so far.
export function applyDraft(prev: string, data: { svg?: string; update_type?: 'delta' | 'snapshot' }): string {
  const svg = typeof data?.svg === 'string' ? data.svg : ''
  if (data?.update_type === 'delta') return prev + svg
  // a snapshot replaces; an untyped draft that clearly starts a document does too, else it appends
  if (data?.update_type === 'snapshot' || /^\s*(<\?xml|<!DOCTYPE|<svg)/i.test(svg) || !prev) return svg
  return prev + svg
}

const VOID_OR_META = /^(\?|!)/

// Turns half-written SVG markup into something an <img> can draw: drop the unfinished tag at the
// end, then close every element still open. Returns null until an <svg> root has arrived.
export function closePartialSvg(partial: string): string | null {
  const start = partial.search(/<svg[\s>]/i)
  if (start < 0) return null
  let s = partial.slice(start)
  // an unfinished tag or an unclosed comment at the end cannot be parsed; cut back to the last '>'
  const lastOpen = s.lastIndexOf('<')
  const lastClose = s.lastIndexOf('>')
  if (lastOpen > lastClose) s = s.slice(0, lastOpen)
  const cmt = s.lastIndexOf('<!--')
  if (cmt >= 0 && s.indexOf('-->', cmt) < 0) s = s.slice(0, cmt)
  const stack: string[] = []
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const [, closing, name, attrs] = m
    if (VOID_OR_META.test(name)) continue
    if (closing) {
      const i = stack.lastIndexOf(name)
      if (i >= 0) stack.length = i
    } else if (!/\/\s*$/.test(attrs)) stack.push(name)
  }
  if (!stack.length || stack[0].toLowerCase() !== 'svg') {
    // the root closed already (a snapshot of a finished document) or nothing usable yet
    return /<\/svg>\s*$/i.test(s) ? s : stack.length ? s + stack.reverse().map((n) => `</${n}>`).join('') : null
  }
  return s + stack.reverse().map((n) => `</${n}>`).join('')
}
