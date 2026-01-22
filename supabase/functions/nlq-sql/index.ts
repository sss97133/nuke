import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { callLLM, getLLMConfig, type AnalysisTier, type LLMProvider } from "../_shared/llmProvider.ts"
import { corsHeaders } from "../_shared/cors.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  ""

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200
const ALLOWED_TABLES = new Set(["vehicles", "public.vehicles"])
const DISALLOWED_TOKENS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "grant",
  "revoke",
  "truncate",
  "comment",
  "copy",
  "vacuum",
  "analyze",
  "call",
  "execute",
  "do",
  "pg_",
  "information_schema",
  "auth.",
  "storage.",
  "realtime.",
  "vault.",
]

const cors = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
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

function normalizeProvider(p: any): LLMProvider | undefined {
  const s = String(p ?? "").toLowerCase().trim()
  if (s === "openai") return "openai"
  if (s === "anthropic" || s === "claude") return "anthropic"
  if (s === "google" || s === "gemini") return "google"
  return undefined
}

function normalizeTier(t: any): AnalysisTier | undefined {
  const s = String(t ?? "").toLowerCase().trim()
  if (s === "tier1") return "tier1"
  if (s === "tier2") return "tier2"
  if (s === "tier3") return "tier3"
  if (s === "expert") return "expert"
  return undefined
}

function extractJson(text: string): any | null {
  const raw = (text || "").trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf("{")
    const end = raw.lastIndexOf("}")
    if (start >= 0 && end > start) {
      const slice = raw.slice(start, end + 1)
      try {
        return JSON.parse(slice)
      } catch {
        return null
      }
    }
    return null
  }
}

function buildPrompt(params: {
  question: string
  limit: number
  includeMerged: boolean
}) {
  const { question, limit, includeMerged } = params
  return `
You are a Postgres SQL generator. Return JSON only.

Output JSON schema:
{
  "sql": "string",
  "explanation": "short string",
  "confidence": 0.0
}

Rules:
- Only SELECT statements. Do not use WITH, INSERT, UPDATE, DELETE, or DDL.
- Use only the table public.vehicles (alias ok).
- Allowed columns: id, year, make, model, status, created_at, updated_at, vin.
- If the question cannot be answered from public.vehicles, set sql="" and explain why.
- Prefer aggregated answers (COUNT, GROUP BY) when the user asks for totals/top/most.
- Use btrim/coalesce for make/model:
  COALESCE(NULLIF(btrim(make), ''), '[unknown]')
  COALESCE(NULLIF(btrim(model), ''), '[unknown]')
- ${includeMerged ? "Include" : "Exclude"} vehicles with status = 'merged' by default.
- If returning rows (not just a single scalar), include LIMIT ${limit}.

Question:
${question}
`.trim()
}

function normalizeSql(sql: string): string {
  return (sql || "").trim().replace(/;+\s*$/, "")
}

function validateSql(sql: string): { ok: boolean; error?: string } {
  const trimmed = sql.trim()
  const lower = trimmed.toLowerCase()

  if (!trimmed) return { ok: false, error: "Missing SQL" }
  if (!lower.startsWith("select")) return { ok: false, error: "Only SELECT statements are allowed" }
  if (lower.startsWith("with ")) return { ok: false, error: "CTEs are not allowed in this endpoint" }
  if (/[;](?=.*\S)/.test(trimmed.replace(/;+\s*$/, ""))) {
    return { ok: false, error: "Multiple statements are not allowed" }
  }
  if (lower.includes("--") || lower.includes("/*")) {
    return { ok: false, error: "Comments are not allowed in SQL" }
  }
  for (const token of DISALLOWED_TOKENS) {
    if (lower.includes(token)) {
      return { ok: false, error: `Disallowed token detected: ${token}` }
    }
  }

  const tableMatches = Array.from(trimmed.matchAll(/\b(from|join)\s+([a-zA-Z0-9_."$()]+)/gi))
  let sawAllowed = false
  for (const match of tableMatches) {
    const raw = (match[2] || "").trim()
    if (!raw || raw.startsWith("(")) continue
    const normalized = raw.replace(/"/g, "").toLowerCase()
    if (ALLOWED_TABLES.has(normalized)) {
      sawAllowed = true
      continue
    }
    return { ok: false, error: `Table not allowed: ${raw}` }
  }
  if (!sawAllowed) {
    return { ok: false, error: "Query must read from public.vehicles" }
  }
  return { ok: true }
}

function enforceLimit(sql: string, limit: number): string {
  if (/\blimit\s+\d+/i.test(sql)) return sql
  return `SELECT * FROM (${sql}) AS q LIMIT ${limit}`
}

async function execSql(supabase: any, sql: string): Promise<{ data?: any[]; error?: string }> {
  const attempts = [
    { fn: "execute_sql", payload: { query: sql } },
    { fn: "execute_sql", payload: { sql } },
    { fn: "exec_sql", payload: { sql } },
    { fn: "exec_sql", payload: { query: sql } },
  ]

  const errors: string[] = []
  for (const attempt of attempts) {
    const { data, error } = await supabase.rpc(attempt.fn, attempt.payload)
    if (!error) {
      if (data && typeof data === "object" && !Array.isArray(data) && "error" in data) {
        return { error: String((data as any).error || "SQL execution error") }
      }
      return { data: Array.isArray(data) ? data : [] }
    }
    errors.push(`${attempt.fn}: ${error.message}`)
  }
  return { error: errors.join(" | ") }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json(405, { error: "Method not allowed" })

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "Supabase service role not configured for this function" })
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const question = String((body as any)?.query ?? "").trim()
    if (!question) return json(400, { error: "Missing query" })

    const requestedLimit = Number((body as any)?.limit ?? DEFAULT_LIMIT)
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT))
    const includeMerged = Boolean((body as any)?.include_merged ?? (body as any)?.includeMerged ?? false)

    const token = parseBearer(req)
    const userId = await getUserIdFromToken(token)

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, detectSessionInUrl: false },
    })

    const provider = normalizeProvider((body as any)?.provider)
    const model = (body as any)?.model ? String((body as any)?.model) : undefined
    const tier = normalizeTier((body as any)?.tier) ?? "tier2"

    const config = await getLLMConfig(supabaseAdmin, userId, provider, model, tier)
    const prompt = buildPrompt({ question, limit, includeMerged })
    const messages = [
      { role: "system", content: "Return only valid JSON. No markdown. No extra text." },
      { role: "user", content: prompt },
    ]

    const resp = await callLLM(config, messages, { temperature: 0.1, maxTokens: 900 })
    const parsed = extractJson(resp?.content || "")
    if (!parsed || typeof parsed !== "object") {
      return json(422, { error: "LLM returned invalid JSON", raw: resp?.content || "" })
    }

    const sqlRaw = normalizeSql(String((parsed as any).sql || ""))
    const explanation = String((parsed as any).explanation || "")
    const confidence = Number((parsed as any).confidence ?? 0)

    if (!sqlRaw) {
      return json(422, { error: "No SQL produced", explanation, confidence })
    }

    const validation = validateSql(sqlRaw)
    if (!validation.ok) {
      return json(422, { error: validation.error || "SQL validation failed", sql: sqlRaw, explanation })
    }

    const sql = enforceLimit(sqlRaw, limit)
    const { data, error } = await execSql(supabaseAdmin, sql)
    if (error) return json(500, { error, sql, explanation })

    return json(200, {
      query: question,
      sql,
      explanation,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      rows: data || [],
      row_count: (data || []).length,
      provider: config.provider,
      model: config.model,
      source: config.source,
    })
  } catch (err: any) {
    return json(500, { error: err?.message || String(err) })
  }
})
