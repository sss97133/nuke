import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * query-mendable
 *
 * Minimal server-side bridge to Mendable's REST API.
 * - Reads `MENDABLE_API_KEY` from Supabase Edge Function secrets (or local env when running locally).
 * - Supports:
 *   - action: "chat" (default) -> POST https://api.mendable.ai/v1/chat
 *   - action: "getSources"     -> POST https://api.mendable.ai/v1/getSources
 *   - action: "newConversation"-> POST https://api.mendable.ai/v1/newConversation
 *
 * NOTE: We default to non-streaming responses (shouldStream=false) for easy consumption.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MendableAction = "chat" | "getSources" | "newConversation";

type MendableHistoryItem = {
  prompt: string;
  response: string;
  sources?: unknown[];
};

type ChatRequest = {
  action?: MendableAction;
  question?: string;
  history?: MendableHistoryItem[];
  conversation_id?: number;
  temperature?: number;
  additional_context?: string;
  relevance_threshold?: number;
  where?: Record<string, unknown>;
  num_chunks?: number;
  shouldStream?: boolean;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function mendablePost(path: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.mendable.ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  // Mendable might return JSON or text errors. Parse when possible.
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep as string
  }

  if (!res.ok) {
    return {
      ok: false as const,
      status: res.status,
      body: parsed,
    };
  }

  return {
    ok: true as const,
    status: res.status,
    body: parsed,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "POST required" }, 405);
  }

  const apiKey = Deno.env.get("MENDABLE_API_KEY") ?? "";
  if (!apiKey) {
    return jsonResponse(
      {
        success: false,
        error:
          "MENDABLE_API_KEY not configured. Set it in Supabase Dashboard → Edge Functions → Secrets (or local env for local runs).",
      },
      500,
    );
  }

  let payload: ChatRequest;
  try {
    payload = (await req.json()) as ChatRequest;
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action: MendableAction = payload.action ?? "chat";

  if (action === "getSources") {
    const r = await mendablePost("/v1/getSources", { api_key: apiKey });
    if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);
    return jsonResponse({ success: true, result: r.body });
  }

  if (action === "newConversation") {
    const r = await mendablePost("/v1/newConversation", { api_key: apiKey });
    if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);
    return jsonResponse({ success: true, result: r.body });
  }

  // action === "chat"
  if (!payload.question || typeof payload.question !== "string") {
    return jsonResponse({ success: false, error: "question is required" }, 400);
  }

  const shouldStream = payload.shouldStream ?? false;

  const chatBody: Record<string, unknown> = {
    api_key: apiKey,
    question: payload.question,
    shouldStream,
  };

  if (payload.history) chatBody.history = payload.history;
  if (typeof payload.conversation_id === "number") chatBody.conversation_id = payload.conversation_id;
  if (typeof payload.temperature === "number") chatBody.temperature = payload.temperature;
  if (typeof payload.additional_context === "string") chatBody.additional_context = payload.additional_context;
  if (typeof payload.relevance_threshold === "number") chatBody.relevance_threshold = payload.relevance_threshold;
  if (payload.where && typeof payload.where === "object") chatBody.where = payload.where;

  if (typeof payload.num_chunks === "number") {
    chatBody.retriever_option = { num_chunks: payload.num_chunks };
  }

  const r = await mendablePost("/v1/chat", chatBody);
  if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);

  return jsonResponse({ success: true, result: r.body });
});

