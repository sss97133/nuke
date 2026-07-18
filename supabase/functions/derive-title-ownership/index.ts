// derive-title-ownership — the first real derivation: evidence → cited claim → question.
//
// THE POINT
// Nuke's theory (docs/library/intellectual/contemplations/testimony-and-half-lives.md)
// says the profile is a PROJECTION computed from a testimony stream, and that
// identity/provenance testimony — a VIN stamped in metal, a title issued by a state —
// is PERMANENT (observation_half_lives: specification/provenance = 999999 days) while
// an owner's assertion about present state decays. So a title outranks its owner, not
// because the state is a better person, but because an instrument is a different
// category of testimony than a claim.
//
// Until now nothing in the system read a title. 35 approved title scans sat in
// secure_documents while `vehicles.owner_id` — a column somebody typed — was treated
// as ownership. This function inverts that: the document speaks, the claim is cited,
// and where the document and the database disagree the owner is ASKED rather than
// overruled.
//
// WHAT IT DOES NOT DO
// It never writes vehicle_ownerships and never touches vehicles.owner_id. It emits
// observations through ingest-observation (the single write path) and lets the
// projection be recomputed. A claim it cannot ground — unreadable VIN, no matching
// vehicle, a name that isn't the uploader's — becomes needs_owner_confirmation and
// surfaces in the Ask panel, answered by `answer_confirmation`.
//
// COMPUTE IS THE CALLER'S. Vision runs through runWithChain: the user's Claude
// subscription, then their own API key, then the platform key metered to their
// balance. Onboarding burns the user's own tokens, by design.
//
// Contract:
//   POST { document_id?: string, limit?: number, dry_run?: boolean }
//     → { derived: [...], skipped: [...], dry_run: boolean }
//   Runs for the CALLER (their JWT). Only their own approved vehicle_title documents.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runWithChain } from "../_shared/claudeSubscriptionAuth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const MODEL = "claude-opus-4-8";
const BUCKET = "user-documents";

// Storage's render endpoint downscales server-side. Full title scans are ~3.6 MB;
// base64 of that pushes past the vision payload ceiling. `resize=contain` matters —
// the default is `cover`, which would crop the corners off a document.
const RENDER_WIDTH = 1600;

const TITLE_SCHEMA = {
  name: "title_reading",
  description: "Fields read verbatim off a vehicle title document. Never infer; leave null if not legible.",
  input_schema: {
    type: "object",
    properties: {
      legible: { type: "boolean", description: "false if the image is not a readable vehicle title" },
      is_vehicle_title: { type: "boolean", description: "false if this document is something else (registration, bill of sale, insurance card)" },
      vin: { type: "string", description: "VIN exactly as printed. null if not legible." },
      year: { type: "number" },
      make: { type: "string" },
      model: { type: "string" },
      title_number: { type: "string" },
      state: { type: "string", description: "issuing state, two-letter" },
      title_issued: { type: "string", description: "ISO date the title was issued, if printed" },
      owner_names: { type: "array", items: { type: "string" }, description: "registered owner(s) exactly as printed" },
      owner_address: { type: "string" },
      prior_owner_names: { type: "array", items: { type: "string" } },
      lienholder: { type: "string", description: "lienholder if any; null if the title is clear" },
      brand: { type: "string", description: "title brand if printed: salvage, rebuilt, flood, lemon, clear" },
      excerpt: { type: "string", description: "the verbatim line(s) the VIN and owner name were read from — this becomes the citation" },
      confidence: { type: "number", description: "0-1, how certain you are of the VIN and owner name specifically" },
    },
    required: ["legible", "is_vehicle_title", "confidence"],
  },
};

const SYSTEM =
  "You read vehicle title documents and report ONLY what is printed. You never infer, " +
  "never complete a partial VIN, never guess a name from context. A field you cannot read " +
  "is null. If the image is not a vehicle title, say so. The excerpt you return is quoted " +
  "verbatim from the document and becomes the legal citation for every claim derived from it.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    // Caller identity (RLS): only ever their own documents.
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await caller.auth.getUser();

    // Operator path: service_role may derive on a named user's behalf (backfill,
    // support). Same shape as ingest-receipts-as-observations. Decode the role claim
    // rather than string-comparing the bearer — the gateway may re-sign the header.
    // A user JWT can never reach this branch: getUser() would have resolved an id.
    // Two ways to be an operator: a service_role JWT from outside, or an internal
    // call from derive-dispatch. Supabase's gateway rewrites Authorization on
    // function-to-function calls, so the forwarded role claim cannot be trusted —
    // the dispatcher proves itself with the shared secret instead.
    const internalSecret = req.headers.get("x-nuke-internal");
    const isServiceRole = roleOf(authHeader) === "service_role"
      || (!!internalSecret && internalSecret === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const bodyPeek = await req.clone().json().catch(() => ({}));
    const userId = userData?.user?.id ?? (isServiceRole ? bodyPeek.user_id : undefined);
    if (!userId) return json({ error: "Invalid session", service_role: isServiceRole }, 401);

    // Storage read + ingest + credential resolution need service role. Identity is
    // NOT taken from this client — userId came from the verified JWT above.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const limit = Math.min(Math.max(Number(body.limit) || 1, 1), 40);
    // Only an operator can spend the platform's compute; a user JWT can never set this.
    const usePlatform = isServiceRole && body.platform_credential === true;

    // Who is the uploader, by name? Needed to tell "your title" from "a title you
    // photographed". Never used to conclude — only to decide whether to ask.
    const { data: prof } = await admin.from("profiles").select("full_name, username").eq("id", userId).maybeSingle();
    const uploaderNames = [prof?.full_name, prof?.username]
      .filter(Boolean).flatMap((n: string) => n.toLowerCase().split(/\s+/)).filter((n) => n.length > 2);

    let q = admin
      .from("secure_documents")
      .select("id, storage_path, mime_type, file_hash, created_at")
      .eq("user_id", userId)
      .eq("document_type", "vehicle_title")
      .eq("verification_status", "approved")
      .order("created_at");
    if (body.document_id) q = q.eq("id", body.document_id);

    const { data: allDocs, error: docErr } = await q;
    if (docErr) throw docErr;
    if (!allDocs?.length) return json({ derived: [], skipped: [], note: "no approved title documents" });

    // The same title uploaded four times is ONE piece of evidence. Dedupe on the
    // bytes, not the row — otherwise replay multiplies the record instead of
    // converging on it. (file_hash is null on older rows; fall back to the id.)
    const byHash = new Map<string, typeof allDocs[number]>();
    for (const d of allDocs) if (!byHash.has(d.file_hash ?? d.id)) byHash.set(d.file_hash ?? d.id, d);
    const docs = [...byHash.values()].slice(0, limit);
    const dupesCollapsed = allDocs.length - byHash.size;

    // Idempotence: a document already cited by a live observation is not re-derived.
    // This is what makes onboarding replayable rather than duplicative.
    const { data: already } = await admin
      .from("vehicle_observations")
      .select("citation_secure_document_id")
      .in("citation_secure_document_id", docs.map((d) => d.id))
      .eq("is_superseded", false);
    const seen = new Set((already ?? []).map((r: any) => r.citation_secure_document_id));

    const derived: unknown[] = [];
    const skipped: unknown[] = [];
    // Two scans of one title are two files with different bytes but ONE claim.
    // Evidence dedupes on what it asserts (VIN + title number), never on the file.
    const claimsSeen = new Set<string>();

    for (const doc of docs) {
      if (seen.has(doc.id)) { skipped.push({ document_id: doc.id, reason: "already derived" }); continue; }

      const b64 = await fetchDocumentAsBase64(admin, doc.storage_path);
      if (!b64) { skipped.push({ document_id: doc.id, reason: "could not read from storage" }); continue; }

      const payloadForModel = {
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        tools: [TITLE_SCHEMA],
        tool_choice: { type: "tool", name: "title_reading" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
            { type: "text", text: "Read this title. Report only what is printed." },
          ],
        }],
      };

      // Normal path: the OWNER's compute (subscription → their key → metered platform).
      // Operator path: a service_role backfill runs on the platform key WITHOUT metering,
      // because re-deriving a user's own documents is our maintenance cost, not theirs.
      const run = usePlatform
        ? await runOnPlatformKey(payloadForModel)
        : await runWithChain(admin, userId, payloadForModel, { mode: "slow", maxWaitSeconds: Number.MAX_SAFE_INTEGER });

      if (run.needsFunding) return json({ error: "needs_funding", derived, skipped }, 402);
      if (run.rateLimited) return json({ error: "rate_limited", retry_after_seconds: run.retryAfterSeconds, derived, skipped }, 429);
      if (!run.ok) {
        skipped.push({
          document_id: doc.id,
          reason: `vision ${run.status}`,
          credential: run.source,
          detail: typeof run.body === "string" ? run.body.slice(0, 300) : run.body,
        });
        continue;
      }

      const use = (run.body?.content ?? []).find((b: any) => b.type === "tool_use");
      const t = use?.input;
      if (!t || t.legible === false || t.is_vehicle_title === false) {
        skipped.push({ document_id: doc.id, reason: "not a legible vehicle title" });
        continue;
      }

      const claimKey = `${(t.vin ?? "").toString().trim().toUpperCase()}|${(t.title_number ?? "").toString().trim().toUpperCase()}`;
      if (claimKey !== "|" && claimsSeen.has(claimKey)) {
        skipped.push({ document_id: doc.id, reason: "duplicate claim (same VIN + title number already read)" });
        continue;
      }
      if (claimKey !== "|") claimsSeen.add(claimKey);

      // Resolve the VIN against the fleet. The document names the chassis; the
      // database may or may not already know it.
      let vehicleId: string | null = null;
      let candidates = 0;
      if (t.vin) {
        const { data: matches } = await admin.from("vehicles").select("id").eq("vin", String(t.vin).trim().toUpperCase());
        candidates = matches?.length ?? 0;
        if (candidates === 1) vehicleId = matches![0].id;
      }

      // Does the title actually name the person who uploaded it? An OPEN title —
      // signed over by the seller, never transferred at the DMV — names the PRIOR
      // owner while the vehicle sits in the buyer's shop. That is how most of this
      // trade works. So a name mismatch is never a conclusion. It is a question.
      const printedNames = (t.owner_names ?? []).join(" ").toLowerCase();
      const nameOnTitleIsUploader = uploaderNames.some((n) => n && printedNames.includes(n));

      // When the document cannot be grounded, we ASK. We never guess a vehicle,
      // and we never let a low-confidence read silently become ownership.
      const unresolved = !vehicleId;
      const lowConfidence = Number(t.confidence ?? 0) < 0.8;
      const nameMismatch = printedNames.length > 0 && !nameOnTitleIsUploader;
      const needsOwner = unresolved || lowConfidence || nameMismatch;

      const desc = [t.year, t.make, t.model].filter(Boolean).join(" ");
      const question = !t.vin
        ? `A title document has no readable VIN. Which vehicle is this title for?`
        : candidates === 0
          ? `This title shows VIN ${t.vin} (${desc}), which isn't in your garage yet. Add it as a vehicle you own?`
          : candidates > 1
            ? `VIN ${t.vin} matches ${candidates} vehicle profiles. Which one is the real chassis?`
            : lowConfidence
              ? `I read VIN ${t.vin} on this ${desc} title at only ${Math.round(Number(t.confidence) * 100)}% confidence. Is that VIN right?`
              : nameMismatch
                ? `The ${desc} title (VIN ${t.vin}) is registered to ${(t.owner_names ?? []).join(", ")}, not you. Do you own this vehicle on an open title, or is this someone else's car you documented?`
                : null;

      const structured: Record<string, unknown> = {
        vin: t.vin ?? null,
        year: t.year ?? null, make: t.make ?? null, model: t.model ?? null,
        title_number: t.title_number ?? null,
        state: t.state ?? null,
        title_issued: t.title_issued ?? null,
        owner_names: t.owner_names ?? [],
        owner_address: t.owner_address ?? null,
        prior_owner_names: t.prior_owner_names ?? [],
        lienholder: t.lienholder ?? null,
        title_brand: t.brand ?? null,
        vin_match_candidates: candidates,
        read_confidence: t.confidence ?? null,
        title_names_uploader: nameOnTitleIsUploader,
        derivation: "derive-title-ownership@v1",
        ...(needsOwner ? { needs_owner_confirmation: true, confirmation_question: question } : {}),
      };

      if (dryRun) { derived.push({ document_id: doc.id, vehicle_id: vehicleId, structured, would_ask: needsOwner }); continue; }

      const payload = {
        source_slug: "title-document",
        kind: "ownership",
        // The title's own issue date is when the claim was made. Fall back to upload.
        observed_at: t.title_issued || doc.created_at,
        vehicle_id: vehicleId ?? undefined,
        vehicle_hints: t.vin ? { vin: String(t.vin) } : undefined,
        content_text: `Title ${t.title_number ?? "(no number)"} — ${(t.owner_names ?? []).join(", ") || "owner not read"}`,
        structured_data: structured,
        extraction_method: "derive_title_ownership_v1",
        // A state-issued instrument outranks an assertion about the same fact.
        rank: needsOwner ? "normal" : "preferred",
        citation: { secure_document_id: doc.id, excerpt: t.excerpt ?? null },
        agent_model: MODEL,
        observer_raw: { derived_for_user: userId, credential_source: run.source },
      };

      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ingest-observation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify(payload),
      });
      const out = await res.json();
      if (!res.ok || !out?.observation_id) { skipped.push({ document_id: doc.id, reason: "ingest failed", detail: out }); continue; }

      derived.push({
        document_id: doc.id,
        observation_id: out.observation_id,
        vehicle_id: out.vehicle_id ?? vehicleId,
        vin: t.vin ?? null,
        asks_owner: needsOwner,
        question,
        credential: run.source,
      });
    }

    return json({
      derived, skipped, dry_run: dryRun,
      documents_seen: allDocs.length,
      duplicate_uploads_collapsed: dupesCollapsed,
    });
  } catch (e) {
    console.error("[derive-title-ownership]", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

/** Downscale server-side via the storage render endpoint; `resize=contain` or the
 *  document's corners get cropped away (the default is cover). */
async function fetchDocumentAsBase64(admin: any, path: string): Promise<string | null> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/render/image/authenticated/${BUCKET}/${path}?width=${RENDER_WIDTH}&resize=contain&quality=85`;
  let res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    // Render only handles images; fall back to the raw object.
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    return b64(new Uint8Array(await data.arrayBuffer()));
  }
  return b64(new Uint8Array(await res.arrayBuffer()));
}

function b64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/** Operator-only: run one vision call on the platform's Anthropic key, unmetered.
 *  Returns the same shape as runWithChain so the caller doesn't branch. */
async function runOnPlatformKey(payload: Record<string, unknown>) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { parsed = await res.text().catch(() => null); }
  return {
    ok: res.ok, status: res.status, source: "system_api_key" as const,
    body: parsed, rateLimited: res.status === 429, retryAfterSeconds: null,
  };
}

/** Read the `role` claim out of a bearer token without verifying it. Safe here:
 *  it only selects a code path; every read is still scoped to an explicit user_id,
 *  and the function runs behind the platform's own JWT verification. */
function roleOf(authHeader: string | null): string | null {
  try {
    const tok = (authHeader ?? "").replace(/^Bearer\s+/i, "");
    const p = tok.split(".")[1];
    if (!p) return null;
    const pad = p + "=".repeat((4 - (p.length % 4)) % 4);
    return JSON.parse(atob(pad.replace(/-/g, "+").replace(/_/g, "/")))?.role ?? null;
  } catch { return null; }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
