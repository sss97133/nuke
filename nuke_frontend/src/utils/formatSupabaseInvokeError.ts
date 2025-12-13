export async function formatSupabaseInvokeError(err: any): Promise<string> {
  const status = err?.context?.status
  const rawMsg = err?.message ? String(err.message) : (status ? `Edge Function error ${status}` : 'Edge Function error')
  // supabase-js sometimes puts the ReadableStream into err.message as "[object ReadableStream]".
  // Strip that so we can replace with actual body text below.
  const msg = rawMsg.includes('[object ReadableStream]')
    ? rawMsg.replace(/\s*:\s*\[object ReadableStream\]\s*/g, '').trim()
    : rawMsg

  const body = err?.context?.body

  // supabase-js sometimes surfaces Response body as a ReadableStream; make it human readable.
  try {
    // ReadableStream
    if (body && typeof body === 'object' && typeof (body as any).getReader === 'function') {
      const text = await new Response(body as any).text()
      if (text) return `${msg}: ${text}`
    }

    // Response-like
    if (body && typeof body === 'object' && typeof (body as any).text === 'function') {
      const text = await (body as any).text()
      if (text) return `${msg}: ${text}`
    }

    // ArrayBuffer / Uint8Array
    if (body instanceof ArrayBuffer) {
      const text = new TextDecoder().decode(new Uint8Array(body))
      if (text) return `${msg}: ${text}`
    }
    if (typeof Uint8Array !== 'undefined' && body instanceof Uint8Array) {
      const text = new TextDecoder().decode(body)
      if (text) return `${msg}: ${text}`
    }
  } catch {
    // ignore
  }

  if (typeof body === 'string') return body ? `${msg}: ${body}` : msg

  try {
    if (body && typeof body === 'object') return `${msg}: ${JSON.stringify(body)}`
  } catch {
    // ignore
  }

  return msg
}



