// Supabase Edge Function: openai-proxy
// Purpose: Forward Chat Completions requests to OpenAI without exposing client keys.
// Runtime: Deno (Supabase Functions)
// Secrets to set in Supabase: OPENAI_API_KEY (required), OPENAI_ORG (optional), OPENAI_PROJECT (optional)

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Model fallback map for when OpenAI project doesn't have access to certain models
const MODEL_FALLBACKS: Record<string, string[]> = {
  'gpt-4o-mini': ['gpt-3.5-turbo', 'gpt-4o'],
  'gpt-4-turbo': ['gpt-4o', 'gpt-3.5-turbo'],
};

function corsHeaders(origin?: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400'
  };
}

async function makeOpenAIRequest(
  apiKey: string,
  body: any,
  headers: HeadersInit
): Promise<{ text: string; status: number; needsFallback: boolean }> {
  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const text = await resp.text();
  
  // Check if this is a model access error that we should retry with fallback
  const needsFallback = !resp.ok && text.includes('model_not_found') && text.includes('does not have access');
  
  return { text, status: resp.status, needsFallback };
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

  // Server-side secrets (support both naming conventions)
  const apiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('OPEN_AI_API_KEY');
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
    const originalModel = body.model;
    let result = await makeOpenAIRequest(apiKey, body, headers);
    
    // If model access failed and we have fallbacks, try them
    if (result.needsFallback && MODEL_FALLBACKS[originalModel]) {
      console.log(`Model ${originalModel} not accessible, trying fallbacks...`);
      
      for (const fallbackModel of MODEL_FALLBACKS[originalModel]) {
        console.log(`Trying fallback model: ${fallbackModel}`);
        const fallbackBody = { ...body, model: fallbackModel };
        result = await makeOpenAIRequest(apiKey, fallbackBody, headers);
        
        if (!result.needsFallback) {
          console.log(`Fallback to ${fallbackModel} succeeded`);
          // Add a header to indicate fallback was used
          return new Response(result.text, {
            status: result.status,
            headers: { 
              'Content-Type': 'application/json', 
              'X-Model-Fallback': `${originalModel} -> ${fallbackModel}`,
              ...corsHeaders(origin) 
            }
          });
        }
      }
    }

    // Pass through status and body
    return new Response(result.text, {
      status: result.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream request failed', details: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }
});
