// Serves nuke.ag/oauth/* (the MCP connector sign-in) from the oauth-server edge function.
//
// Why a function and not a plain rewrite: Supabase serves HTML from *.supabase.co functions as text/plain, so the
// authorize page, the "check your email" page and the callback page reached the browser as raw source (measured
// 2026-10-01: GET /functions/v1/oauth-server/oauth/authorize -> 200 content-type text/plain, though the function sets
// text/html). This forwards the request unchanged and re-labels HTML responses as text/html on nuke.ag. Redirects,
// JSON and status codes pass through as they are.

const UPSTREAM = 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/oauth-server/oauth/';

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://nuke.ag');
  const path = (url.searchParams.get('p') || '').replace(/^\/+/, '');
  url.searchParams.delete('p');
  if (!/^[a-z0-9_\-/]*$/i.test(path)) {
    res.status(400).send('bad path');
    return;
  }

  const headers = {};
  for (const name of ['content-type', 'cookie', 'authorization', 'accept']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const qs = url.searchParams.toString();
  const upstream = await fetch(UPSTREAM + path + (qs ? `?${qs}` : ''), {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req),
    redirect: 'manual',
  });

  const body = Buffer.from(await upstream.arrayBuffer());
  const type = upstream.headers.get('content-type') || '';
  const looksHtml = /^\s*<(!doctype html|html)/i.test(body.subarray(0, 64).toString('utf8'));

  res.status(upstream.status);
  for (const name of ['location', 'set-cookie', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader('content-type', looksHtml ? 'text/html; charset=utf-8' : type || 'application/octet-stream');
  res.send(body);
}
