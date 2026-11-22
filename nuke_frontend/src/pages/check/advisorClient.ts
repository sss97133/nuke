/**
 * The /check page calls the Nuke Asset Advisor exactly as an anonymous visitor's MCP client would:
 * a JSON-RPC tools/call POST to the same-origin /mcp/advisor rewrite (vercel.json → mcp-connector), with no
 * credential. The server answers in its public scope (public records only, Bring a Trailer only, nothing written).
 */
export type AdvisorResult = {
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export class AdvisorError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

const ENDPOINT = '/mcp/advisor';

/** The body is JSON, or a Streamable-HTTP SSE frame ("event: message\ndata: {…}"). */
export function parseRpcBody(text: string): { result?: AdvisorResult; error?: { message?: string } } {
  const trimmed = text.trim();
  const dataLine = trimmed.startsWith('{') ? trimmed : trimmed.split('\n').find(l => l.startsWith('data:'))?.slice(5).trim();
  if (!dataLine) throw new AdvisorError('The advisor sent an answer this page could not read.');
  return JSON.parse(dataLine);
}

let nextId = 1;

export async function callAdvisor(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<AdvisorResult> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
    signal,
  });
  const text = await res.text();
  if (res.status === 429) throw new AdvisorError('Too many checks from this connection. Try again in a minute.', 429);
  if (!res.ok) throw new AdvisorError(`The advisor did not answer (HTTP ${res.status}).`, res.status);
  const body = parseRpcBody(text);
  if (body.error) throw new AdvisorError(body.error.message || 'The advisor could not answer this request.');
  if (!body.result) throw new AdvisorError('The advisor sent an empty answer.');
  return body.result;
}
