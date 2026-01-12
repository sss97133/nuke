import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * query-mendable-v2
 *
 * Newer Mendable bridge (kept separate because the older `query-mendable` function
 * appears to be deployed from a legacy pipeline that may not accept updates).
 *
 * This implementation is API-version tolerant:
 * - Tries `POST https://api.mendable.ai/v1/chat` (api_key in JSON body)
 * - Falls back to `POST https://api.mendable.ai/v1/newChat` (Bearer auth)
 *
 * For back-compat, it accepts both:
 * - `{ question: string }`
 * - `{ query: string }`
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
  query?: string;
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

function extractAnswerFromMendableResponse(body: unknown): string | null {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return null;

  const b = body as any;
  const candidates = [
    b.answer,
    b.message,
    b.response,
    b.result,
    b.data?.answer,
    b.data?.message,
    b.data?.response,
    b.data?.result,
    b.message?.content,
    b.data?.message?.content,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }

  return null;
}

async function mendablePost(path: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.mendable.ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep as string
  }

  if (!res.ok) return { ok: false as const, status: res.status, body: parsed };
  return { ok: true as const, status: res.status, body: parsed };
}

async function mendablePostWithBearer(path: string, apiKey: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.mendable.ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep as string
  }

  if (!res.ok) return { ok: false as const, status: res.status, body: parsed };
  return { ok: true as const, status: res.status, body: parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "POST required" }, 405);

  const apiKey = Deno.env.get("MENDABLE_API_KEY") ?? "";
  if (!apiKey) return jsonResponse({ success: false, error: "MENDABLE_API_KEY not configured" }, 500);

  let payload: ChatRequest;
  try {
    payload = (await req.json()) as ChatRequest;
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action: MendableAction = payload.action ?? "chat";

  if (action === "getSources") {
    const r = await mendablePost("/v1/getSources", { api_key: apiKey });
    if (!r.ok && (r.status === 401 || r.status === 403 || r.status === 404)) {
      const r2 = await mendablePostWithBearer("/v1/getSources", apiKey, {});
      if (!r2.ok) return jsonResponse({ success: false, error: r2.body }, r2.status);
      return jsonResponse({ success: true, result: r2.body });
    }
    if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);
    return jsonResponse({ success: true, result: r.body });
  }

  if (action === "newConversation") {
    const r = await mendablePost("/v1/newConversation", { api_key: apiKey });
    if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);
    return jsonResponse({ success: true, result: r.body });
  }

  const question = (payload.question ?? payload.query ?? "").trim();
  if (!question) return jsonResponse({ success: false, error: "question is required" }, 400);

  const shouldStream = payload.shouldStream ?? false;

  const chatBody: Record<string, unknown> = {
    api_key: apiKey,
    question,
    shouldStream,
  };

  if (payload.history) chatBody.history = payload.history;
  if (typeof payload.conversation_id === "number") chatBody.conversation_id = payload.conversation_id;
  if (typeof payload.temperature === "number") chatBody.temperature = payload.temperature;
  if (typeof payload.additional_context === "string") chatBody.additional_context = payload.additional_context;
  if (typeof payload.relevance_threshold === "number") chatBody.relevance_threshold = payload.relevance_threshold;
  if (payload.where && typeof payload.where === "object") chatBody.where = payload.where;
  if (typeof payload.num_chunks === "number") chatBody.retriever_option = { num_chunks: payload.num_chunks };

  let r = await mendablePost("/v1/chat", chatBody);
  if (!r.ok && (r.status === 404 || r.status === 401 || r.status === 403)) {
    r = await mendablePostWithBearer("/v1/newChat", apiKey, {
      messages: [{ role: "user", content: question }],
      systemPrompt: "You are a helpful assistant providing automotive and vehicle related information.",
      temperature: typeof payload.temperature === "number" ? payload.temperature : 0.7,
      maxTokens: 750,
    });
  }

  if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);

  return jsonResponse({
    success: true,
    answer: extractAnswerFromMendableResponse(r.body) ?? "No response from AI",
    result: r.body,
  });
});

