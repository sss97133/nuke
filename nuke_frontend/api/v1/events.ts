/**
 * Vercel serverless proxy for POST /v1/events.
 *
 * Forwards POST/OPTIONS to the Supabase edge function `api-v1-events`.
 * Forwards X-API-Key, Authorization, Content-Type headers; returns
 * upstream response status and body verbatim.
 *
 * Routed by vercel.json: `/v1/events` → `/api/v1/events`.
 *
 * @owner workstream B (endpoint)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_FN_URL =
  'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-events';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, X-API-Key',
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. POST only.' });
  }

  // Build upstream headers — forward only what's needed.
  const headers: Record<string, string> = {
    'Content-Type':
      (req.headers['content-type'] as string | undefined) || 'application/json',
  };
  const authHeader = req.headers.authorization;
  if (authHeader) headers['Authorization'] = authHeader;
  const apiKey = req.headers['x-api-key'];
  if (apiKey) headers['X-API-Key'] = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  const accept = req.headers.accept;
  if (accept) headers['Accept'] = Array.isArray(accept) ? accept[0] : accept;

  // Body — Vercel parses JSON automatically when content-type matches.
  let body: string;
  if (req.body === undefined || req.body === null) {
    body = '';
  } else if (typeof req.body === 'string') {
    body = req.body;
  } else {
    body = JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(SUPABASE_FN_URL, {
      method: 'POST',
      headers,
      body,
    });

    // Forward rate-limit and content headers
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const rlRemaining = upstream.headers.get('x-ratelimit-remaining');
    if (rlRemaining) res.setHeader('X-RateLimit-Remaining', rlRemaining);
    const rlReset = upstream.headers.get('x-ratelimit-reset');
    if (rlReset) res.setHeader('X-RateLimit-Reset', rlReset);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.setHeader('Retry-After', retryAfter);

    const text = await upstream.text();
    return res.status(upstream.status).send(text);
  } catch (err) {
    return res.status(502).json({
      error: 'Upstream proxy error',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
