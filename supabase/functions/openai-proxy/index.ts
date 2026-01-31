// Supabase Edge Function: openai-proxy
// Purpose: Forward Chat Completions requests with automatic model fallback
// Supports: OpenAI (gpt-4o, gpt-3.5-turbo) and Anthropic Claude as fallback

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Model fallback order
const OPENAI_FALLBACK_MODELS = ['gpt-4o', 'gpt-3.5-turbo', 'gpt-4'];

function corsHeaders(origin?: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400'
  };
}

// Convert OpenAI format to Anthropic format
function convertToAnthropicFormat(openaiBody: any): any {
  const messages = openaiBody.messages || [];
  let systemPrompt = '';
  const anthropicMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else {
      anthropicMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }
  }

  return {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: openaiBody.max_tokens || 1024,
    system: systemPrompt || undefined,
    messages: anthropicMessages
  };
}

// Convert Anthropic response to OpenAI format
function convertFromAnthropicFormat(anthropicResponse: any): any {
  return {
    id: anthropicResponse.id,
    object: 'chat.completion',
    created: Date.now(),
    model: anthropicResponse.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: anthropicResponse.content?.[0]?.text || ''
      },
      finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' : anthropicResponse.stop_reason
    }],
    usage: {
      prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
      completion_tokens: anthropicResponse.usage?.output_tokens || 0,
      total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0)
    },
    _provider: 'anthropic'
  };
}

async function tryOpenAI(body: any, apiKey: string, org?: string, project?: string): Promise<{ success: boolean; response?: Response; error?: string }> {
  const modelsToTry = body.model ? [body.model, ...OPENAI_FALLBACK_MODELS.filter(m => m !== body.model)] : OPENAI_FALLBACK_MODELS;
  
  const headers: HeadersInit = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  if (org) headers['OpenAI-Organization'] = org;
  if (project) headers['OpenAI-Project'] = project;

  for (const model of modelsToTry) {
    try {
      console.log(`[openai-proxy] Trying OpenAI model: ${model}`);
      const requestBody = { ...body, model };
      
      const resp = await fetch(OPENAI_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (resp.ok) {
        console.log(`[openai-proxy] Success with model: ${model}`);
        return { success: true, response: resp };
      }

      const errorText = await resp.text();
      console.log(`[openai-proxy] Model ${model} failed: ${resp.status} - ${errorText}`);
      
      // If it's a project restriction or model access issue, try next model
      if (resp.status === 403 || resp.status === 404 || errorText.includes('does not have access')) {
        continue;
      }
      
      // For other errors (rate limit, etc), return the error
      return { success: false, error: errorText };
    } catch (err) {
      console.log(`[openai-proxy] Error with model ${model}: ${err}`);
      continue;
    }
  }
  
  return { success: false, error: 'All OpenAI models failed' };
}

async function tryAnthropic(body: any, apiKey: string): Promise<{ success: boolean; response?: any; error?: string }> {
  try {
    console.log('[openai-proxy] Falling back to Anthropic Claude');
    const anthropicBody = convertToAnthropicFormat(body);
    
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody)
    });

    if (resp.ok) {
      const data = await resp.json();
      console.log('[openai-proxy] Anthropic Claude succeeded');
      return { success: true, response: convertFromAnthropicFormat(data) };
    }

    const errorText = await resp.text();
    console.log(`[openai-proxy] Anthropic failed: ${resp.status} - ${errorText}`);
    return { success: false, error: errorText };
  } catch (err) {
    console.log(`[openai-proxy] Anthropic error: ${err}`);
    return { success: false, error: String(err) };
  }
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

  // Server-side secrets - try multiple env var names
  const openaiKey = Deno.env.get('OPEN_AI_API_KEY') || Deno.env.get('OPENAI_API_KEY');
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('anthropic_api_key');
  const org = Deno.env.get('OPENAI_ORG');
  const project = Deno.env.get('OPENAI_PROJECT');

  if (!openaiKey && !anthropicKey) {
    return new Response(JSON.stringify({ error: 'No LLM API keys configured on server' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body', details: String(e) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  // Minimal guard: ensure messages exist
  if (!body || !Array.isArray(body.messages)) {
    return new Response(JSON.stringify({ error: 'Missing required field: messages' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  // Set default model if not provided
  if (!body.model) {
    body.model = 'gpt-4o';
  }

  // Try OpenAI first
  if (openaiKey) {
    const result = await tryOpenAI(body, openaiKey, org, project);
    if (result.success && result.response) {
      const text = await result.response.text();
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }
    console.log(`[openai-proxy] OpenAI failed: ${result.error}`);
  }

  // Fall back to Anthropic
  if (anthropicKey) {
    const result = await tryAnthropic(body, anthropicKey);
    if (result.success && result.response) {
      return new Response(JSON.stringify(result.response), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }
    console.log(`[openai-proxy] Anthropic failed: ${result.error}`);
  }

  // All providers failed
  return new Response(JSON.stringify({ 
    error: 'All LLM providers failed', 
    details: 'Tried OpenAI (gpt-4o, gpt-3.5-turbo, gpt-4) and Anthropic Claude' 
  }), {
    status: 502,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
});
