import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * query-mendable
 *
 * Minimal server-side bridge to Mendable's REST API.
 * - Reads `MENDABLE_API_KEY` from Supabase Edge Function secrets (or local env when running locally).
 * - Supports:
 *   - action: "chat" (default) -> POST https://api.mendable.ai/v1/mendableChat (preferred)
 *                                (falls back to /v1/chat, then /v1/newChat when needed)
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
type MendableConversationId = string | number;

type MendableHistoryItem = {
  prompt: string;
  response: string;
  sources?: unknown[];
};

type ChatRequest = {
  action?: MendableAction;
  question?: string;
  // Back-compat: older `query-mendable` accepted `{ query: string }`
  query?: string;
  history?: MendableHistoryItem[];
  conversation_id?: MendableConversationId;
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

function isConversationId(v: unknown): v is MendableConversationId {
  return typeof v === "string" || typeof v === "number";
}

function extractConversationIdFromMendableResponse(body: unknown): MendableConversationId | null {
  if (!body || typeof body !== "object") return null;
  const b = body as any;
  const candidates = [
    b.conversation_id,
    b.conversationId,
    b.result?.conversation_id,
    b.result?.conversationId,
    b.data?.conversation_id,
    b.data?.conversationId,
  ];
  for (const c of candidates) {
    if (typeof c === "number") return c;
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function extractAnswerFromMendableResponse(body: unknown): string | null {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return null;

  const b = body as any;

  const candidates = [
    b.answer,
    b.answer?.text,
    b.answer?.content,
    b.message,
    b.response,
    b.result,
    b.data?.answer,
    b.data?.answer?.text,
    b.data?.answer?.content,
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

async function mendablePostWithApiKeyHeader(path: string, apiKey: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.mendable.ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
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

  if (!res.ok) {
    return { ok: false as const, status: res.status, body: parsed };
  }

  return { ok: true as const, status: res.status, body: parsed };
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
    let r = await mendablePost("/v1/getSources", { api_key: apiKey });
    if (!r.ok && (r.status === 401 || r.status === 403 || r.status === 404)) {
      const rHeader = await mendablePostWithApiKeyHeader("/v1/getSources", apiKey, {});
      if (rHeader.ok) return jsonResponse({ success: true, result: rHeader.body });
      if (rHeader.status === 401 || rHeader.status === 403 || rHeader.status === 404) {
        const rBearer = await mendablePostWithBearer("/v1/getSources", apiKey, {});
        if (!rBearer.ok) return jsonResponse({ success: false, error: rBearer.body }, rBearer.status);
        return jsonResponse({ success: true, result: rBearer.body });
      }
      return jsonResponse({ success: false, error: rHeader.body }, rHeader.status);
    }
    if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);
    return jsonResponse({ success: true, result: r.body });
  }

  if (action === "newConversation") {
    let r = await mendablePost("/v1/newConversation", { api_key: apiKey });
    if (!r.ok && (r.status === 401 || r.status === 403 || r.status === 404)) {
      const rHeader = await mendablePostWithApiKeyHeader("/v1/newConversation", apiKey, {});
      if (rHeader.ok) {
        const convId = extractConversationIdFromMendableResponse(rHeader.body);
        return jsonResponse({ success: true, conversation_id: convId ?? undefined, result: rHeader.body });
      }
      if (rHeader.status === 401 || rHeader.status === 403 || rHeader.status === 404) {
        const rBearer = await mendablePostWithBearer("/v1/newConversation", apiKey, {});
        if (!rBearer.ok) return jsonResponse({ success: false, error: rBearer.body }, rBearer.status);
        const convId = extractConversationIdFromMendableResponse(rBearer.body);
        return jsonResponse({ success: true, conversation_id: convId ?? undefined, result: rBearer.body });
      }
      return jsonResponse({ success: false, error: rHeader.body }, rHeader.status);
    }
    if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);
    const convId = extractConversationIdFromMendableResponse(r.body);
    return jsonResponse({ success: true, conversation_id: convId ?? undefined, result: r.body });
  }

  // action === "chat"
  const question = (payload.question ?? payload.query ?? "").trim();
  if (!question) {
    return jsonResponse({ success: false, error: "question is required" }, 400);
  }

  const shouldStream = payload.shouldStream ?? false;

  const chatBody: Record<string, unknown> = {
    api_key: apiKey,
    question,
    shouldStream,
    // Mendable's /v1/mendableChat expects history (can be empty).
    history: Array.isArray(payload.history) ? payload.history : [],
  };

  if (isConversationId(payload.conversation_id)) chatBody.conversation_id = payload.conversation_id;
  if (typeof payload.temperature === "number") chatBody.temperature = payload.temperature;
  if (typeof payload.additional_context === "string") chatBody.additional_context = payload.additional_context;
  if (typeof payload.relevance_threshold === "number") chatBody.relevance_threshold = payload.relevance_threshold;
  if (payload.where && typeof payload.where === "object") chatBody.where = payload.where;

  if (typeof payload.num_chunks === "number") {
    chatBody.retriever_option = { num_chunks: payload.num_chunks };
  }

  // Mendable's `/v1/mendableChat` often requires a `conversation_id`. If the caller didn't provide one,
  // create a new conversation automatically.
  if (!isConversationId((chatBody as any).conversation_id)) {
    let conv = await mendablePost("/v1/newConversation", { api_key: apiKey });
    if (!conv.ok && (conv.status === 401 || conv.status === 403 || conv.status === 404)) {
      conv = await mendablePostWithApiKeyHeader("/v1/newConversation", apiKey, {});
    }
    if (!conv.ok && (conv.status === 401 || conv.status === 403 || conv.status === 404)) {
      conv = await mendablePostWithBearer("/v1/newConversation", apiKey, {});
    }
    if (conv.ok) {
      const convId = extractConversationIdFromMendableResponse(conv.body);
      if (isConversationId(convId)) (chatBody as any).conversation_id = convId;
    }
  }

  // Prefer current docs API (`/v1/mendableChat` with `api_key` in body).
  // If it fails with a status that suggests a different API version, fall back to `/v1/chat`,
  // then `/v1/newChat` (Bearer auth).
  let r = await mendablePost("/v1/mendableChat", chatBody);
  // If Mendable complains about missing required params, it's usually missing conversation_id. Retry once.
  if (!r.ok && r.status === 400 && !isConversationId((chatBody as any).conversation_id)) {
    const conv = await mendablePost("/v1/newConversation", { api_key: apiKey });
    if (conv.ok) {
      const convId = extractConversationIdFromMendableResponse(conv.body);
      if (isConversationId(convId)) {
        (chatBody as any).conversation_id = convId;
        r = await mendablePost("/v1/mendableChat", chatBody);
      }
    }
  }
  if (!r.ok && (r.status === 404 || r.status === 401 || r.status === 403)) {
    r = await mendablePost("/v1/chat", chatBody);
  }
  if (!r.ok && (r.status === 404 || r.status === 401 || r.status === 403)) {
    const conversationId = (chatBody as any).conversation_id;
    const newChatBody: Record<string, unknown> = {
      question,
      shouldStream,
      history: Array.isArray(payload.history) ? payload.history : [],
    };

    if (isConversationId(conversationId)) newChatBody.conversation_id = conversationId;
    if (typeof payload.temperature === "number") newChatBody.temperature = payload.temperature;
    if (typeof payload.additional_context === "string") newChatBody.additional_context = payload.additional_context;
    if (typeof payload.relevance_threshold === "number") newChatBody.relevance_threshold = payload.relevance_threshold;
    if (payload.where && typeof payload.where === "object") newChatBody.where = payload.where;
    if (typeof payload.num_chunks === "number") newChatBody.retriever_option = { num_chunks: payload.num_chunks };

    // Prefer a question-style payload (closest to mendableChat). If the API expects an OpenAI-style
    // messages payload, retry once.
    r = await mendablePostWithBearer("/v1/newChat", apiKey, newChatBody);
    if (!r.ok && r.status === 400) {
      const openAiStyleBody: Record<string, unknown> = {
        messages: [{ role: "user", content: question }],
        systemPrompt: "You are a helpful assistant providing automotive and vehicle related information.",
        temperature: typeof payload.temperature === "number" ? payload.temperature : 0.7,
        maxTokens: 750,
      };
      if (isConversationId(conversationId)) openAiStyleBody.conversation_id = conversationId;
      r = await mendablePostWithBearer("/v1/newChat", apiKey, openAiStyleBody);
    }
  }

  if (!r.ok) return jsonResponse({ success: false, error: r.body }, r.status);

  const conversationIdOut = (chatBody as any).conversation_id;
  return jsonResponse({
    success: true,
    // Back-compat for existing callers expecting `{ answer: string }`
    conversation_id: isConversationId(conversationIdOut) ? conversationIdOut : undefined,
    answer: extractAnswerFromMendableResponse(r.body) ?? "No response from AI",
    result: r.body,
  });
});

