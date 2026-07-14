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
 * (decrypted server-side); otherwise the platform key. (A Claude *subscription* OAuth
 * token isn't a Messages-API credential, so byo_subscription uses the platform key for
 * synchronous chat — the async drain is where the subscription is spent.)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Authentication required" });
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return json(401, { error: "Invalid authentication" });

    const body = await req.json().catch(() => ({}));
    const vehicleId = String(body.vehicle_id || "");
    const message = String(body.message || "").trim();
    const history: Array<{ role: string; content: string }> = Array.isArray(body.history)
      ? body.history.slice(-12)
      : [];
    const allowWrites = body.allow_writes !== false; // default on; the user chose "it can write"
    if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return json(400, { error: "vehicle_id must be a uuid" });
    if (!message) return json(400, { error: "message is required" });

    // Access check: the caller must have images on this vehicle (their data).
    const { count: owns, error: oe } = await supabase
      .from("vehicle_images").select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId).eq("user_id", user.id);
    if (oe) return json(500, { error: "access check failed: " + oe.message });
    if (!owns) return json(403, { error: "You don't have access to that vehicle." });

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
    const model = (settings?.model && /^claude-/.test(settings.model)) ? settings.model : "claude-sonnet-4-6";
    let apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
    let computeNote = "platform";
    if (settings?.method === "byo_api_key" && settings.provider === "anthropic") {
      const { data: cred } = await supabase.rpc("get_analysis_credential", { p_user_id: user.id });
      if (cred) { apiKey = String(cred); computeNote = "your_api_key"; }
    }
    if (!apiKey) return json(503, { error: "No Anthropic key available for chat. Set one in Settings or configure the platform key." });

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
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1500, system, messages }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!aiRes.ok) {
      const detail = await aiRes.text().catch(() => "");
      return json(502, { error: "Claude error", status: aiRes.status, detail: detail.slice(0, 300) });
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

    // ── Provenance-stamped writes (rank normal, on behalf of the user) ───────
    const wrote: any[] = [];
    if (allowWrites && Array.isArray(proposed) && proposed.length) {
      const now = new Date().toISOString();
      const rows = proposed
        .filter((o) => o && ALLOWED_KINDS.has(o.kind))
        .slice(0, 5)
        .map((o) => ({
          vehicle_id: vehicleId,
          subject_type: "vehicle",
          observed_at: now,
          kind: o.kind,
          rank: "normal",
          structured_data: o.fields && typeof o.fields === "object" ? o.fields : {},
          content_text: typeof o.summary === "string" ? o.summary : null,
          confidence: CONFIDENCE.has(o.confidence) ? o.confidence : "low",
          submitted_by_user_id: user.id,
          agent_model: model,
          agent_tier: "interactive",
          extraction_method: "interactive_agent",
          extracted_by: "vehicle-agent",
          agent_duration_ms: durationMs,
          processing_metadata: { surface: "vehicle-agent", on_behalf_of: user.id },
        }));
      if (rows.length) {
        const { data: ins, error: ie } = await supabase
          .from("vehicle_observations").insert(rows).select("id, kind, content_text");
        if (ie) reply += `\n\n_(Note: I couldn't save the observation: ${ie.message})_`;
        else wrote.push(...(ins || []));
      }
    }

    return json(200, {
      reply: reply || "(no response)",
      wrote,
      compute: { model, source: computeNote },
      context: { observations: (obs ?? []).length, analyzed_images: imageSummaries.length },
    });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unexpected error" });
  }
});
