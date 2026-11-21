/**
 * Vehicle Agent — interactive Claude, with a single vehicle's data as the harness.
 *
 * This is the per-vehicle agent: you message it about ONE target, and the vehicle's
 * own long-term memory (vehicle_observations) + its deep-analyzed images
 * (ai_scan_metadata.byok_deep_analysis) are loaded as the context it reasons over.
 * The DB is the memory; this function is the ephemeral reconstitution of it.
 *
 * POST /functions/v1/vehicle-agent
 *   A turn:    { vehicle_id: uuid, message: string, history?: [{role, content}], allow_writes?: boolean,
 *                propose?: boolean (the caller renders Confirm / Dismiss), conversation_ref?: uuid }
 *              → { reply, proposals: [{ id, writer, summary, token }], logged, wrote: [], compute, context }
 *   A confirm: { vehicle_id: uuid, confirm: <token from a proposal>, speaker_role?: string }
 *              → { confirmed: { id, writer, record_id, replay } }
 *
 * SCOPE (scope.ts): everything is pinned to the request's vehicle_id; the model never supplies a vehicle, and a
 * proposal naming another vehicle is refused, so agents open on two cards cannot touch each other's car.
 *
 * WRITES are propose-then-confirm. With allow_writes and propose the model may only PROPOSE (nothing is written during a turn).
 * Each proposal is signed by this function and shown in the card with Confirm / Dismiss; Confirm sends the token back,
 * and only then, after re-checking the signature, account, vehicle, tie and the writer allow-list, does a writer run:
 *   record_vehicle_statement — the person's own latest message, stored whole as their claim, called with their session;
 *   ingest-observation       — the agent's finding (source agent-submission, rank normal), on behalf of the person.
 * Until 2026-11-20 the agent wrote up to five observations per turn directly, with allow_writes on by default.
 *
 * SESSIONS: when the person has turned on "keep this car's agent sessions" for this car (user_consents scope
 * vehicle_agent_log, set by set_vehicle_agent_log_consent), each completed turn is stored by record_vehicle_agent_turn,
 * which reads that consent itself and stores nothing without it. Off by default. A failed store never fails the turn.
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
 *
 * Session turns are kept by record_vehicle_agent_turn (migration 20261121060000), only with the account's consent.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectPublishableKey, projectSecretKey } from "../_shared/supabaseKeys.ts";
import { floorClaudeModel, CLAUDE_FLOOR_MODEL } from "../_shared/llmProvider.ts";
import {
  isUuid, normalizeProposals, PROPOSAL_TTL_MS, signProposal, speakerRole, splitReply, verifyProposal,
  type ObservationArgs, type SignedPayload, type StatementArgs,
} from "./scope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

/** Plain sentences for the statement writer's refusals; anything else is shown as the writer said it. */
function statementRefusal(message: string): string {
  if (/no access to this vehicle/.test(message)) {
    return "The log book takes words only from people the car's record names or who hold access to it, so this was not kept.";
  }
  if (/requires the vehicle record to name the speaker as owner/.test(message)) {
    return "The car's record does not name you as its owner, so this was not kept as an owner's word.";
  }
  if (/too many statements/.test(message)) return "Too many notes in the last hour. Try again later.";
  if (/identified, current vehicle/.test(message)) return "This car was merged or removed, so its log book cannot take notes.";
  return message;
}

/**
 * Confirm: the person pressed Confirm on a proposal this function signed. Verify it, re-check the tie (done by the
 * caller), the pin and the allow-list, then run the one writer it names. The model is not called.
 */
async function confirmProposal(
  service: any, authHeader: string, userId: string, vehicleId: string, body: any, secret: string,
): Promise<Response> {
  const verified = await verifyProposal(body.confirm, secret, { userId, vehicleId, now: Date.now() });
  if (!verified.ok) {
    console.warn(`[vehicle-agent] confirm refused: ${verified.reason}`);
    return json(400, { error: `That proposal cannot be confirmed (${verified.reason}). Ask the agent again.` });
  }
  const proposal = verified.value;

  if (proposal.writer === "record_vehicle_statement") {
    const args = proposal.args as StatementArgs;
    const { data: veh } = await service.from("vehicles").select("owner_id").eq("id", vehicleId).maybeSingle();
    const role = speakerRole(body.speaker_role, veh?.owner_id === userId);
    if (!role.ok) return json(400, { error: `Not kept: ${role.reason}.` });
    // The writer takes the speaker from authentication only, so it runs with the person's own session.
    const asPerson = createClient(Deno.env.get("SUPABASE_URL")!, projectPublishableKey()!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await asPerson.rpc("record_vehicle_statement", {
      p_request_id: proposal.id, p_vehicle_id: vehicleId, p_statement: args.statement,
      p_speaker_role: role.value, p_statement_kind: args.statement_kind,
      p_said_at_basis: "typed to the car's agent in the garage, confirmed by the speaker at the recorded time",
      p_recording_agent: "vehicle-agent (proposed; confirmed by the speaker)",
      p_target_key: args.target_key, p_target_value: args.target_value,
      p_conversation_ref: isUuid(body.conversation_ref) ? body.conversation_ref : null,
    });
    if (error) return json(400, { error: statementRefusal(error.message) });
    return json(200, { confirmed: { id: proposal.id, writer: proposal.writer, record_id: data?.statement_id ?? null, replay: !!data?.replay } });
  }

  // ingest_observation: the agent's own finding, on behalf of the person, through the canonical rail.
  const args = proposal.args as ObservationArgs;
  // observed_at is when the agent made the finding (the proposal's issue time), so every field the intake hashes is
  // fixed by the signed proposal and a second press of Confirm lands on the same content_hash, not a second row.
  const proposedAt = new Date(proposal.exp - PROPOSAL_TTL_MS).toISOString();
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ingest-observation`, { // guardrail-allow: raw-fetch — internal /functions/v1/ingest-observation call (URL built from SUPABASE_URL)
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        source_slug: "agent-submission",
        kind: args.kind,
        observed_at: proposedAt,
        vehicle_id: vehicleId,
        source_identifier: `vehicle-agent:${vehicleId}:${proposal.id}`,
        content_text: args.summary,
        structured_data: args.fields,
        rank: "normal",
        agent_tier: "interactive",
        agent_model: proposal.model,
        extraction_method: "interactive_agent",
        observer_raw: {
          extracted_by: "vehicle-agent",
          on_behalf_of: userId,
          submitted_by_user_id: userId,
          self_assessed_confidence: args.confidence,
          proposal_id: proposal.id,
        },
        extraction_metadata: {
          surface: "vehicle-agent", on_behalf_of: userId, proposal_id: proposal.id,
          confirmed_by_user_at: new Date().toISOString(),
        },
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out?.error || !out?.observation_id) {
      console.error(`[vehicle-agent] ingest refused: ${out?.error || res.status}`);
      return json(502, { error: `Not recorded: ${out?.error || `the observation writer answered ${res.status}`}.` });
    }
    return json(200, { confirmed: { id: proposal.id, writer: proposal.writer, record_id: out.observation_id, replay: !!out.duplicate } });
  } catch (e) {
    console.error(`[vehicle-agent] ingest failed: ${e instanceof Error ? e.message : String(e)}`);
    return json(502, { error: "Not recorded: the observation writer did not answer. Try again." });
  }
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
    // Lets the model PROPOSE; nothing is written without a Confirm. Only a caller that renders Confirm / Dismiss (the
    // garage agent box sends propose: true) is offered proposals; the profile chat and the iOS app get answers only.
    const allowWrites = body.allow_writes !== false && body.propose === true;
    if (!isUuid(vehicleId)) return json(400, { error: "That is not a vehicle id." });
    const confirming = body.confirm !== undefined;
    if (!confirming && !message) return json(400, { error: "Type a message first." });

    // Access check: the caller holds the car by one of the garage's own routes, or uploaded
    // images of it. Not vehicle_user_has_access: its admin branch admits every vehicle (it
    // admitted 300 of 300 sampled non-garage cars for an admin account on 2026-11-20). The
    // images-only check refused 61 of 198 garage cars on two admin accounts; these routes
    // admit 198 of 198 and 0 of 900 sampled non-garage cars.
    if (!(await isTied(supabase, vehicleId, user.id))) {
      return json(403, { error: "This car's agent answers only people who hold the car." });
    }

    // Proposals are signed with a key derived from the function's own secret key (scope.ts); no new secret.
    const signingSecret = projectSecretKey() ?? "";
    if (!signingSecret) return json(503, { error: "The agent cannot sign its proposals right now." });
    if (confirming) {
      return await confirmProposal(supabase, req.headers.get("Authorization")!, user.id, vehicleId, body, signingSecret);
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
        ? `You cannot write anything yourself. If — and only if — this exchange establishes a DURABLE new fact about ` +
          `this vehicle that isn't already in the observations, you may PROPOSE a record; the person sees it with ` +
          `Confirm / Dismiss and nothing is stored unless they confirm. End your reply with a fenced json block:\n` +
          "```json\n{\"proposals\":[\n" +
          "  {\"writer\":\"record_vehicle_statement\",\"statement_kind\":\"assertion|recollection|estimate\",\"target_key\":null,\"target_value\":null},\n" +
          "  {\"writer\":\"ingest_observation\",\"kind\":\"condition|specification|valuation|provenance|expert_opinion|work_record|ownership|activity|sighting\",\"summary\":\"...\",\"fields\":{},\"confidence\":\"high|medium|low|inferred\"}\n" +
          "]}\n```\n" +
          `record_vehicle_statement keeps the person's latest message, word for word, as their own claim: propose it only ` +
          `when that message itself states something about this car (not for a question). target_key/target_value ` +
          `(lower_snake_case key, short value) are optional. ingest_observation records a finding of yours from this ` +
          `car's data, in your own voice. At most ${3} proposals. Never name another vehicle or any id: everything ` +
          `applies to this car only. Most replies need NO json block.`
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

    // Split prose from an optional trailing json block of proposals; validate, pin and sign them.
    const { reply: prose, block } = splitReply(raw);
    let reply = prose;
    const proposals: Array<{ id: string; writer: string; summary: string; token: string }> = [];
    if (allowWrites && block) {
      const { proposals: checked, refused } = normalizeProposals(block, { vehicleId, userMessage: message });
      if (refused.length) console.warn(`[vehicle-agent] refused ${refused.length} proposal(s): ${refused.map((r) => r.reason).join("; ")}`);
      const exp = Date.now() + PROPOSAL_TTL_MS;
      for (const proposal of checked) {
        const payload = { ...proposal, v: 1, id: crypto.randomUUID(), user_id: user.id, vehicle_id: vehicleId, model, exp } as SignedPayload;
        proposals.push({ id: payload.id, writer: payload.writer, summary: payload.summary, token: await signProposal(payload, signingSecret) });
      }
    }
    if (!reply) reply = proposals.length ? "Here is what I can record." : "(no response)";

    // ── The session, kept only with the person's consent for this car (checked inside the writer) ──
    let logged = false;
    if (isUuid(body.conversation_ref)) {
      try {
        const { data: kept, error: keepError } = await supabase.rpc("record_vehicle_agent_turn", {
          p_user_id: user.id, p_vehicle_id: vehicleId, p_conversation_ref: body.conversation_ref,
          p_turn_id: crypto.randomUUID(), p_message: message, p_reply: reply, p_model: model,
        });
        if (keepError) console.error(`[vehicle-agent] session not kept: ${keepError.message}`);
        logged = kept?.stored === true;
      } catch (e) {
        console.error(`[vehicle-agent] session not kept: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return json(200, {
      reply,
      proposals,
      logged,
      // Nothing is written during a turn any more; kept for the profile chat and the iOS app, which read it.
      wrote: [],
      compute: { model, source: computeNote, duration_ms: durationMs },
      context: { observations: (obs ?? []).length, analyzed_images: imageSummaries.length },
    });
  } catch (err) {
    console.error(`[vehicle-agent] ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: "The agent hit an error and did not answer. Try again." });
  }
});
