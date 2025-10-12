// Supabase Edge Function: openai-proxy
// Purpose: Forward Chat Completions requests to OpenAI without exposing client keys.
// Runtime: Deno (Supabase Functions)
// Secrets to set in Supabase: OPENAI_API_KEY (required), OPENAI_ORG (optional), OPENAI_PROJECT (optional)

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function corsHeaders(origin?: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400'
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '*';

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  // Server-side secrets
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured on server' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }
  const org = Deno.env.get('OPENAI_ORG');
  const project = Deno.env.get('OPENAI_PROJECT');

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body', details: String(e) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  // Minimal guard: ensure messages & model exist
  if (!body || !Array.isArray(body.messages) || !body.model) {
    return new Response(JSON.stringify({ error: 'Missing required fields: model, messages' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  // Forward to OpenAI
  const headers: HeadersInit = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  if (org) headers['OpenAI-Organization'] = org;
  if (project) headers['OpenAI-Project'] = project;

  try {
    const resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const text = await resp.text();

    // Pass through status and body
    return new Response(text, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream request failed', details: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }
});
