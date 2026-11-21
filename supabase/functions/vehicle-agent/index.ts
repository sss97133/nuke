/**
 * Vehicle Agent — interactive Claude, with a single vehicle's data as the harness.
 *
 * This is the per-vehicle agent: you message it about ONE target, and the vehicle's
 * own long-term memory (vehicle_observations) + its deep-analyzed images
 * (ai_scan_metadata.byok_deep_analysis) are loaded as the context it reasons over.
 * The DB is the memory; this function is the ephemeral reconstitution of it.
 *
 * POST /functions/v1/vehicle-agent
 *   { vehicle_id: uuid, message: string,
 *     history?: [{role:'user'|'assistant', content:string}], allow_writes?: boolean }
 *
 * WRITES (on behalf of the user, fully backtrackable): when the agent establishes a
 * durable new fact and writes are allowed, it appends provenance-stamped rows to
 * vehicle_observations — rank='normal' (never outranks verified/human/source data),
 * submitted_by_user_id = the caller, agent_model + extracted_by='vehicle-agent'. The
 * append-only superseding model means these are additive and reversible: a wrong call
 * can be superseded, never silently overwrites a profile.
 *
 * COMPUTE: routes through the user's settings. byo_api_key+anthropic uses their own key
 * (decrypted server-side) first; then the platform keys in order, NUKE_ANTHROPIC_API_KEY
 * (the metered key AGENTS.md names) and ANTHROPIC_API_KEY (the function secret the other
 * Claude functions read; it answered a live call on 2026-11-20). A key that answers 401/403
 * is skipped for the next one. (A Claude *subscription* OAuth token isn't a Messages-API
 * credential, so byo_subscription uses the platform key for synchronous chat.)
 *
 * ACCESS: the caller must be tied to the vehicle by the rule the vehicle readers use
 * (vehicle_statements: vehicles.user_id / owner_id / uploaded_by, or vehicle_user_has_access),
 * or have uploaded images of it.
 *
 * ERRORS: every failure answers { error: "<plain sentence>" }; the garage box and the
 * profile chat show body.error as it is.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { floorClaudeModel, CLAUDE_FLOOR_MODEL } from "../_shared/llmProvider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The agent may only emit these kinds, and only at rank 'normal'. Keeps it from minting
// listings/sales/bids (source-of-record kinds) or outranking verified data.
const ALLOWED_KINDS = new Set([
  "condition", "specification", "valuation", "provenance",
  "expert_opinion", "work_record", "ownership", "activity", "sighting",
]);
const CONFIDENCE = new Set(["verified", "high", "medium", "low", "inferred"]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const CONTRIBUTOR_ROLES = ["owner", "co_owner", "restorer", "moderator", "consigner", "mechanic", "appraiser", "photographer", "sales_agent"];

/** The caller holds this vehicle: the record names them, an approved title verification, an owner
 *  permission, a current ownership, an active contributor role, or their own photos of it. */
async function isTied(supabase: any, vehicleId: string, userId: string): Promise<boolean> {
  const { data: v } = await supabase.from("vehicles").select("user_id, owner_id, uploaded_by")
    .eq("id", vehicleId).is("deleted_at", null).maybeSingle();
  if (!v) return false;
  if ([v.user_id, v.owner_id, v.uploaded_by].includes(userId)) return true;
  const checks = [
    supabase.from("ownership_verifications").select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId).eq("user_id", userId).eq("status", "approved"),
    supabase.from("vehicle_user_permissions").select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId).eq("user_id", userId).is("revoked_at", null)
      .or("is_active.is.null,is_active.eq.true").in("role", ["owner", "co_owner"]),
    supabase.from("vehicle_ownerships").select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId).eq("owner_profile_id", userId).eq("is_current", true),
    supabase.from("vehicle_contributors").select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId).eq("user_id", userId)
      .or("status.is.null,status.eq.active").in("role", CONTRIBUTOR_ROLES),
    supabase.from("vehicle_images").select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId).eq("user_id", userId),
  ];
  const results = await Promise.all(checks);
  return results.some((r: any) => !r.error && (r.count ?? 0) > 0);
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) {
    const verdict = await denied.json().catch(() => ({}));
    return json(denied.status, {
      error: "Sign in to talk to this car's agent.",
      reason: typeof verdict?.reason === "string" ? verdict.reason : undefined,
    });
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "The agent only answers POST requests." });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      projectSecretKey()!,
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Sign in to talk to this car's agent." });
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return json(401, { error: "Your session has ended. Sign in again to talk to this car's agent." });

    const body = await req.json().catch(() => ({}));
    const vehicleId = String(body.vehicle_id || "");
    const message = String(body.message || "").trim();
    const history: Array<{ role: string; content: string }> = Array.isArray(body.history)
      ? body.history.slice(-12)
      : [];
    const allowWrites = body.allow_writes !== false; // default on; the user chose "it can write"
    if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return json(400, { error: "That is not a vehicle id." });
    if (!message) return json(400, { error: "Type a message first." });

    // Access check: the caller holds the car by one of the garage's own routes, or uploaded
    // images of it. Not vehicle_user_has_access: its admin branch admits every vehicle (it
    // admitted 300 of 300 sampled non-garage cars for an admin account on 2026-11-20). The
    // images-only check refused 61 of 198 garage cars on two admin accounts; these routes
    // admit 198 of 198 and 0 of 900 sampled non-garage cars.
    if (!(await isTied(supabase, vehicleId, user.id))) {
      return json(403, { error: "This car's agent answers only people who hold the car." });
    }

    // ── Harness: load the vehicle's memory ───────────────────────────────────
    const { data: veh } = await supabase
      .from("vehicles").select("year, make, model, trim, vin, color").eq("id", vehicleId).maybeSingle();

    const { data: obs } = await supabase
      .from("vehicle_observations")
      .select("kind, observed_at, content_text, structured_data, confidence")
      .eq("vehicle_id", vehicleId)
      .or("is_superseded.is.null,is_superseded.eq.false")
      .order("observed_at", { ascending: false })
      .limit(60);

    const { data: imgs } = await supabase
      .from("vehicle_images")
      .select("id, taken_at, ai_scan_metadata")
      .eq("vehicle_id", vehicleId)
      .not("ai_scan_metadata->byok_deep_analysis", "is", null)
      .order("taken_at", { ascending: false })
      .limit(20);

    const imageSummaries = (imgs || []).map((r: any) => {
      const d = r.ai_scan_metadata?.byok_deep_analysis ?? {};
      return { taken_at: r.taken_at, summary: d.summary ?? d.condition_summary ?? null, observations: d.observations ?? d.structured ?? null };
    }).filter((x: any) => x.summary || x.observations);

    const vehName = veh ? `${veh.year ?? ""} ${veh.make ?? ""} ${veh.model ?? ""}${veh.trim ? " " + veh.trim : ""}`.trim() : "this vehicle";

    // ── Compute: which key + model (the settings toggle) ─────────────────────
    const { data: settings } = await supabase
      .from("user_analysis_settings").select("method, provider, model").eq("user_id", user.id).maybeSingle();
    // A stored setting below the floor (Haiku, Claude 3.x, Sonnet 4.x) runs on the floor; stored data is untouched.
    const model = floorClaudeModel((settings?.model && /^claude-/.test(settings.model)) ? settings.model : CLAUDE_FLOOR_MODEL);
    // Keys in the order they are tried; a key that answers 401/403 hands over to the next.
    const keys: Array<{ key: string; source: string }> = [];
    if (settings?.method === "byo_api_key" && settings.provider === "anthropic") {
      const { data: cred } = await supabase.rpc("get_analysis_credential", { p_user_id: user.id });
      if (cred) keys.push({ key: String(cred), source: "your_api_key" });
    }
    for (const name of ["NUKE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"]) {
      const key = Deno.env.get(name) || "";
      if (key && !keys.some((k) => k.key === key)) keys.push({ key, source: "platform" });
    }
    if (!keys.length) {
      console.error("[vehicle-agent] no Anthropic key in the function environment");
      return json(503, { error: "The agent has no model to answer with right now." });
    }

    const system =
      `You are the persistent agent assigned to ONE vehicle: ${vehName}` +
      (veh?.vin ? ` (VIN ${veh.vin})` : "") + `.\n` +
      `You reason ONLY from this vehicle's own data, provided below as your memory. Do not invent facts. ` +
      `If the data doesn't say, say so. Be concrete and concise.\n\n` +
      `=== OBSERVATIONS (most recent first) ===\n${JSON.stringify(obs ?? [], null, 0).slice(0, 12000)}\n\n` +
      `=== DEEP-ANALYZED IMAGES ===\n${JSON.stringify(imageSummaries, null, 0).slice(0, 8000)}\n\n` +
      (allowWrites
        ? `If — and only if — this exchange establishes a DURABLE new fact about the vehicle that isn't ` +
          `already in the observations, you may record it. To do so, end your reply with a fenced json block:\n` +
          "```json\n{\"observations\":[{\"kind\":\"condition|specification|valuation|provenance|expert_opinion|work_record|ownership|activity|sighting\",\"summary\":\"...\",\"fields\":{},\"confidence\":\"high|medium|low|inferred\"}]}\n```\n" +
          `Only record things you are confident about and that the user's message or the data supports. Most replies need NO json block.`
        : `Writing is disabled for this conversation; answer only.`);

    const messages = [
      ...history.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: String(m.content || "") })),
      { role: "user", content: message },
    ];

    const t0 = Date.now();
    // Above the floor (Opus 5.5, Fable) the model always thinks and thinking counts against max_tokens, so 1,500
    // could end before the reply; the floor model runs with thinking off and keeps the 1,500 reply bound.
    const requestBody = JSON.stringify({ model, max_tokens: model === CLAUDE_FLOOR_MODEL ? 1500 : 8000, ...(model === CLAUDE_FLOOR_MODEL ? { thinking: { type: "between_tools" } } : {}), system, messages });
    let aiRes: Response | null = null;
    let computeNote = "platform";
    for (const { key, source } of keys) {
      try {
        aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: requestBody,
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) {
        console.error(`[vehicle-agent] model call failed (${source}): ${e instanceof Error ? e.message : String(e)}`);
        return json(504, { error: "The model took too long to answer. Try again." });
      }
      computeNote = source;
      if (aiRes.status !== 401 && aiRes.status !== 403) break;
      console.error(`[vehicle-agent] ${source} key refused with ${aiRes.status}; trying the next key`);
    }
    if (!aiRes || !aiRes.ok) {
      const status = aiRes?.status ?? 0;
      const detail = aiRes ? await aiRes.text().catch(() => "") : "";
      console.error(`[vehicle-agent] model answered ${status}: ${detail.slice(0, 300)}`);
      const error = status === 401 || status === 403
        ? "The agent's model key was refused, so it cannot answer right now."
        : status === 429 || status === 529
          ? "The model is busy. Try again in a minute."
          : `The model did not answer (HTTP ${status}). Try again.`;
      return json(502, { error, status });
    }
    const aiData = await aiRes.json();
    const raw = (aiData.content || []).map((b: any) => b.text || "").join("").trim();
    const durationMs = Date.now() - t0;

    // Split prose from an optional trailing json block of observations to record.
    let reply = raw;
    let proposed: any[] = [];
    const m = raw.match(/```json\s*([\s\S]*?)```\s*$/);
    if (m) {
      reply = raw.slice(0, m.index).trim();
      try { proposed = JSON.parse(m[1]).observations || []; } catch { /* ignore malformed */ }
    }

    // ── Provenance-stamped writes, on behalf of the user ─────────────────────
    // Route through the canonical `ingest-observation` rail (dedup + confidence +
    // trust scoring), NEVER a raw INSERT into vehicle_observations — that bypasses
    // the testimony invariants (.claude/rules/agent-trust-invariants.md). Same
    // pattern as the sibling agent-chat fn. source_slug='agent-submission' is the
    // machine-agent voice (0.55 base trust); it now supports the full kind set this
    // fn emits (migration 20260715170000).
    const wrote: any[] = [];
    if (allowWrites && Array.isArray(proposed) && proposed.length) {
      const now = new Date().toISOString();
      const ingestUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ingest-observation`;
      const serviceKey = projectSecretKey() ?? "";
      const toWrite = proposed.filter((o) => o && ALLOWED_KINDS.has(o.kind)).slice(0, 5);
      for (let i = 0; i < toWrite.length; i++) {
        const o = toWrite[i];
        try {
          const res = await fetch(ingestUrl, { // guardrail-allow: raw-fetch — internal /functions/v1/ingest-observation call (ingestUrl built from SUPABASE_URL)
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              source_slug: "agent-submission",
              kind: o.kind,
              observed_at: now,
              vehicle_id: vehicleId,
              // Distinct per row so same-turn observations never collapse on the dedup hash.
              source_identifier: `vehicle-agent:${vehicleId}:${now}:${i}`,
              content_text: typeof o.summary === "string" ? o.summary : null,
              structured_data: o.fields && typeof o.fields === "object" ? o.fields : {},
              rank: "normal",
              agent_tier: "interactive",
              agent_model: model,
              agent_duration_ms: durationMs,
              extraction_method: "interactive_agent",
              // Preserve the attribution + self-assessed confidence the raw path carried;
              // ingest-observation computes its own confidence_score from source trust.
              observer_raw: {
                extracted_by: "vehicle-agent",
                on_behalf_of: user.id,
                submitted_by_user_id: user.id,
                self_assessed_confidence: CONFIDENCE.has(o.confidence) ? o.confidence : "low",
              },
              extraction_metadata: { surface: "vehicle-agent", on_behalf_of: user.id },
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body?.error) {
            reply += `\n\n_(Note: I couldn't save the observation: ${body?.error || res.status})_`;
          } else if (body?.observation_id) {
            wrote.push({ id: body.observation_id, kind: o.kind, content_text: o.summary ?? null, duplicate: !!body.duplicate });
          }
        } catch (e) {
          reply += `\n\n_(Note: I couldn't save the observation: ${e instanceof Error ? e.message : "ingest failed"})_`;
        }
      }
    }

    return json(200, {
      reply: reply || "(no response)",
      wrote,
      compute: { model, source: computeNote },
      context: { observations: (obs ?? []).length, analyzed_images: imageSummaries.length },
    });
  } catch (err) {
    console.error(`[vehicle-agent] ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: "The agent hit an error and did not answer. Try again." });
  }
});
