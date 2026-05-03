/**
 * NUKE External Agent Write API — POST /v1/events
 *
 * Single canonical write endpoint for vehicle events. Reuses the
 * `vehicle_observations` substrate via `ingest-observation`.
 *
 * Substrate mapping:
 *   event_type=service → kind=work_record, source_slug=shop
 *   event_type=note    → kind=comment,    source_slug=agent-submission
 *
 * VIN is the canonical key. VIN→vehicle_id is resolved internally.
 * If the vehicle doesn't exist for the VIN, returns 404 — does NOT
 * auto-create vehicles in v1 (use create_profile / vehicle ingestion first).
 *
 * Hard Rule #4: external URLs go through archiveFetch; internal calls
 * stay within Supabase via fetch (allowed, internal). We use
 * SUPABASE_URL/functions/v1/ingest-observation directly.
 *
 * Auth: X-API-Key (preferred) or Authorization: Bearer service-role/JWT.
 * Scope grammar: events:write:vehicle:{vin} | events:write:all
 *
 * @owner workstream B (endpoint)
 * @sibling api-v1-observations/index.ts (parallel surface)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest, logApiUsage } from "../_shared/apiKeyAuth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const RESPONSE_HEADERS = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Content-Type": "application/json",
};

// ── Type definitions ─────────────────────────────────────────────────────────

type EventType = "service" | "note";

interface EventEnvelope {
  schema_version: string;
  event_type: EventType | string;
  vehicle_ref: { vin?: string; vehicle_id?: string };
  occurred_at: string;
  submitted_at?: string;
  agent?: { id?: string; version?: string; session_id?: string };
  auth?: { user_id?: string; token_id?: string; scopes?: string[] };
  payload: Record<string, unknown>;
  media?: Array<{ type: string; url?: string; sha256?: string }>;
  submission_hash?: string;
  /** When set, prior observation row is marked is_superseded=true. */
  correction_of?: string;
  /** Caller's confidence override; default 0.85 (false) / 0.6 (true). */
  agent_inferred?: boolean;
}

// event_type → { kind, source_slug }
const EVENT_TYPE_MAP: Record<string, { kind: string; source_slug: string }> = {
  service: { kind: "work_record", source_slug: "shop" },
  note: { kind: "comment", source_slug: "agent-submission" },
};

const VIN_RE = /^[A-HJ-NPR-Z0-9]{11,17}$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...RESPONSE_HEADERS, ...extra },
  });
}

/**
 * Validate the envelope. Loose schema — required keys + correct types.
 * Strict payload validation is left to JSON Schema (WS-A) and v1.1.
 */
function validateEnvelope(body: unknown): { ok: true; envelope: EventEnvelope } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const e = body as Partial<EventEnvelope>;

  if (typeof e.schema_version !== "string") {
    return { ok: false, error: "schema_version (string) required" };
  }
  if (typeof e.event_type !== "string") {
    return { ok: false, error: "event_type (string) required" };
  }
  if (!EVENT_TYPE_MAP[e.event_type]) {
    return {
      ok: false,
      error: `Unsupported event_type '${e.event_type}'. Supported: ${Object.keys(EVENT_TYPE_MAP).join(", ")}`,
    };
  }
  if (!e.vehicle_ref || typeof e.vehicle_ref !== "object") {
    return { ok: false, error: "vehicle_ref (object) required" };
  }
  if (!e.vehicle_ref.vin || typeof e.vehicle_ref.vin !== "string") {
    return { ok: false, error: "vehicle_ref.vin (string) required — VIN is the canonical key" };
  }
  if (!VIN_RE.test(e.vehicle_ref.vin.trim())) {
    return { ok: false, error: `vehicle_ref.vin '${e.vehicle_ref.vin}' is not a valid VIN format` };
  }
  if (typeof e.occurred_at !== "string") {
    return { ok: false, error: "occurred_at (ISO 8601 string) required" };
  }
  if (isNaN(Date.parse(e.occurred_at))) {
    return { ok: false, error: "occurred_at must be a valid ISO 8601 timestamp" };
  }
  if (!e.payload || typeof e.payload !== "object") {
    return { ok: false, error: "payload (object) required" };
  }
  if (e.correction_of !== undefined && typeof e.correction_of !== "string") {
    return { ok: false, error: "correction_of (string observation_id) must be a UUID if present" };
  }

  return { ok: true, envelope: e as EventEnvelope };
}

/**
 * Check that the auth scopes allow writing to the given VIN.
 * Service-role auth bypasses (internal calls). API keys must carry
 * `events:write:all` or `events:write:vehicle:{VIN}`.
 *
 * If no scopes are present (legacy keys with `write` scope), we DENY
 * — agents must explicitly carry `events:write:*` to use this endpoint.
 */
function checkEventScope(
  scopes: string[] | undefined,
  vin: string,
  isServiceRole: boolean,
): { allowed: boolean; matched: string[] } {
  if (isServiceRole) return { allowed: true, matched: ["service-role"] };
  if (!scopes || scopes.length === 0) return { allowed: false, matched: [] };

  const matched: string[] = [];
  for (const s of scopes) {
    if (s === "events:write:all") matched.push(s);
    else if (s === `events:write:vehicle:${vin}`) matched.push(s);
  }
  return { allowed: matched.length > 0, matched };
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * GET /v1/events?vin=...&limit=50&include_superseded=false
 *
 * Read-back surface so callers can verify their writes round-tripped
 * and pull the latest event timeline for a vehicle without hitting
 * the read MCP.
 *
 * Returns ONLY work_record + comment kinds that came in through the
 * /v1/events write path (filtered by source_slug ∈ {shop, agent-submission}).
 * The full observation timeline lives on /vehicles/{vin}.
 */
async function handleGet(req: Request, supabase: any, auth: any): Promise<Response> {
  const url = new URL(req.url);
  const vin = (url.searchParams.get("vin") || "").trim().toUpperCase();
  if (!vin) {
    return jsonResponse({ error: "Query parameter 'vin' is required" }, 400);
  }
  if (!VIN_RE.test(vin)) {
    return jsonResponse({ error: `vin '${vin}' invalid format` }, 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const includeSuperseded = url.searchParams.get("include_superseded") === "true";

  // Read scope check — callers need events:read:vehicle:{vin} or events:read:all
  // (or events:write:* implicitly grants read for that VIN). Service-role bypasses.
  const isWriteScopeMatch = (auth.scopes ?? []).some(
    (s: string) => s === "events:write:all" || s === `events:write:vehicle:${vin}`
                || s === "events:read:all"  || s === `events:read:vehicle:${vin}`
                || s === "read" || s === "write" || s === "admin",
  );
  if (!auth.isServiceRole && !isWriteScopeMatch) {
    return jsonResponse({
      error: "Insufficient scope for this VIN",
      required_one_of: [`events:read:vehicle:${vin}`, "events:read:all"],
      scopes_present: auth.scopes ?? [],
    }, 403, auth.headers || {});
  }

  // Resolve VIN → vehicle_id
  const { data: vehicle, error: vinErr } = await supabase
    .from("vehicles").select("id").eq("vin", vin).limit(1).maybeSingle();
  if (vinErr) return jsonResponse({ error: "Vehicle lookup failed", details: vinErr.message }, 500);
  if (!vehicle) return jsonResponse({ error: "vehicle_not_found", vin }, 404, auth.headers || {});

  // Query events written through /v1/events (filtered by source_slug)
  const sourceSlugs = ["shop", "agent-submission"];
  const { data: sources } = await supabase
    .from("observation_sources").select("id, slug").in("slug", sourceSlugs);
  const sourceIds = (sources ?? []).map((s: any) => s.id);
  if (sourceIds.length === 0) {
    return jsonResponse({ vehicle_id: vehicle.id, vin, events: [], count: 0 }, 200, auth.headers || {});
  }

  let q = supabase
    .from("vehicle_observations")
    .select("id, kind, observed_at, ingested_at, content_text, structured_data, confidence_score, is_superseded, superseded_by, superseded_at")
    .eq("vehicle_id", vehicle.id)
    .in("source_id", sourceIds)
    .order("observed_at", { ascending: false })
    .limit(limit);
  if (!includeSuperseded) q = q.eq("is_superseded", false);

  const { data: rows, error: rowsErr } = await q;
  if (rowsErr) return jsonResponse({ error: "Read failed", details: rowsErr.message }, 500);

  const events = (rows ?? []).map((r: any) => ({
    event_id: r.id,
    observation_id: r.id,
    kind: r.kind,
    event_type: r.structured_data?._envelope?.event_type ?? null,
    occurred_at: r.observed_at,
    ingested_at: r.ingested_at,
    summary: r.content_text,
    payload: stripEnvelope(r.structured_data ?? {}),
    confidence_score: r.confidence_score,
    is_superseded: r.is_superseded,
    superseded_by: r.superseded_by,
    superseded_at: r.superseded_at,
    agent: r.structured_data?._envelope?.agent ?? null,
  }));

  return jsonResponse({
    vehicle_id: vehicle.id,
    vin,
    events,
    count: events.length,
    limit,
    include_superseded: includeSuperseded,
  }, 200, auth.headers || {});
}

function stripEnvelope(structured: Record<string, unknown>): Record<string, unknown> {
  const { _envelope: _, ...rest } = structured as any;
  return rest;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: RESPONSE_HEADERS });
  }

  // GET /v1/events?vin=... — read-back surface
  if (req.method === "GET") {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Server misconfigured" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = await authenticateRequest(req, supabase, { endpoint: "events" });
    if (auth.error || !auth.userId) return jsonResponse({ error: auth.error || "Authentication required" }, auth.status || 401, auth.headers || {});
    return handleGet(req, supabase, auth);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. POST or GET only." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Authenticate
  const auth = await authenticateRequest(req, supabase, { endpoint: "events" });
  if (auth.error || !auth.userId) {
    return jsonResponse(
      { error: auth.error || "Authentication required" },
      auth.status || 401,
      auth.headers || {},
    );
  }

  // 2. Parse + validate envelope
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const validation = validateEnvelope(body);
  if (!validation.ok) {
    return jsonResponse({ error: validation.error }, 400);
  }
  const envelope = validation.envelope;
  const vinNorm = envelope.vehicle_ref.vin!.trim().toUpperCase();

  // 3. Scope check
  const scopeCheck = checkEventScope(auth.scopes, vinNorm, !!auth.isServiceRole);
  if (!scopeCheck.allowed) {
    return jsonResponse(
      {
        error: "Insufficient scope for this VIN",
        required_one_of: [`events:write:vehicle:${vinNorm}`, "events:write:all"],
        scopes_present: auth.scopes ?? [],
      },
      403,
      auth.headers || {},
    );
  }

  // 4. Resolve VIN → vehicle_id (mirror handleGetAuctionReadiness pattern)
  const { data: vehicle, error: vinErr } = await supabase
    .from("vehicles")
    .select("id, vin, status")
    .eq("vin", vinNorm)
    .limit(1)
    .maybeSingle();

  if (vinErr) {
    console.error("[api-v1-events] VIN lookup error:", vinErr.message);
    return jsonResponse({ error: "Vehicle lookup failed", details: vinErr.message }, 500);
  }
  if (!vehicle) {
    return jsonResponse(
      {
        error: "vehicle_not_found",
        message:
          `Vehicle not yet in NUKE for VIN '${vinNorm}'. ` +
          `Create the profile first via the create_profile MCP tool or vehicle ingestion. ` +
          `v1 does not auto-create vehicles from event submissions.`,
        vin: vinNorm,
      },
      404,
      auth.headers || {},
    );
  }
  const vehicleId = vehicle.id as string;

  // 5. Map event_type → kind/source_slug
  const mapping = EVENT_TYPE_MAP[envelope.event_type];
  // (validateEnvelope already guaranteed this exists)

  // 6. Build ingest-observation payload
  const summary =
    typeof envelope.payload?.summary === "string"
      ? (envelope.payload.summary as string)
      : null;

  const confidenceScore = envelope.agent_inferred ? 0.6 : 0.85;
  const agentRef =
    envelope.agent?.id
      ? `agent://${envelope.agent.id}${envelope.agent.session_id ? `#${envelope.agent.session_id}` : ""}`
      : null;

  const ingestBody = {
    vehicle_id: vehicleId,
    source_slug: mapping.source_slug,
    kind: mapping.kind,
    observed_at: envelope.occurred_at,
    source_url: agentRef,
    source_identifier:
      envelope.submission_hash || envelope.agent?.session_id || null,
    content_text: summary,
    structured_data: {
      ...envelope.payload,
      // Stash envelope metadata we don't want to lose:
      _envelope: {
        schema_version: envelope.schema_version,
        event_type: envelope.event_type,
        submitted_at: envelope.submitted_at ?? new Date().toISOString(),
        agent: envelope.agent ?? null,
        media: envelope.media ?? null,
        submission_hash: envelope.submission_hash ?? null,
        agent_inferred: !!envelope.agent_inferred,
      },
    },
    extraction_metadata: {
      api: "v1/events",
      caller_user_id: auth.userId,
      caller_agent_id: auth.agentId ?? null,
      scopes_matched: scopeCheck.matched,
      correction_of: envelope.correction_of ?? null,
    },
    extraction_method: "external_agent_api",
    raw_source_ref: envelope.submission_hash ?? null,
    agent_model: envelope.agent?.version ?? null,
  };

  // 7. Call ingest-observation internally (Hard Rule #4: internal Supabase
  //    fetch is allowed; archiveFetch is for external URLs only.)
  const ingestRes = await fetch(`${supabaseUrl}/functions/v1/ingest-observation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(ingestBody),
  });

  if (!ingestRes.ok) {
    const txt = await ingestRes.text();
    console.error("[api-v1-events] ingest-observation failed:", ingestRes.status, txt);
    return jsonResponse(
      {
        error: "Failed to write observation",
        upstream_status: ingestRes.status,
        details: txt.slice(0, 500),
      },
      502,
      auth.headers || {},
    );
  }

  const ingestResult = (await ingestRes.json()) as {
    success?: boolean;
    observation_id?: string;
    duplicate?: boolean;
    vehicle_id?: string;
    confidence_score?: number;
    error?: string;
  };

  if (ingestResult.error || !ingestResult.observation_id) {
    return jsonResponse(
      {
        error: "ingest-observation rejected the submission",
        details: ingestResult.error || "No observation_id returned",
      },
      502,
      auth.headers || {},
    );
  }

  const observationId = ingestResult.observation_id;

  // 8. Backfill submitted_by_user_id + confidence_score (ingest-observation
  //    doesn't currently accept these — set them post-write).
  //    submitted_by_user_id is uuid; only set when caller is a real user
  //    (not service-role, not agent:* synthetic IDs).
  const isUuid = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const updates: Record<string, unknown> = { confidence_score: confidenceScore };
  if (auth.userId && !auth.isServiceRole && isUuid(auth.userId)) {
    updates.submitted_by_user_id = auth.userId;
  }
  await supabase.from("vehicle_observations").update(updates).eq("id", observationId);

  // 9. Handle correction_of: mark prior row as superseded (after authz check).
  let correctionApplied = false;
  if (envelope.correction_of) {
    const { data: prior, error: priorErr } = await supabase
      .from("vehicle_observations")
      .select("id, vehicle_id, submitted_by_user_id, is_superseded")
      .eq("id", envelope.correction_of)
      .maybeSingle();

    if (priorErr || !prior) {
      console.warn(
        "[api-v1-events] correction_of target not found:",
        envelope.correction_of,
      );
    } else if (prior.vehicle_id !== vehicleId) {
      console.warn(
        "[api-v1-events] correction_of target belongs to a different vehicle; ignoring",
      );
    } else {
      // Authorization: caller must own the prior row OR be service-role OR
      // hold events:write:all. Otherwise we refuse the supersession.
      const callerOwns =
        prior.submitted_by_user_id && prior.submitted_by_user_id === auth.userId;
      const hasGlobalWrite =
        auth.scopes?.includes("events:write:all") || auth.isServiceRole;
      if (callerOwns || hasGlobalWrite) {
        await supabase
          .from("vehicle_observations")
          .update({
            is_superseded: true,
            superseded_by: observationId,
            superseded_at: new Date().toISOString(),
          })
          .eq("id", envelope.correction_of)
          .eq("is_superseded", false); // idempotent — don't re-stamp
        correctionApplied = true;
      } else {
        console.warn(
          "[api-v1-events] correction_of denied: caller does not own prior observation",
        );
      }
    }
  }

  // 10. Log API usage
  await logApiUsage(supabase, auth.userId, "events", "create", observationId);

  return jsonResponse(
    {
      event_id: observationId, // event_id is an alias for observation_id in the v1 contract
      observation_id: observationId,
      vehicle_id: vehicleId,
      duplicate: !!ingestResult.duplicate,
      correction_applied: correctionApplied,
      scopes_matched: scopeCheck.matched,
    },
    201,
    auth.headers || {},
  );
});
