export async function formatSupabaseInvokeError(err: any): Promise<string> {
  const status = err?.context?.status
  const msg = err?.message ? String(err.message) : (status ? `Edge Function error ${status}` : 'Edge Function error')
  const body = err?.context?.body

  // supabase-js sometimes surfaces Response body as a ReadableStream; make it human readable.
  try {
    if (body && typeof body === 'object' && typeof (body as any).getReader === 'function') {
      const text = await new Response(body as any).text()
      return text ? `${msg}: ${text}` : msg
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



