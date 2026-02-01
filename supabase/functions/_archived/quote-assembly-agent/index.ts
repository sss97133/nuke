// Supabase Edge Function: quote-assembly-agent
// Purpose: Run quote-assembly prompting with user-selectable LLM provider/model.
// Reads provider API keys from Supabase Function secrets (system) and optionally user keys via DB.
//
// Secrets expected:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY depending on your repo conventions)
// - OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_AI_API_KEY (system defaults)
//
// Deploy:
//   supabase functions deploy quote-assembly-agent

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

import { callLLM, getLLMConfig, type LLMProvider } from "../_shared/llmProvider.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  ""

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const parseBearer = (req: Request) => {
  const header = req.headers.get("authorization") || ""
  if (!header.toLowerCase().startsWith("bearer ")) return null
  const token = header.slice("bearer ".length).trim()
  return token.length > 0 ? token : null
}

async function getUserIdFromToken(token: string | null): Promise<string | null> {
  if (!token || !SUPABASE_URL) return null
  try {
    const client = createClient(SUPABASE_URL, token, { auth: { persistSession: false } })
    const { data, error } = await client.auth.getUser()
    if (error || !data?.user?.id) return null
    return data.user.id
  } catch {
    return null
  }
}

function buildPrompt(contextPack: any) {
  return `
You are a precise automotive quote assembly assistant.

Your job:
- Read the work order and context pack.
- Propose a minimal set of part_queries that a human would search for to build a quote.
- If key constraints are missing (fitment, trim, engine, side/position, quantity), list them in missing_constraints.

Rules:
- Output MUST be valid JSON (no markdown, no extra text).
- Do NOT invent part numbers or prices.
- If you are not confident, prefer missing_constraints instead of guessing.
- Keep part_queries short (2-8 words each).

Output schema:
{
  "part_queries": ["..."],
  "missing_constraints": ["..."],
  "notes": "short"
}

Context pack (JSON):
${JSON.stringify(contextPack)}
`.trim()
}

function normalizeProvider(p: any): LLMProvider | undefined {
  const s = String(p ?? "").toLowerCase().trim()
  if (s === "openai") return "openai"
  if (s === "anthropic" || s === "claude") return "anthropic"
  if (s === "google" || s === "gemini") return "google"
  return undefined
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "Supabase service role not configured for this function" })
  }

  try {
    const token = parseBearer(req)
    const userId = await getUserIdFromToken(token)

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, detectSessionInUrl: false },
    })

    const body = await req.json()
    const provider = normalizeProvider(body.provider)
    const model = body.model ? String(body.model) : undefined
    const contextPack = body.context_pack ?? {}

    const config = await getLLMConfig(
      supabaseAdmin,
      userId,
      provider,
      model,
      undefined
    )

    const prompt = buildPrompt(contextPack)
    const messages = [
      { role: "system", content: "Return only valid JSON. No markdown. No extra keys." },
      { role: "user", content: prompt },
    ]

    const resp = await callLLM(config, messages, { temperature: 0.2, maxTokens: 900 })
    const raw = resp?.content || ""

    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      return json(422, { error: "LLM returned invalid JSON", raw })
    }

    return json(200, {
      provider: config.provider,
      model: config.model,
      source: config.source,
      output: {
        part_queries: Array.isArray(parsed.part_queries) ? parsed.part_queries : [],
        missing_constraints: Array.isArray(parsed.missing_constraints) ? parsed.missing_constraints : [],
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
      },
    })
  } catch (err: any) {
    return json(500, { error: err?.message || String(err) })
  }
})


