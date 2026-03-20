import "jsr:@supabase/functions-js/edge-runtime.d.ts"
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
const ALLOWED_TABLES = new Set([
  "vehicles", "public.vehicles",
  "surface_observations", "public.surface_observations",
  "vehicle_surface_templates", "public.vehicle_surface_templates",
  "vehicle_surface_coverage", "public.vehicle_surface_coverage",
  "vehicle_images", "public.vehicle_images",
  "image_condition_observations", "public.image_condition_observations",
  "condition_taxonomy", "public.condition_taxonomy",
  "vehicle_condition_scores", "public.vehicle_condition_scores",
  "condition_distributions", "public.condition_distributions",
])
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
  limit: number
  includeMerged: boolean
  today: string
}) {
  const { limit, includeMerged, today } = params
  return `
You are a Postgres SQL assistant with a clarification loop. Return JSON only.

Output JSON schema:
{
  "action": "clarify" | "run" | "reject",
  "question": "string",
  "sql": "string",
  "explanation": "short string",
  "confidence": 0.0
}

Rules:
- If the request is ambiguous or missing key constraints, use action="clarify" and ask ONE concise question.
- If the request is out of scope, use action="reject" and explain why.
- Otherwise use action="run" and return SQL.
- Only SELECT statements. Do not use WITH, INSERT, UPDATE, DELETE, or DDL.
- Allowed tables: public.vehicles, public.surface_observations, public.vehicle_images, public.vehicle_surface_templates, public.vehicle_surface_coverage (view), public.image_condition_observations, public.condition_taxonomy, public.vehicle_condition_scores, public.condition_distributions.

VEHICLE TABLE:
- vehicles: id, year, make, model, status, created_at, updated_at, vin.

SURFACE MAPPING (spatial observations at any resolution):
- surface_observations: id, vehicle_image_id, vehicle_id, zone, u_min_inches, u_max_inches, v_min_inches, v_max_inches, h_min_inches, h_max_inches, resolution_level (0=zone, 1=6x6, 2=2x2, 3=1x1), bbox_x, bbox_y, bbox_w, bbox_h, observation_type, label, confidence, severity (0-1 continuous), lifecycle_state, descriptor_id, region_detail, pass_number (1=broad, 2=contextual, 3=sequence), model_version, pass_name, evidence (jsonb), created_at.
  - observation_type: 'zone_classify', 'condition', 'modification', 'part', 'damage', 'color', 'label'.
  - lifecycle_state: 'fresh', 'worn', 'weathered', 'restored', 'palimpsest', 'ghost', 'archaeological'.
  - zone values: ext_front, ext_rear, ext_front_driver, ext_front_passenger, ext_rear_driver, ext_rear_passenger, ext_driver_side, ext_passenger_side, ext_roof, ext_undercarriage, fender_front_driver, fender_front_passenger, fender_rear_driver, fender_rear_passenger, door_driver, door_passenger, int_dashboard, int_steering, int_gauges, int_center_console, int_front_seats, int_rear_seats, int_headliner, int_cargo, int_door_panel_driver, int_door_panel_passenger, mech_engine_bay, mech_exhaust, mech_suspension, mech_transmission, wheel_fl, wheel_fr, wheel_rl, wheel_rr, detail_badge, detail_vin_plate, detail_damage, bed_floor, bed_side_driver, bed_side_passenger, tailgate, other.
- vehicle_surface_coverage (view): vehicle_id, year, make, model, zone, image_count, observation_count, max_resolution, observation_types, avg_severity, max_severity, lifecycle_states, passes_completed, condition_labels, has_physical_coords.
- vehicle_surface_templates: id, year_start, year_end, make, model, body_style, length_inches, width_inches, height_inches, wheelbase_inches, zone_bounds (jsonb), source.

CONDITION SPECTROMETER (spectral scoring, 0-100):
- condition_taxonomy: descriptor_id, canonical_key (dot-notation: 'exterior.metal.oxidation'), domain ('exterior'|'interior'|'mechanical'|'structural'|'provenance'), descriptor_type ('adjective'|'mechanism'|'state'), display_label.
- image_condition_observations: id, image_id, vehicle_id, descriptor_id (FK→condition_taxonomy), severity (0-1), lifecycle_state, zone, region_detail, pass_number, confidence, source, source_version, evidence (jsonb).
- vehicle_condition_scores: id, vehicle_id, condition_score (0-100), condition_tier ('concours'|'excellent'|'good'|'driver'|'project'|'parts'), percentile_within_ymm, percentile_global, ymm_key, exterior_score (0-30), interior_score (0-20), mechanical_score (0-20), provenance_score (0-15), presentation_score (0-15), lifecycle_state, condition_rarity, zone_coverage.
- condition_distributions: ymm_key, group_type, group_size, mean_score, median_score, std_dev, percentile_10 through percentile_90, lifecycle_distribution (jsonb).

IMAGES:
- vehicle_images: id, vehicle_id, image_url, vehicle_zone, zone_confidence, condition_score, damage_flags (text[]), modification_flags (text[]), photo_quality_score.

QUERY RULES:
- Prefer aggregated answers (COUNT, GROUP BY) when the user asks for totals/top/most.
- Use btrim/coalesce for make/model: COALESCE(NULLIF(btrim(make), ''), '[unknown]'), COALESCE(NULLIF(btrim(model), ''), '[unknown]')
- ${includeMerged ? "Include" : "Exclude"} vehicles with status = 'merged' by default.
- If returning rows (not just a single scalar), include LIMIT ${limit}.
- Today's date (UTC): ${today}
- Condition is SPECTRAL (0-100 continuous), not binary. Damage is an ADJECTIVE, not an event.
- Lifecycle states: fresh (new/restored) → worn → weathered → restored → palimpsest (layered history) → ghost (severe) → archaeological (salvage).
- condition_rarity in vehicle_condition_scores = 1 - CDF(score, ymm_distribution). High rarity = unusual condition for this Y/M/M.

QUERY EXAMPLES:
1. "Show me all rust on trucks" →
   SELECT so.zone, so.label, so.confidence, so.severity, so.lifecycle_state, vi.image_url FROM surface_observations so JOIN vehicle_images vi ON vi.id = so.vehicle_image_id JOIN vehicles v ON v.id = so.vehicle_id WHERE so.label = 'rust' AND so.observation_type = 'condition' LIMIT ${limit}
2. "Compare fender condition across K10s" →
   SELECT v.year, so.zone, avg(so.severity) AS avg_severity, count(*) FROM surface_observations so JOIN vehicles v ON v.id = so.vehicle_id WHERE v.model ILIKE '%K10%' AND so.zone IN ('fender_front_driver','fender_front_passenger','fender_rear_driver','fender_rear_passenger') GROUP BY v.year, so.zone ORDER BY v.year
3. "Which zones have the most damage?" →
   SELECT zone, count(*) AS cnt, avg(severity) AS avg_sev FROM surface_observations WHERE observation_type = 'condition' GROUP BY zone ORDER BY cnt DESC LIMIT ${limit}
4. "Surface coverage for vehicle X" →
   SELECT * FROM vehicle_surface_coverage WHERE vehicle_id = 'uuid' ORDER BY observation_count DESC
5. "Show archaeological-state observations on 1970s trucks" →
   SELECT so.zone, so.label, so.severity, v.year, v.make, v.model FROM surface_observations so JOIN vehicles v ON v.id = so.vehicle_id WHERE so.lifecycle_state = 'archaeological' AND v.year BETWEEN 1970 AND 1979 LIMIT ${limit}
6. "What's the condition score distribution for Camaros?" →
   SELECT condition_score, condition_tier, percentile_within_ymm, condition_rarity FROM vehicle_condition_scores WHERE ymm_key ILIKE '%Camaro%' ORDER BY condition_score DESC LIMIT ${limit}
7. "Which Y/M/M has the highest average condition?" →
   SELECT ymm_key, mean_score, median_score, group_size FROM condition_distributions WHERE group_type = 'ymm' AND group_size >= 5 ORDER BY mean_score DESC LIMIT ${limit}
8. "Show me all rust taxonomy descriptors" →
   SELECT canonical_key, display_label, domain, descriptor_type FROM condition_taxonomy WHERE canonical_key ILIKE '%rust%' OR canonical_key ILIKE '%oxidation%'
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
    return { ok: false, error: "Query must read from an allowed table" }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json(405, { error: "Method not allowed" })

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "Supabase service role not configured for this function" })
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const question = String((body as any)?.query ?? "").trim()

    const requestedLimit = Number((body as any)?.limit ?? DEFAULT_LIMIT)
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT))
    const includeMerged = Boolean((body as any)?.include_merged ?? (body as any)?.includeMerged ?? false)

    const token = parseBearer(req)
    const userId = await getUserIdFromToken(token)

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, detectSessionInUrl: false },
    })

    const rawHistory = Array.isArray((body as any)?.history) ? (body as any).history : []
    const normalizedHistory = rawHistory
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
      .map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").trim(),
      }))
      .filter((m: any) => m.content)
      .slice(-12)

    const history = normalizedHistory.length > 0
      ? (question ? [...normalizedHistory, { role: "user", content: question }] : normalizedHistory)
      : (question ? [{ role: "user", content: question }] : [])

    if (!history.length) return json(400, { error: "Missing query" })

    const provider = normalizeProvider((body as any)?.provider)
    const model = (body as any)?.model ? String((body as any)?.model) : undefined
    const tier = normalizeTier((body as any)?.tier) ?? "tier2"

    const config = await getLLMConfig(supabaseAdmin, userId, provider, model, tier)
    const prompt = buildPrompt({ limit, includeMerged, today: new Date().toISOString().slice(0, 10) })
    const messages = [
      { role: "system", content: "Return only valid JSON. No markdown. No extra text." },
      { role: "system", content: prompt },
      ...history,
    ]

    const resp = await callLLM(config, messages, { temperature: 0.1, maxTokens: 900 })
    const parsed = extractJson(resp?.content || "")
    if (!parsed || typeof parsed !== "object") {
      return json(422, { error: "LLM returned invalid JSON", raw: resp?.content || "" })
    }

    const actionRaw = String((parsed as any).action || "").toLowerCase().trim()
    const explanation = String((parsed as any).explanation || "")
    const confidence = Number((parsed as any).confidence ?? 0)

    if (actionRaw === "clarify") {
      const clarification = String((parsed as any).question || (parsed as any).clarification || "").trim()
      if (!clarification) {
        return json(422, { error: "Clarification required but no question provided", explanation, confidence })
      }
      return json(200, {
        action: "clarify",
        clarification,
        explanation,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        provider: config.provider,
        model: config.model,
        source: config.source,
      })
    }

    if (actionRaw === "reject") {
      return json(200, {
        action: "reject",
        explanation: explanation || "Request is out of scope for public.vehicles.",
        confidence: Number.isFinite(confidence) ? confidence : 0,
        provider: config.provider,
        model: config.model,
        source: config.source,
      })
    }

    const sqlRaw = normalizeSql(String((parsed as any).sql || ""))
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
      action: "run",
      query: question || history[history.length - 1]?.content || "",
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
