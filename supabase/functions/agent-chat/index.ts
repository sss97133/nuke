// agent-chat — the in-app two-way agent (the "operate in the app, off Claude Code" surface).
//
// Runs on the CALLER'S OWN compute via runWithChain (_shared/claudeSubscriptionAuth):
// their Claude subscription first, then their own API key, then the platform key
// metered against their prepaid wallet. No platform key is required for a user who
// brought their own. It is the
// conversational FRONT-END to the same correction verbs the drill buttons use —
// grounded in the user's own garage, owner-gated (runs as the caller via their JWT),
// every action logged by the underlying RPCs. Not a chatbot bolted on: one verb set,
// two faces (the "Not this vehicle?" button and "these are my white truck" in chat both
// call relink_testimony / create-vehicle).
//
// Contract:
//   POST { messages: [{role:'user'|'assistant', content:string}], context?: {vehicle_id?, image_id?} }
//   → { reply: string, actions: [{tool, input, result}] }
//
// Tools (all run as the authed user under RLS):
//   list_garage()                         — ground the agent in what vehicles exist
//   move_photo(image_id, vehicle_id)      — relink_testimony('image', …) (forks, lineage, logged)
//   create_vehicle(year?, make?, model?)  — new profile owned by the user (the white-truck fork)
//   list_pending_confirmations(vehicle_id)— the Build Ledger's open owner questions
//   answer_confirmation(observation_id,…) — sign one off: ingest-observation → supersede_observation
//
// Why answering lives here and not behind a form: the ledger's questions are
// heterogeneous (yes/no, "what did you pay him", "Mustang or C10?"). A chat that
// holds the pending list and writes the structured answer generalizes; three
// bespoke widgets do not.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runWithChain } from "../_shared/claudeSubscriptionAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-opus-4-8"; // latest; swap per Config if needed

// The owner's own compute, in funnel order (see _shared/claudeSubscriptionAuth.ts):
//   their Claude subscription → their own API key → the platform key (metered).
// A rate-limited subscription is reported back, never silently upgraded to a paid
// call: escalating someone onto a bill without asking is not ours to decide.
const NEVER_AUTO_UPGRADE_SECONDS = Number.MAX_SAFE_INTEGER;

const TOOLS = [
  {
    name: "list_garage",
    description: "List the user's vehicles (id, year, make, model). Call this first to know what profiles exist before moving a photo or deciding whether a new profile is needed.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "move_photo",
    description: "Move a photo to the vehicle it actually belongs to. Forks-not-hides: the photo moves with its history kept and the action is logged. Use when a photo is attributed to the wrong vehicle.",
    input_schema: {
      type: "object",
      properties: {
        image_id: { type: "string", description: "the vehicle_images id of the photo to move" },
        vehicle_id: { type: "string", description: "the destination vehicle id (must already exist; use create_vehicle first if it doesn't)" },
        reason: { type: "string", description: "short why, for the audit/training log" },
      },
      required: ["image_id", "vehicle_id"],
    },
  },
  {
    name: "find_photos",
    description:
      "Search the owner's photos — the find-machine. Filters compose: free-text over the deep-analysis narrative (what the frame SHOWS, e.g. 'trailer', 'loaded', 'paint booth'), a date window, a vehicle, a scene type. Returns matching frames newest-first with their day, attribution, narrative and thumbnail. LIMITATION: text search only reaches ANALYZED frames (~40% of the library and growing); date/vehicle filters reach everything. For event hunts ('when did we ship X'), try several synonyms across calls (trailer, hauler, loaded, transport, strapped) and summarize by DAY.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "one ilike pattern over the narrative, without % wrapping (added automatically)" },
        vehicle_id: { type: "string", description: "restrict to one vehicle profile" },
        date_from: { type: "string", description: "ISO date, inclusive" },
        date_to: { type: "string", description: "ISO date, exclusive" },
        scene_type: { type: "string", description: "exact scene: engine_bay|body_exterior|undercarriage|receipt_document|product_screenshot|wheel_assembly|road_test|off_property|shop_context|..." },
        limit: { type: "number", description: "max rows, default 20, cap 40" },
      },
      required: [],
    },
  },
  {
    name: "create_vehicle",
    description: "Create a NEW vehicle profile owned by the user, for a vehicle that doesn't have one yet (e.g. a daily-driver that got swept into a build's photos). Returns the new vehicle id. At least one of year/make/model is required.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "request_derivation",
    description:
      "Queue the owner's own evidence to be READ by a registered extractor, so the system derives cited claims from it instead of being told what is true. Use when the owner says something like 'you have my titles, why don't you know what I own', 'read my documents', 'figure out when I sold it'. This does not answer the question itself — it schedules the reading, and the claims arrive as observations and confirmation cards. Say plainly that it runs on their own Claude subscription.",
    input_schema: {
      type: "object",
      properties: {
        evidence_type: {
          type: "string",
          description: "which evidence to read: secure_document (titles, bills of sale)",
          enum: ["secure_document"],
        },
        note: { type: "string", description: "the owner's words, recorded on the work item so the derivation's origin is auditable" },
      },
      required: ["evidence_type"],
    },
  },
  {
    name: "list_pending_confirmations",
    description:
      "List the Build Ledger entries on a vehicle that are waiting on the owner's ruling — money the audit could not attribute without them. Call this FIRST whenever the owner asks what needs confirming, and before answer_confirmation, so you quote real questions and real observation ids. Returns each entry's observation_id, the exact question, the drafted amount (may be null when the amount itself is what's being asked), the counterparty and the evidence tier.",
    input_schema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "the vehicle whose ledger to read; defaults to the vehicle_id in the conversation context" },
      },
      required: [],
    },
  },
  {
    name: "answer_confirmation",
    description:
      "Record the owner's ruling on ONE pending ledger entry. This is a Sign-tier action: it writes owner-signed testimony through ingest-observation and supersedes the unconfirmed draft. Never call it until the owner has stated the answer and you have restated it back and they agreed. Never invent an amount — if the question asks what was paid and the owner has not said, ask. Set confirmed=false when the owner says the entry does not belong to this vehicle.",
    input_schema: {
      type: "object",
      properties: {
        observation_id: { type: "string", description: "the draft's observation_id, exactly as returned by list_pending_confirmations" },
        confirmed: { type: "boolean", description: "true if this entry belongs to this vehicle as drafted; false if the owner rejects it" },
        owner_answer: { type: "string", description: "the owner's answer in their own words, verbatim — this is the testimony" },
        amount_usd: { type: "number", description: "the dollar amount the owner stated, when the question asked for one. Omit to keep the draft's amount." },
        belongs_to_vehicle_id: { type: "string", description: "when the owner says the entry belongs to a DIFFERENT vehicle, its id from list_garage" },
      },
      required: ["observation_id", "confirmed", "owner_answer"],
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    // Run every DB action AS THE CALLER (their JWT → RLS + relink p_actor_user_id).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "Invalid session" }, 401);

    // Credential resolution + credit metering need service role: ai_credit_ledger
    // has no INSERT policy for `authenticated`. Identity is NOT taken from this
    // client — userId above came from the verified JWT and is passed explicitly.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const userMessages = Array.isArray(body.messages) ? body.messages : [];
    const ctx = body.context ?? {};

    const system =
      "You help the owner ORGANIZE, FIND and CONFIRM the facts of their own vehicles inside the " +
      "Nuke app. You are the conversational face of the same tools the app's buttons use. The owner's " +
      "context: " + JSON.stringify(ctx) + ". When the owner says photos belong to a different " +
      "or a not-yet-existing vehicle (e.g. 'these interior shots are my white daily-driver'), " +
      "call list_garage to see what exists, create_vehicle if the right one doesn't, then " +
      "move_photo. When the owner is LOOKING for something ('the day we shipped the K10', " +
      "'that receipt from CarQuest'), use find_photos — try several synonym patterns across " +
      "calls, then answer with the DAY(s) and a one-line story per day, never a raw row dump. " +
      "Say honestly when a hunt only covered analyzed frames. Be concise. Confirm actions in " +
      "one line. Never invent vehicle ids — only use ids from list_garage or a fresh create_vehicle.\n\n" +
      "CONFIRMING THE BUILD LEDGER. The ledger holds money the audit could not attribute without " +
      "the owner's ruling. Always call list_pending_confirmations before you discuss them, and quote " +
      "the questions as they are written — never paraphrase a number, never invent one. Work ONE " +
      "question at a time, oldest first, and do not move on until it is answered or the owner defers. " +
      "The questions come in three shapes: a yes/no ('was this $1,000 for the Mustang?'), an amount " +
      "the owner alone knows ('what did you pay Walter?'), and a choice between vehicles ('Mustang or " +
      "C10?') — for that last shape call list_garage first so you can name the candidates. " +
      "Before calling answer_confirmation, RESTATE the ruling in one sentence including the dollar " +
      "figure and wait for the owner to agree; a confirmation is a signature, and signatures are not " +
      "inferred from an ambiguous 'yeah'. If the owner does not know, say the entry stays open — that " +
      "is a correct outcome, not a failure. Pass their words to owner_answer verbatim. After a write " +
      "lands, say what changed in one line (what booked, to which vehicle) and move to the next question.";

    const messages = userMessages.map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? ""),
    }));

    const actions: any[] = [];
    let creditSource: string | null = null;
    let chargedCents = 0;

    // Tool-use loop, bounded (search sessions need a few synonym passes).
    for (let turn = 0; turn < 6; turn++) {
      let run;
      try {
        run = await runWithChain(
          admin,
          userId,
          { model: MODEL, max_tokens: 1024, system, tools: TOOLS, messages },
          { mode: "slow", maxWaitSeconds: NEVER_AUTO_UPGRADE_SECONDS },
        );
      } catch (e) {
        // No subscription, no key of their own, no platform key.
        return json({
          error: "no_credential",
          reply: "Connect your Claude subscription or add an Anthropic API key in Settings → Connected Agents, and I'll run on your own plan.",
          detail: String(e instanceof Error ? e.message : e),
        }, 402);
      }

      creditSource = run.source;
      chargedCents += run.chargedCents ?? 0;

      if (run.needsFunding) {
        return json({
          error: "needs_funding",
          reply: "Your Claude subscription is rate-limited right now and there's no key or balance to fall back on. Wait it out, or add an API key in Settings → Connected Agents.",
          source: run.source, retry_after_seconds: run.retryAfterSeconds, actions,
        }, 402);
      }
      if (run.serviceError) {
        return json({ error: "service_unavailable", detail: run.serviceError, actions }, 503);
      }
      if (run.rateLimited) {
        const mins = run.retryAfterSeconds ? Math.ceil(run.retryAfterSeconds / 60) : null;
        return json({
          error: "rate_limited",
          reply: `Your Claude plan is rate-limited${mins ? ` for about ${mins} more minute${mins === 1 ? "" : "s"}` : ""}. Nothing was charged. Try again then, or add an API key to run now.`,
          source: run.source, retry_after_seconds: run.retryAfterSeconds, actions,
        }, 429);
      }
      if (!run.ok) {
        return json({ error: `agent upstream ${run.status}`, detail: run.body, source: run.source }, 502);
      }

      const data = run.body;
      const toolUses = (data.content ?? []).filter((b: any) => b.type === "tool_use");

      if (toolUses.length === 0) {
        const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        return json({
          reply: text || "(no reply)",
          actions,
          source: creditSource,
          charged_cents: chargedCents || undefined,
        });
      }

      // Execute each tool, feed results back.
      messages.push({ role: "assistant", content: data.content });
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const result = await runTool(supabase, userId, tu.name, tu.input ?? {}, ctx);
        actions.push({ tool: tu.name, input: tu.input, result });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return json({
      reply: "Stopped after several steps — try rephrasing.",
      actions, source: creditSource, charged_cents: chargedCents || undefined,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// A pending draft is any live audit_draft_v0 work_record flagged for the owner.
// Once its successor exists (owner_confirmed_v1 / owner_rejected_v1 pointing back
// via supersedes_original_id), the question is answered even if the supersession
// flag write hasn't landed yet — so we never ask the same question twice after a
// partial failure.
function pendingFromLedger(rows: any[]) {
  const answered = new Set(
    rows.map((r: any) => r.structured_data?.supersedes_original_id).filter(Boolean),
  );
  return rows.filter(
    (r: any) => r.structured_data?.needs_owner_confirmation === true && !answered.has(r.observation_id),
  );
}

async function runTool(supabase: any, userId: string, name: string, input: any, ctx: any = {}) {
  try {
    if (name === "request_derivation") {
      // The app receiving a message and acting on it: the owner's sentence becomes
      // work items. derive-dispatch drains them on a schedule, on their compute.
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      if (input.evidence_type !== "secure_document") return { error: "no reader registered for that evidence yet" };

      // Only the caller's own, human-approved evidence. Identity comes from the JWT.
      const { data: docs } = await admin
        .from("secure_documents")
        .select("id")
        .eq("user_id", userId)
        .eq("document_type", "vehicle_title")
        .eq("verification_status", "approved");
      if (!docs?.length) return { queued: 0, note: "no approved title documents to read" };

      const rows = docs.map((d: any) => ({
        user_id: userId,
        evidence_type: "secure_document",
        evidence_id: d.id,
        extractor_slug: "title-document-reader",
        requested_by: "agent",
        request_note: input.note ?? null,
        priority: 50, // a human asked; ahead of background backfill
      }));
      // Unique (evidence_type, evidence_id, extractor_slug): asking twice is a no-op.
      const { error } = await admin.from("derivation_queue").upsert(rows, {
        onConflict: "evidence_type,evidence_id,extractor_slug",
        ignoreDuplicates: true,
      });
      if (error) throw error;

      const { count } = await admin
        .from("derivation_queue")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("status", "pending");

      return { queued_or_already_queued: rows.length, pending_now: count ?? null, runs_on: "your own Claude subscription" };
    }

    if (name === "list_pending_confirmations") {
      const vehicleId = input.vehicle_id || ctx.vehicle_id;
      if (!vehicleId) return { error: "no vehicle in context — ask the owner which vehicle" };
      // SECURITY DEFINER + auth.uid() ownership check lives inside the RPC.
      const { data, error } = await supabase.rpc("get_vehicle_build_ledger", { p_vehicle_id: vehicleId });
      if (error) throw error;
      const pending = pendingFromLedger(data ?? []);
      return {
        vehicle_id: vehicleId,
        pending_count: pending.length,
        entries: pending.map((r: any) => ({
          observation_id: r.observation_id,
          observed_at: (r.observed_at ?? "").slice(0, 10),
          question: r.structured_data?.confirmation_question ?? null,
          drafted_amount_usd: r.structured_data?.amount_usd ?? null,
          counterparty: r.structured_data?.counterparty ?? null,
          evidence_tier: r.structured_data?.evidence_tier ?? null,
          description: r.content_text ?? null,
        })),
      };
    }

    if (name === "answer_confirmation") {
      const vehicleId = ctx.vehicle_id;
      if (!vehicleId) return { error: "no vehicle in context" };
      if (!input.observation_id || typeof input.confirmed !== "boolean" || !input.owner_answer) {
        return { error: "need observation_id, confirmed (bool) and owner_answer" };
      }

      // Read the draft through the owner-scoped RPC. This IS the authorization for
      // the ingest-observation call below (which runs service-role and does not
      // authenticate its caller): a non-owner gets zero rows and cannot proceed.
      const { data: ledger, error: readErr } = await supabase.rpc("get_vehicle_build_ledger", { p_vehicle_id: vehicleId });
      if (readErr) throw readErr;
      const draft = (ledger ?? []).find((r: any) => r.observation_id === input.observation_id);
      if (!draft) return { error: "that observation is not a live ledger entry on this vehicle" };
      if (draft.structured_data?.needs_owner_confirmation !== true) {
        return { error: "that entry is not awaiting confirmation" };
      }

      // Self-heal a partial failure: if a previous call wrote the successor but the
      // supersession didn't land, finish that job rather than minting a second
      // successor (answered_at makes every ingest payload hash uniquely, so the
      // dedup guard inside ingest-observation would not catch it).
      const { data: orphans } = await supabase
        .from("vehicle_observations")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .eq("structured_data->>supersedes_original_id", input.observation_id)
        .limit(1);
      if (orphans?.length) {
        const { error: healErr } = await supabase.rpc("supersede_observation", {
          p_original_id: input.observation_id,
          p_successor_id: orphans[0].id,
        });
        if (healErr) return { error: "could not finish a prior partial write", detail: String(healErr.message ?? healErr) };
        return { ok: true, ruling: "already answered", superseded_draft: input.observation_id, successor_id: orphans[0].id, healed: true };
      }

      const drafted = draft.structured_data?.amount_usd ?? null;
      const amount = input.amount_usd != null ? Number(input.amount_usd) : drafted;
      // Never book a confirmed cost with no number behind it.
      if (input.confirmed && (amount == null || Number.isNaN(Number(amount)))) {
        return { error: "this entry has no drafted amount — ask the owner what was paid before confirming" };
      }

      const successorData: Record<string, unknown> = {
        ...(draft.structured_data ?? {}),
        needs_owner_confirmation: false,
        confirmation_question: draft.structured_data?.confirmation_question ?? null,
        owner_answer: String(input.owner_answer),
        answered_at: new Date().toISOString(),
        supersedes_original_id: input.observation_id,
      };
      if (input.confirmed) {
        successorData.owner_confirmed = true;   // → confidence 'verified' in ingest-observation
        successorData.attribution_tier = "confirmed";
        successorData.amount_usd = Number(amount);
      } else {
        successorData.owner_rejected = true;
        // Reattribution is a separate verb; record the claim, don't act on it here.
        if (input.belongs_to_vehicle_id) successorData.owner_says_belongs_to_vehicle_id = input.belongs_to_vehicle_id;
      }

      // Step 1 — successor through the single write path.
      const ingest = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ingest-observation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          source_slug: "owner-input",
          kind: "work_record",
          observed_at: draft.observed_at,
          vehicle_id: vehicleId,
          content_text: draft.content_text,
          structured_data: successorData,
          extraction_method: input.confirmed ? "owner_confirmed_v1" : "owner_rejected_v1",
          observer_raw: { owner_user_id: userId, via: "agent-chat" },
        }),
      });
      const ingested = await ingest.json();
      const successorId = ingested?.observation_id ?? ingested?.observation?.id;
      if (!ingest.ok || !successorId) {
        return { error: "could not write the owner's answer", detail: ingested };
      }

      // Step 2 — supersede the draft. Idempotent; a retry after a crash finishes the job.
      const { data: sup, error: supErr } = await supabase.rpc("supersede_observation", {
        p_original_id: input.observation_id,
        p_successor_id: successorId,
      });
      if (supErr) {
        return {
          error: "answer recorded but the draft is still live — retry answer_confirmation",
          successor_id: successorId,
          detail: String(supErr.message ?? supErr),
        };
      }

      return {
        ok: true,
        ruling: input.confirmed ? "confirmed" : "rejected",
        superseded_draft: input.observation_id,
        successor_id: successorId,
        amount_usd: input.confirmed ? Number(amount) : null,
        already: sup?.already === true,
      };
    }

    if (name === "list_garage") {
      const { data, error } = await supabase.rpc("get_user_garage", { p_user_id: userId });
      if (error) throw error;
      return (data ?? []).map((v: any) => ({ vehicle_id: v.vehicle_id, year: v.year, make: v.make, model: v.model, relationship: v.relationship }));
    }
    if (name === "create_vehicle") {
      if (!input.year && !input.make && !input.model) return { error: "need at least one of year/make/model" };
      const { data, error } = await supabase
        .from("vehicles")
        .insert({ year: input.year, make: input.make, model: input.model, owner_id: userId, is_public: false })
        .select("id").single();
      if (error) throw error;
      return { vehicle_id: data.id };
    }
    if (name === "find_photos") {
      const lim = Math.min(Math.max(Number(input.limit) || 20, 1), 40);
      let q = supabase
        .from("vehicle_images")
        .select("id, vehicle_id, taken_at, thumbnail_url, image_url, ai_scan_metadata")
        .eq("user_id", userId)
        .order("taken_at", { ascending: false })
        .limit(lim);
      if (input.vehicle_id) q = q.eq("vehicle_id", input.vehicle_id);
      if (input.date_from) q = q.gte("taken_at", input.date_from);
      if (input.date_to) q = q.lt("taken_at", input.date_to);
      if (input.scene_type) q = q.eq("ai_scan_metadata->byok_deep_analysis->>scene_type", input.scene_type);
      if (input.text) q = q.ilike("ai_scan_metadata->byok_deep_analysis->>narrative_one_line", `%${input.text}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        image_id: r.id,
        vehicle_id: r.vehicle_id,
        day: (r.taken_at ?? "").slice(0, 10),
        narrative: r.ai_scan_metadata?.byok_deep_analysis?.narrative_one_line ?? null,
        scene: r.ai_scan_metadata?.byok_deep_analysis?.scene_type ?? null,
        thumbnail: r.thumbnail_url ?? r.image_url ?? null,
      }));
    }
    if (name === "move_photo") {
      if (!input.image_id || !input.vehicle_id) return { error: "need image_id and vehicle_id" };
      const { data, error } = await supabase.rpc("relink_testimony", {
        p_observation_type: "image",
        p_observation_id: input.image_id,
        p_target_vehicle_id: input.vehicle_id,
        p_reason: input.reason ? `agent · ${input.reason}` : "agent · owner correction",
        p_actor_user_id: userId,
      });
      if (error) throw error;
      return data ?? { moved: true };
    }
    return { error: `unknown tool ${name}` };
  } catch (e) {
    return { error: String(e) };
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
