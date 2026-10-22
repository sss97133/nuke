/**
 * INGEST OBSERVATION
 *
 * Unified intake for all vehicle observations from any source.
 * This is the single entry point - all extractors write through here.
 *
 * Features:
 * - Deduplication via content_hash
 * - Automatic confidence scoring
 * - Vehicle resolution (match observation to vehicle)
 * - Source validation
 *
 * POST /functions/v1/ingest-observation
 * {
 *   "source_slug": "bat",
 *   "kind": "comment",
 *   "observed_at": "2024-01-15T10:30:00Z",
 *   "source_url": "https://bringatrailer.com/listing/...",
 *   "source_identifier": "comment-123456",
 *   "content_text": "Beautiful car...",
 *   "structured_data": { ... },
 *   "vehicle_id": "uuid" | null,
 *   "vehicle_hints": { "vin": "...", "plate": "...", "year": 1967, "make": "Porsche" }
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { normalizeListingUrl, normalizeVin } from "../_shared/urlNormalization.ts";
import { requireWriteAuth, authenticateWriter } from "../_shared/writeGuard.ts";
import { checkRateLimit, getClientIp } from "../_shared/rateLimit.ts";
import { validateObservationProperty, isSupportedImagePropertyKey, isImageReadingKey } from "./imageProperties.ts";
import { observationContentHash, observationClockMicroseconds } from "../_shared/observationContentHash.ts";
import { readPinnedArchivedPage } from "../_shared/archiveFetch.ts";
import { parseQualifiedBaTSale } from "../_shared/batParser.ts";
import { BAT_LIVE_MODE, type BatLiveFrame } from "../_shared/batLiveEvents.ts";
import { BAT_LIVE_COLLECT_MODE, closingBatTargets, collectBatLive, batStreamIO } from "./batLiveCollector.ts";
import { RETAINED_VIN_MODE, RETAINED_VIN_METHOD, retainedVinSelector,
  qualifyRetainedVinReference } from "./retainedVinReference.ts";
import { RETAINED_VIN_BATCH_MODE, ingestRetainedVinBatch } from "./retainedVinBatch.ts";
import { ingestBatLive, type BatLiveDiagnostics } from "./batLive.ts";
import { RETAINED_REPORTED_WORK_MODE, retainedReportedWorkSelector, deriveRetainedReportedWork } from "./retainedReportedWork.ts";
import { RETAINED_PROPERTY_KEYS, RETAINED_PROPERTY_MODES, RETAINED_INTERIOR_METHOD, retainedInteriorSelector, deriveRetainedInterior } from "./retainedInterior.ts";
import { RETAINED_LISTING_DRAIN_MODE, drainRetainedListingProperties, RetainedBatchLookups } from "./retainedListingDrain.ts";
import { drainBatSaleQueue } from "../batch-extract-snapshots/batSaleQueue.ts";
import { RETAINED_IDENTITY_MODE, retainedIdentitySelector, ingestRetainedIdentity, retainedIdentityStore, RetainedIdentityConflict } from "./retainedIdentity.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { HISTORICAL_ASK_MODE, HISTORICAL_ASK_PROFILE } from "./historicalAsks.ts";
import { HISTORICAL_ASK_METHOD, historicalAskStore, ingestHistoricalAsk, HistoricalAskRefusal } from "./historicalAskIntake.ts";
import { TITLE_FACET_KEYS, TITLE_FACET_METHOD, TITLE_FACET_MODE, titleFacetSelector, deriveTitleFacet } from "./titleFacets.ts";
import { admitReceiptEvidence } from "../ingest-artifact/receiptIntake.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ObservationInput {
  /** Internal source links derived by retained-reference mode; generic callers cannot bind them. */
  source_vin?: string;
  source_vin_taxonomy_revision_id?: string;
  mode?: string;
  snapshot_id?: string;
  dry_run?: boolean;
  qualification_version?: string;
  use_source_queue?: boolean;
  /** Optional protected-v1 selector. Generic input never assigns this typed FK. */
  source_vehicle_event_id?: string;
  source_slug: string;
  kind: string;
  observed_at: string;
  source_url?: string;
  source_identifier?: string;
  content_text?: string;
  structured_data?: Record<string, unknown>;
  vehicle_id?: string;
  /**
   * Polymorphic subject (engineering-manual/20). Optional + backward-compatible:
   * omit it and the observation is a vehicle observation exactly as before.
   * For a non-vehicle subject, pass { type: 'organization'|'user'|'asset', id }.
   */
  subject?: { type?: string; id?: string };
  vehicle_hints?: {
    vin?: string;
    plate?: string;
    year?: number;
    make?: string;
    model?: string;
    url?: string;
  };
  observer_raw?: Record<string, unknown>;
  extractor_id?: string;
  extraction_metadata?: Record<string, unknown>;
  /** LLM provenance — which model produced this observation */
  agent_tier?: string;
  agent_model?: string | null;
  agent_cost_cents?: number;
  agent_duration_ms?: number;
  extraction_method?: string;
  raw_source_ref?: string;
  // A claim derived from a document must be able to point at the document.
  // Without this the observation is an assertion, not evidence.
  citation?: {
    // The shared reference library (service manuals, brochures).
    document_id?: string;          // → reference_documents.id
    // The OWNER's own evidence (title, bill of sale). Different table, different FK.
    secure_document_id?: string;   // → secure_documents.id
    page_number?: number;
    excerpt?: string;              // the verbatim text the claim was read from
  };
  // Wikidata-style precedence: a permanent instrument (title, build sheet) is
  // 'preferred'; a decaying assertion about the same fact is 'normal'.
  rank?: "preferred" | "normal" | "deprecated";
  /** condition_taxonomy.canonical_key this claim is about (e.g. 'exterior.paint.delamination'). Resolved to
   *  descriptor_id; an unknown or deprecated key is refused, never dropped. C26. */
  descriptor_key?: string;
  /** Registered property represented by structured_data[property_key]. */
  property_key?: string;
  /** Typed source-comment lineage; PostgreSQL checks quote and same-vehicle identity. */
  source_comment_id?: string;
  /** Deterministic service-side projection may explicitly avoid downstream inference. */
  defer_analysis?: boolean;
  /** True when an LLM read the claim from text or images rather than a person confirming it. Caps
   *  confidence_score at 0.6, the same convention the MCP submit_vehicle_event tool documents. C26. */
  agent_inferred?: boolean;
}

/**
 * The ONE anonymous write this function accepts (P0.2, 2026-09-27).
 *
 * The public builder share page (/share/wiring/:vehicleId, ShareWiring.tsx) lets a harness
 * builder with no account answer YES/NO on a public vehicle. That verdict — and only that
 * shape — may arrive on the anon key: source 'shop', kind 'comment', kind_detail
 * 'professional_review', a public vehicle, at most SHARE_VERDICTS_PER_HOUR per IP.
 * Every other write here needs the service key or a signed-in user (see _shared/writeGuard.ts).
 */
const SHARE_VERDICTS_PER_HOUR = 20;
const ARCHIVED_SALE_METHOD = "protected_archived_sale_observation_v1";
const ARCHIVED_EPISODE_PREVIEW_METHOD = "protected_archived_sale_episode_preview_v2";
const CAB_LISTING_CAPTURE_MODE = "cab_listing_capture_v1";
const CAB_LISTING_CAPTURE_METHOD = "protected_cab_listing_capture_v1";

/** Derive protected sale testimony here, never from caller-supplied values.
 * This is the canonical intake; database ingested_at is deliberately omitted.
 */
async function deriveArchivedSale(supabase: any, selectors: ObservationInput) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof selectors.vehicle_id !== "string" || !uuid.test(selectors.vehicle_id)) return { ok: false as const, reason: "invalid_vehicle_locator" };
  const vehicleId = selectors.vehicle_id.toLowerCase();
  const { data: parent, error: parentError } = await supabase.from("vehicles")
    .select("id,is_public,deleted_at,listing_kind,origin_metadata").eq("id",vehicleId).maybeSingle();
  if (parentError) return { ok: false as const, reason: "parent_read_failed" };
  if (!parent || parent.is_public !== true || parent.deleted_at !== null || parent.listing_kind === "non_vehicle_item") {
    return { ok: false as const, reason: "parent_not_public_real_vehicle" };
  }
  if (selectors.source_vehicle_event_id !== undefined && (typeof selectors.source_vehicle_event_id !== "string"
    || !uuid.test(selectors.source_vehicle_event_id))) return { ok: false as const, reason: "invalid_source_episode_locator" };
  const { data: facts, error } = await supabase.rpc("vehicle_price_facts", { p_vehicle_ids: [vehicleId] });
  if (error) return { ok: false as const, reason: "current_sale_read_failed" };
  const fact = facts?.find((f: any) => f.vehicle_id === vehicleId);
  if (!fact || fact.price_kind !== "sold" || !fact.sold_basis || fact.outcome !== "sold"
    || !Number.isFinite(Number(fact.sold_amount)) || Number(fact.sold_amount) <= 0 || !fact.sold_on || !fact.source_url) {
    return { ok: false as const, reason: "current_sourced_sale_unknown" };
  }
  const locator = selectors.snapshot_id ?? parent.origin_metadata?.bat_snapshot_parsed?.snapshot_id;
  if (typeof locator !== "string" || !uuid.test(locator)) return { ok: false as const, reason: "capture_locator_unknown" };
  const capture = await readPinnedArchivedPage({ snapshotId: locator.toLowerCase(), vehicleId, sourceUrl: fact.source_url }, { supabase });
  if (!capture.ok) return capture;
  const sale = parseQualifiedBaTSale(capture.html);
  if (!sale.ok) return sale;
  if (sale.amount !== Number(fact.sold_amount) || sale.eventDay !== fact.sold_on) return { ok: false as const, reason: "source_sale_conflict" };
  if (Date.parse(capture.snapshot.fetchedAt) < Date.parse(sale.eventDay + "T00:00:00Z")) return { ok: false as const, reason: "capture_precedes_sale" };
  const receipt = {
    method: ARCHIVED_SALE_METHOD, verification_basis: "producer_attested_archived_hash_parser",
    snapshot_id: capture.snapshot.id, vehicle_id: vehicleId, source_url: capture.snapshot.sourceUrl,
    source_sha256: capture.snapshot.sourceSha256, body_source: capture.snapshot.bodySource, byte_length: capture.snapshot.byteLength,
    parser: sale.parser, amount: sale.amount, currency: sale.currency, outcome: "sold", event_day: sale.eventDay, event_grain: "date",
    price_basis: "published_bid_excluding_fees", price_basis_rule: "bat_published_result_fee_separate_v1",
    price_basis_source: "https://bringatrailer.com/policies/", captured_at: capture.snapshot.fetchedAt,
    source_ingested_at: capture.snapshot.ingestedAt, original_parsed_at: capture.snapshot.parsedAt, source_known_at: capture.snapshot.sourceKnownAt,
  };
  const input: ObservationInput = {
    source_slug: "bat", kind: "sale_result", vehicle_id: vehicleId,
    // Date grain is explicit; midnight is not an asserted exact closing time.
    observed_at: sale.eventDay + "T00:00:00.000Z", source_url: capture.snapshot.sourceUrl,
    source_identifier: `archived-sale:${capture.snapshot.id}:${sale.parser}`,
    content_text: `Published sold result: ${sale.currency} ${sale.amount} on ${sale.eventDay} (date grain; fees excluded).`,
    // No registered extractor UUID is established for this deterministic method.
    structured_data: { source_sale_receipt: receipt },
    extraction_method: ARCHIVED_SALE_METHOD, raw_source_ref: `listing_page_snapshots:${capture.snapshot.id}`,
    extraction_metadata: { producer_qualified_at: new Date().toISOString(), clock_basis: "producer_verification_attempt" },
    defer_analysis: true,
  };
  if (selectors.source_vehicle_event_id !== undefined) {
    const eventId = selectors.source_vehicle_event_id.toLowerCase();
    const columns = ["id","vehicle_id","source_platform","source_url","source_listing_id","event_type","event_status",
      "final_price","sold_at","ended_at","created_at","updated_at","extracted_at"];
    const { data: event, error: eventError } = await supabase.from("vehicle_events")
      .select(columns.join(",")).eq("id",eventId).maybeSingle();
    if (eventError) return { ok: false as const, reason: "source_episode_read_failed" };
    if (!event || event.id !== eventId || event.vehicle_id !== vehicleId || event.source_platform !== "bat") {
      return { ok: false as const, reason: "source_episode_attribution_conflict" };
    }
    // Same strict supported URL syntax as the typed source guard. Opaque lot
    // IDs are retained without manufacturing a source URL from their text.
    const sourceKey = (raw: unknown, schemeLess = false): string | null => {
      if (typeof raw !== "string" || !(schemeLess
        ? /^(https?:\/\/)?(www\.)?bringatrailer\.com\/listing\/[a-z0-9-]+\/?([?#].*)?$/i
        : /^https?:\/\/(www\.)?bringatrailer\.com\/listing\/[a-z0-9-]+\/?([?#].*)?$/i).test(raw)) return null;
      return raw.replace(/^(https?:\/\/)?(www\.)?/i,"").replace(/[?#].*$/,"").replace(/\/+$/,"").toLowerCase();
    };
    const eventKey = sourceKey(event.source_url), listingKey = sourceKey(event.source_listing_id,true);
    if (!eventKey || eventKey !== sourceKey(capture.snapshot.storedSourceUrl)
      || eventKey !== sourceKey(receipt.source_url) || (listingKey !== null && listingKey !== eventKey)) {
      return { ok: false as const, reason: "source_episode_identity_conflict" };
    }
    const nativeTime = observationClockMicroseconds(event.sold_at ?? event.ended_at);
    const sourceDay = observationClockMicroseconds(sale.eventDay + "T00:00:00Z");
    if (nativeTime === null || nativeTime % 86400000000n !== 0n) {
      return { ok: false as const, reason: "source_episode_civil_day_unestablished" };
    }
    if (typeof event.event_status !== "string" || event.event_status.trim().toLowerCase() !== "sold" || event.final_price == null
      || !Number.isFinite(Number(event.final_price)) || Number(event.final_price) !== sale.amount
      || nativeTime !== sourceDay) return { ok: false as const, reason: "source_episode_current_sale_conflict" };
    for (const key of ["sold_at","ended_at","created_at","updated_at","extracted_at"]) {
      if (event[key] != null && observationClockMicroseconds(event[key]) === null) {
        return { ok: false as const, reason: "source_episode_clock_unknown" };
      }
    }
    if (capture.snapshot.storedSha256 !== capture.snapshot.sourceSha256) {
      return { ok: false as const, reason: "source_episode_capture_hash_shape" };
    }
    input.source_vehicle_event_id = eventId;
    input.extraction_metadata = { ...input.extraction_metadata,
      source_episode_context: Object.fromEntries(columns.map(key => [key,event[key] ?? null])),
      source_snapshot_context: { id: capture.snapshot.id, platform: "bat", listing_url: capture.snapshot.storedSourceUrl,
        success: true, http_status: 200, html_sha256: capture.snapshot.storedSha256,
        fetched_at: capture.snapshot.fetchedAt, created_at: capture.snapshot.ingestedAt,
        html_storage_path: capture.snapshot.storagePath, inline_body_present: capture.snapshot.bodySource === "inline",
        metadata: { vehicle_id: capture.protectedMetadata.vehicle_id, vehicle_matched: true, parsed_at: capture.snapshot.parsedAt } },
    };
  }
  return { ok: true as const, input, receipt };
}

// deno-lint-ignore no-explicit-any
async function allowShareVerdict(supabase: any, req: Request, input: ObservationInput): Promise<boolean> {
  const detail = (input.structured_data as Record<string, unknown> | undefined)?.kind_detail;
  const isVerdict = input.source_slug === "shop" && input.kind === "comment" &&
    detail === "professional_review" && !input.subject &&
    typeof input.vehicle_id === "string" && /^[0-9a-f-]{36}$/i.test(input.vehicle_id);
  if (!isVerdict) return false;
  const { data: vehicle } = await supabase
    .from("vehicles").select("id, is_public").eq("id", input.vehicle_id).maybeSingle();
  if (!vehicle?.is_public) return false;
  const rl = await checkRateLimit(supabase, getClientIp(req), {
    namespace: "ingest-observation-share-verdict", windowSeconds: 3600, maxRequests: SHARE_VERDICTS_PER_HOUR,
  });
  return rl.allowed;
}

Deno.serve(async function handleObservation(req, internal?: unknown) {
  const batchLookups = internal instanceof RetainedBatchLookups ? internal : null;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let retainedListingBudget = false, retainedSaleBudget = false, historicalAskBudget = false;
  let nativeDiagnostics: BatLiveDiagnostics | undefined;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    projectSecretKey() ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // Receipt attribution is a producer declaration, never authorization.
      global: { headers: { "X-Nuke-Writer": "ingest-observation" },
        fetch: (supabaseUrl, init) => {
          const supplied = (init as { signal?: AbortSignal } | undefined)?.signal;
          if (retainedListingBudget || retainedSaleBudget || historicalAskBudget) {
            const target = new URL(typeof supabaseUrl === "string" ? supabaseUrl
              : supabaseUrl instanceof URL ? supabaseUrl.href : supabaseUrl.url);
            const allowed = retainedSaleBudget || historicalAskBudget ? /^\/(rest|auth|storage)\/v1\// : /^\/(rest|auth)\/v1\//;
            if (target.origin !== new URL(Deno.env.get("SUPABASE_URL") ?? "").origin ||
              !allowed.test(target.pathname)) throw new Error("Unexpected retained source SDK target");
          }
          const send = () => fetch(supabaseUrl, retainedListingBudget || retainedSaleBudget || historicalAskBudget ? {
            ...init, signal: AbortSignal.any([req.signal, AbortSignal.timeout(retainedSaleBudget || historicalAskBudget ? 10000 : 5000),
              ...(supplied ? [supplied] : [])]),
          } : init);
          const trace = nativeDiagnostics;
          if (!trace?.trace) return send();
          trace.sdkFetches = (trace.sdkFetches ?? 0) + 1;
          const at = performance.now();
          return send().catch(error => {
            if (error instanceof Error && error.name === "RateLimitError")
              trace.sdkRuntimeLimits = (trace.sdkRuntimeLimits ?? 0) + 1;
            throw error;
          }).finally(() => { trace.sdkFetchMs = (trace.sdkFetchMs ?? 0) + performance.now() - at; });
        },
      },
    }
  );

  try {
    let input: ObservationInput = await req.json();
    if (input.mode === "receipt_evidence_v1") {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") return new Response(JSON.stringify({ error: "Receipt evidence admission requires internal service authentication" }), { status: 403, headers: corsHeaders });
      return admitReceiptEvidence(input as unknown as Record<string, unknown>, supabase);
    }
    if (input.extraction_method === "receipt_evidence_v1" || input.structured_data?.claim_contract === "receipt_evidence_v1") {
      return new Response(JSON.stringify({ error: "Receipt evidence requires its protected intake mode" }), { status: 403, headers: corsHeaders });
    }
    if (input.mode === CAB_LISTING_CAPTURE_MODE) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Listing capture custody requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const selectors = input as unknown as Record<string, unknown>;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (Object.keys(selectors).some(key => !["mode", "source_observation_id", "snapshot_id", "auction_event_id", "dry_run"].includes(key))
        || typeof selectors.dry_run !== "boolean" ||
        [selectors.source_observation_id, selectors.snapshot_id, selectors.auction_event_id]
          .some(value => typeof value !== "string" || !uuid.test(value))) {
        return new Response(JSON.stringify({ error: "Expected only three source selectors and explicit dry_run", writes: 0, model_calls: 0 }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const parameters = { p_source: selectors.source_observation_id, p_snapshot: selectors.snapshot_id,
        p_lot: selectors.auction_event_id };
      const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const qualified = await supabase.rpc("qualify_cab_listing_capture", parameters).abortSignal(AbortSignal.timeout(5000));
      if (qualified.error) return reply({ error: "Listing capture qualifier unavailable", writes: 0, model_calls: 0 }, 503);
      if (qualified.data?.ok !== true) return reply({ error: "Listing capture custody refused",
        reason: qualified.data?.reason ?? "unqualified", writes: 0, model_calls: 0 }, 409);
      if (qualified.data.input?.kind !== "provenance") return reply({ error: "Listing capture recipe unavailable",
        writes: 0, model_calls: 0 }, 503);
      if (selectors.dry_run) return reply({ success: true, dry_run: true, qualification: qualified.data,
        writes: 0, model_calls: 0, database_admission: "not_attempted", public_readiness: "not_assessed" });
      // Values come exclusively from the database's independently verified source
      // tuple. This receipt preserves the original; it copies no specifications.
      const { source_slug: _slug, defer_analysis: _defer, ...receipt } = qualified.data.input;
      const lookup = () => supabase.from("vehicle_observations").select("id")
        .eq("source_id", receipt.source_id).eq("source_identifier", receipt.source_identifier)
        .eq("kind", receipt.kind).eq("content_hash", receipt.content_hash)
        .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      const prior = await lookup();
      if (prior.error) return reply({ error: "Listing capture replay unavailable", model_calls: 0 }, 503);
      let result = prior.data;
      let duplicate = Boolean(result);
      if (!result) {
        const inserted = await supabase.from("vehicle_observations").insert(receipt).select("id")
          .abortSignal(AbortSignal.timeout(5000)).single();
        if (inserted.error?.code === "23505") {
          const winner = await lookup();
          if (winner.error || !winner.data) return reply({ error: "Listing capture replay unavailable", model_calls: 0 }, 503);
          result = winner.data; duplicate = true;
        } else if (inserted.error || !inserted.data) {
          return reply({ error: "Listing capture admission refused", model_calls: 0 }, 409);
        } else result = inserted.data;
      }
      // Replay is a fresh custody proof, not a successful hash lookup. This also
      // detects source withdrawal between qualification and the committed write.
      const current = await supabase.rpc("qualify_cab_listing_capture", { ...parameters, p_result: result.id })
        .abortSignal(AbortSignal.timeout(5000));
      if (current.error) return reply({ error: "Listing capture receipt verification unavailable", model_calls: 0 }, 503);
      if (current.data?.ok !== true || current.data?.result_verified !== true) return reply({
        error: "Listing capture receipt no longer qualified", reason: current.data?.reason ?? "unqualified", model_calls: 0,
      }, 409);
      return reply({ success: true, observation_id: result.id, duplicate, model_calls: 0,
        scope: "attributed_listing_narrative_only", public_readiness: "not_assessed" });
    }
    if (input.extraction_method === CAB_LISTING_CAPTURE_METHOD || input.structured_data?.listing_capture_receipt !== undefined) {
      return new Response(JSON.stringify({ error: "Listing capture receipt requires protected source selectors", writes: 0, model_calls: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    historicalAskBudget = input.mode === HISTORICAL_ASK_MODE;
    if (input.mode === HISTORICAL_ASK_MODE) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Historical asking intake requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        return new Response(JSON.stringify(await ingestHistoricalAsk(historicalAskStore(supabase), input as unknown as Record<string, unknown>)),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
        if (!(error instanceof HistoricalAskRefusal)) throw error;
        return new Response(JSON.stringify({ error: error.message }),
          { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    if (input.extraction_method === HISTORICAL_ASK_METHOD || input.structured_data?.profile === HISTORICAL_ASK_PROFILE) {
      return new Response(JSON.stringify({ error: "Historical asking testimony requires its protected mode" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    retainedListingBudget = [RETAINED_LISTING_DRAIN_MODE, RETAINED_REPORTED_WORK_MODE, ...RETAINED_PROPERTY_MODES].includes(input.mode ?? "");
    // Direct sale leaves must carry the worker's10s record cancellation through
    // every SDK query/download; creating a Request signal alone does not do so.
    retainedSaleBudget = input.mode === "source_sale_qualification";
    if (input.mode === RETAINED_LISTING_DRAIN_MODE) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Retained listing drain requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return drainRetainedListingProperties(req, input as unknown as Record<string, unknown>, supabase, handleObservation);
    }
    if (input.mode === RETAINED_VIN_BATCH_MODE) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Retained VIN batch requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return ingestRetainedVinBatch(req, input as unknown as Record<string, unknown>, handleObservation);
    }
    if (input.mode === BAT_LIVE_COLLECT_MODE) {
      const requestAt = new Date().toISOString(), authStarted = performance.now();
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") return new Response(
        JSON.stringify({ error: "Live collection requires service role" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const authMs = performance.now() - authStarted;
      if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" } });
      if (Object.keys(input).some(key => !["mode", "dry_run"].includes(key))
        || (input.dry_run !== undefined && typeof input.dry_run !== "boolean")) return new Response(
          JSON.stringify({ error: "Invalid live collection selectors" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const selectionStarted = performance.now(), targets = await closingBatTargets(supabase);
      const selectionMs = performance.now() - selectionStarted, dryRun = input.dry_run === true;
      const accepted = !dryRun && targets.length > 0, runId = accepted ? crypto.randomUUID() : null;
      if (accepted) {
        const selectedBindings = new Map(targets.map(target => [target.id, { ...target }]));
        const admitBatch = async (frames: BatLiveFrame[], heartbeats: unknown[], diagnostics?: BatLiveDiagnostics) => {
          // Each batch owns its SDK diagnostics/deadline, including concurrent
          // independent lanes. The incoming handoff may finish before this work.
          const deadline = AbortSignal.timeout(10000);
          const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", projectSecretKey() ?? "", {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { "X-Nuke-Writer": "ingest-observation" }, fetch: (supabaseUrl, init) => {
              const supplied = (init as { signal?: AbortSignal } | undefined)?.signal;
              if (diagnostics) diagnostics.sdkFetches = (diagnostics.sdkFetches ?? 0) + 1;
              const at = performance.now();
              return fetch(supabaseUrl, { ...init, signal: AbortSignal.any([deadline, ...(supplied ? [supplied] : [])]) })
                .catch(error => {
                  if (diagnostics && error instanceof Error && error.name === "RateLimitError")
                    diagnostics.sdkRuntimeLimits = (diagnostics.sdkRuntimeLimits ?? 0) + 1;
                  throw error;
                }).finally(() => {
                  if (diagnostics) diagnostics.sdkFetchMs = (diagnostics.sdkFetchMs ?? 0) + performance.now() - at;
                });
            } },
          });
          return await ingestBatLive(db, { mode: BAT_LIVE_MODE, frames, heartbeats }, diagnostics, selectedBindings);
        };
        EdgeRuntime.waitUntil(collectBatLive(targets, batStreamIO(Deno.env.get("SUPABASE_URL") ?? "",
          projectSecretKey() ?? "", { requestAt, authMs, selectionMs }, admitBatch), 115000, runId!)
          .catch(() => {
            // Pending/offline coverage and the end record remain the authority.
            // Report failed cleanup without an unhandled background rejection.
            console.error(JSON.stringify({ event: "bat_live_collector_failed_v1", collector_run_id: runId,
              at: new Date().toISOString(), outcome: "failed_or_unacknowledged" }));
          }));
      }
      return new Response(JSON.stringify({ success: true, mode: BAT_LIVE_COLLECT_MODE, dry_run: dryRun,
        accepted, collector_run_id: runId, selected_lots: targets.length, collector_duration_seconds: 115,
        transport: "public_pusher", targets: dryRun ? targets : undefined }),
        { status: accepted ? 202 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (input.mode === BAT_LIVE_MODE) {
      const authStarted = performance.now();
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Live source admission requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Diagnostic labels confer no authority and never enter source testimony.
      const labels = new URL(req.url).searchParams, runId = labels.get("collector_run_id");
      if (labels.get("trace_native") === "1" && /^[0-9a-f-]{36}$/i.test(runId ?? "")) {
        nativeDiagnostics = { trace: true, collectorRunId: runId!,
          sequence: /^\d{1,5}$/.test(labels.get("collector_seq") ?? "") ? Number(labels.get("collector_seq")) : undefined,
          authMs: Math.round((performance.now() - authStarted) * 100) / 100 };
      }
      return new Response(JSON.stringify(await ingestBatLive(supabase, input, nativeDiagnostics)),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (input.mode === RETAINED_IDENTITY_MODE) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Retained source-account admission requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sourceId = retainedIdentitySelector(input as unknown as Record<string, unknown>);
      if (!sourceId) return new Response(JSON.stringify({ error: "Expected only a retained source selector" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      try {
        return new Response(JSON.stringify(await ingestRetainedIdentity(retainedIdentityStore(supabase), sourceId)),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
        if (!(error instanceof RetainedIdentityConflict)) throw error;
        return new Response(JSON.stringify({ error: error.message }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else if (input.extraction_method === RETAINED_IDENTITY_MODE ||
        input.structured_data?.analysis_kind === "retained_bat_source_account_attribution") {
      return new Response(JSON.stringify({ error: "Retained account attribution requires its source selector" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let retainedSourceId: string | null = null;
    let titleFacetVerified = false;
    const retainedReportedWork = input.mode === RETAINED_REPORTED_WORK_MODE;
    if (retainedReportedWork) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") return new Response(JSON.stringify({ error: "Retained reported work requires service role" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const selector = retainedReportedWorkSelector(input as unknown as Record<string, unknown>);
      if (!selector) return new Response(JSON.stringify({ error: "Expected only a retained report selector", writes: 0, model_calls: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const parent = await supabase.from("vehicle_observations")
        .select("id,vehicle_id,kind,is_superseded,property_id,subject_type,subject_id,source_id,source_url,observed_at,ingested_at,extraction_method,confidence_score,structured_data,content_text")
        .eq("id", selector.sourceId).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      if (parent.error) throw new Error("Retained work source unavailable");
      const row = parent.data;
      const vehicle = row && await supabase.from("vehicles").select("id,is_public,deleted_at,listing_kind")
        .eq("id", row.vehicle_id).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      const source = row && await supabase.from("observation_sources").select("id,slug,base_trust_score,supported_observations")
        .eq("id", row.source_id).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      if (vehicle?.error || source?.error) throw new Error("Retained work source qualification unavailable");
      const derived = row && await deriveRetainedReportedWork(row, vehicle?.data ?? null, source?.data ?? null, selector.reportIndex);
      if (!derived) return new Response(JSON.stringify({ error: "Retained reported work ineligible", writes: 0, model_calls: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      // One report per listing sentence: another capture of the same page repeats
      // the publisher's assertion; it is neither a new report nor corroboration.
      // The PostgreSQL custody trigger enforces this; here it is a clean replay.
      const siblings = await supabase.from("vehicle_observations").select("id,source_observation_id,structured_data")
        .eq("vehicle_id", derived.vehicle_id).eq("kind", "activity").eq("extraction_method", RETAINED_REPORTED_WORK_MODE)
        .eq("source_url", derived.source_url).eq("is_superseded", false).limit(20).abortSignal(AbortSignal.timeout(5000));
      if (siblings.error) throw new Error("Retained work assertion lookup unavailable");
      for (const sibling of siblings.data ?? []) {
        if (sibling.source_observation_id === selector.sourceId || sibling.structured_data?.source_value !== derived.structured_data.source_value) continue;
        const current = await supabase.rpc("retained_reported_work_result_matches", {
          p_source: sibling.source_observation_id, p_result: sibling.id,
        }).abortSignal(AbortSignal.timeout(5000));
        if (current.error) throw new Error("Retained work assertion lookup unavailable");
        if (current.data === true) return new Response(JSON.stringify({ success: true, duplicate: true, observation_id: sibling.id,
          admitted_source_observation_id: sibling.source_observation_id, vehicle_id: derived.vehicle_id, writes: 0, model_calls: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      input = derived;
      retainedSourceId = selector.sourceId;
    } else if (input.extraction_method === RETAINED_REPORTED_WORK_MODE || input.structured_data?.analysis_kind === "retained_reported_work") {
      return new Response(JSON.stringify({ error: "Retained reported work requires its source selector", writes: 0, model_calls: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else if (RETAINED_PROPERTY_MODES.includes(input.mode ?? "")) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Retained projection requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sourceId = retainedInteriorSelector(input as unknown as Record<string, unknown>);
      if (!sourceId) return new Response(JSON.stringify({ error: "Expected only a retained source selector" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const read = (key: string, load: () => PromiseLike<any>) => batchLookups ? batchLookups.read(key, load) : load();
      const parent = await read(`parent:${sourceId}`, () => supabase.from("vehicle_observations")
        .select("id,vehicle_id,kind,is_superseded,property_id,subject_type,subject_id,source_id,source_url,source_identifier,observed_at,ingested_at,extraction_method,confidence_score,structured_data,extraction_metadata,content_text")
        .eq("id", sourceId).maybeSingle());
      if (parent.error) throw new Error("Retained source unavailable");
      const row = parent.data;
      if (!row) return new Response(JSON.stringify({ error: "Retained source unavailable" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const vehicle = await read(`vehicle:${row.vehicle_id}`, () => supabase.from("vehicles").select("id,is_public,deleted_at,listing_kind").eq("id", row.vehicle_id).maybeSingle());
      const source = await read(`source-id:${row.source_id}`, () => supabase.from("observation_sources").select("id,slug,base_trust_score,supported_observations").eq("id", row.source_id).maybeSingle());
      if (vehicle.error || source.error) throw new Error("Retained source qualification unavailable");
      const derived = deriveRetainedInterior(row, vehicle.data, source.data, input.mode);
      if (!derived) return new Response(JSON.stringify({ error: "Retained source ineligible" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      batchLookups?.remember(`parent:${sourceId}`, parent);
      batchLookups?.remember(`vehicle:${row.vehicle_id}`, vehicle);
      batchLookups?.remember(`source-id:${row.source_id}`, source);
      batchLookups?.remember(`source-slug:${source.data.slug}`, source);
      input = derived;
      retainedSourceId = sourceId;
    } else if (input.mode === TITLE_FACET_MODE) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Title facet projection requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const selector = titleFacetSelector(input as unknown as Record<string, unknown>);
      if (!selector) return new Response(JSON.stringify({ error: "Expected only a vehicle title facet selector", writes: 0, model_calls: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const vehicle = await supabase.from("vehicles")
        .select("id,is_public,deleted_at,listing_kind,year,make,model,listing_title,listing_url,discovery_url")
        .eq("id", selector.vehicleId).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      if (vehicle.error) throw new Error("Title facet vehicle unavailable");
      const derived = deriveTitleFacet(vehicle.data, selector.key, new Date().toISOString());
      if (!derived) return new Response(JSON.stringify({ success: false, reason: "title_carries_no_literal_label", writes: 0, model_calls: 0 }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const prior = await supabase.from("vehicle_observations").select("id")
        .eq("vehicle_id", derived.vehicle_id).eq("extraction_method", TITLE_FACET_METHOD)
        .eq("source_identifier", derived.source_identifier).eq("is_superseded", false)
        .limit(1).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      if (prior.error) throw new Error("Title facet replay lookup unavailable");
      if (prior.data) return new Response(JSON.stringify({ success: true, duplicate: true, observation_id: prior.data.id,
        vehicle_id: derived.vehicle_id, writes: 0, model_calls: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      input = derived;
      titleFacetVerified = true;
    } else if (input.extraction_method === TITLE_FACET_METHOD || input.structured_data?.analysis_kind === "vehicle_title_facet_projection") {
      return new Response(JSON.stringify({ error: "Title facet labels require their vehicle selector", writes: 0, model_calls: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else if (input.extraction_method === RETAINED_INTERIOR_METHOD ||
        input.structured_data?.analysis_kind === "retained_listing_property_projection") {
      return new Response(JSON.stringify({ error: "Retained projection requires its source selector" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let retainedVin: Awaited<ReturnType<typeof qualifyRetainedVinReference>> | undefined;
    if (input.mode === RETAINED_VIN_MODE) {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Retained VIN admission requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const revisionId = retainedVinSelector(input as unknown as Record<string, unknown>);
      if (!revisionId) return new Response(JSON.stringify({ error: "Expected an explicit retained VIN source selector", writes: 0, model_calls: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const context = await supabase.rpc("read_retained_vin_reference_input", { p_revision_id: revisionId })
        .abortSignal(AbortSignal.timeout(5000));
      if (context.error) return new Response(JSON.stringify({ error: "retained_reference_read_failed", writes: 0, model_calls: 0 }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      retainedVin = await qualifyRetainedVinReference(context.data);
      if (!retainedVin.ok) return new Response(JSON.stringify({ success: false, reason: retainedVin.reason, writes: 0, model_calls: 0 }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (typeof context.data.extractor_id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.data.extractor_id)) {
        return new Response(JSON.stringify({ error: "retained_reference_extractor_unavailable", writes: 0, model_calls: 0 }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (input.dry_run) return new Response(JSON.stringify({ success: true, dry_run: true,
        requested_taxonomy_revision_id: revisionId, receipt: retainedVin.receipt, writes: 0, model_calls: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      input = { ...retainedVin.input, extractor_id: context.data.extractor_id };
    } else if (input.extraction_method === RETAINED_VIN_METHOD || input.structured_data?.vin_reference_receipt !== undefined) {
      return new Response(JSON.stringify({ error: "Protected VIN references require the retained source selector" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else if (input.mode?.startsWith("retained_vin_")) {
      return new Response(JSON.stringify({ error: "Retained VIN recipe not installed", writes: 0, model_calls: 0 }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let archivedSale: Awaited<ReturnType<typeof deriveArchivedSale>> | undefined;
    if (input.mode === "source_sale_qualification") {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Protected sale qualification requires a service writer" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (input.use_source_queue === true) {
        // Existing sale owner: at most120claims, two in-process records, same
        // protected leaf/CAS and40/55/60s budgets; legacy outer requests stay20.
        return drainBatSaleQueue(supabase, input, { request: req, admit: handleObservation });
      }
      const dryRun = input.dry_run !== false;
      // The separately reviewed episode-v2 preview is not installed here.
      // In particular it must never silently fall through to v1 admission.
      if (input.qualification_version !== undefined && input.qualification_version !== "v1") {
        return new Response(JSON.stringify({ success: false, reason: input.qualification_version === "episode_v2"
          ? "episode_admission_not_installed" : "qualification_version_unknown", writes: 0, model_calls: 0 }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      archivedSale = await deriveArchivedSale(supabase,input);
      if (!archivedSale.ok) return new Response(JSON.stringify({ success: false, reason: archivedSale.reason }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (dryRun) return new Response(JSON.stringify({ success: true, dry_run: true, status: "qualified_preview",
        vehicle_id: archivedSale.input.vehicle_id, receipt: archivedSale.receipt, derived_ingested_at: null,
        ...(archivedSale.input.source_vehicle_event_id ? { proposed_source_vehicle_event_id: archivedSale.input.source_vehicle_event_id,
          source_episode_context: archivedSale.input.extraction_metadata?.source_episode_context,
          source_snapshot_context: archivedSale.input.extraction_metadata?.source_snapshot_context,
          recorded_clock_basis: "database_transaction_start_not_commit_availability", source_public_visibility: "unestablished" } : {}),
        availability_known_at: null, model_calls: 0, writes: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      input = archivedSale.input;
    } else if ([ARCHIVED_SALE_METHOD,ARCHIVED_EPISODE_PREVIEW_METHOD].includes(input.extraction_method ?? "")
      || [ARCHIVED_SALE_METHOD,ARCHIVED_EPISODE_PREVIEW_METHOD].includes(input.extractor_id ?? "")
      || [ARCHIVED_SALE_METHOD,ARCHIVED_EPISODE_PREVIEW_METHOD].includes(String((input.structured_data?.source_sale_receipt as Record<string,unknown> | undefined)?.method ?? ""))) {
      return new Response(JSON.stringify({ error: "Protected sale receipts must be derived through source_sale_qualification" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const protectedReply = async (row: any, duplicate: boolean) => {
      if (retainedReportedWork) {
        const writes = duplicate ? 0 : 1;
        const unavailable = () => new Response(JSON.stringify({ success: false,
          error: "Persisted retained reported work unavailable", writes, model_calls: 0 }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        try {
          const verified = row?.id && await supabase.rpc("retained_reported_work_result_matches", {
            p_source: retainedSourceId, p_result: row.id,
          }).abortSignal(AbortSignal.timeout(5000));
          if (!verified || verified.error || verified.data !== true) return unavailable();
        } catch { return unavailable(); }
        return new Response(JSON.stringify({ success: true, duplicate, observation_id: row.id,
          vehicle_id: input.vehicle_id, writes, model_calls: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (retainedSourceId && input.property_key === "engine_family_label") {
        // Replay does not fire the insert trigger. Recheck the persisted child,
        // current curator gate and retained source before returning admission.
        const writes = duplicate ? 0 : 1;
        const unavailable = () => new Response(JSON.stringify({ success: false,
          error: "Persisted retained engine-family result unavailable", writes, model_calls: 0 }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (typeof row?.id !== "string" || !property.ok || !property.propertyId) return unavailable();
        try {
          const verified = await supabase.rpc("retained_listing_property_result_matches", {
            p_source: retainedSourceId, p_property: property.propertyId, p_result: row.id,
          }).abortSignal(AbortSignal.timeout(5000));
          if (verified.error || verified.data !== true) return unavailable();
        } catch {
          return unavailable();
        }
        return new Response(JSON.stringify({ success: true, duplicate, observation_id: row.id,
          vehicle_id: input.vehicle_id, writes, model_calls: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (retainedVin?.ok) {
        const saved = row?.structured_data?.vin_reference_receipt;
        const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered)
          : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key,ordered(value[key])])) : value;
        if (row?.is_superseded === true) return new Response(JSON.stringify({ success: false,
          reason: "retained_reference_superseded", writes: 0, model_calls: 0 }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!row?.id || row.vehicle_id !== input.vehicle_id || row.source_vin !== input.source_vin ||
            !retainedVinSelector({ mode: RETAINED_VIN_MODE, revision_id: row.source_vin_taxonomy_revision_id, dry_run: true }) ||
            row.kind !== "specification" || row.is_superseded !== false || row.source_id !== source?.id ||
            row.extraction_method !== RETAINED_VIN_METHOD || row.extractor_id !== input.extractor_id ||
            row.source_identifier !== input.source_identifier || row.raw_source_ref !== input.raw_source_ref ||
            row.source_url !== input.source_url || row.content_hash !== contentHash ||
            observationClockMicroseconds(row.observed_at) !== observationClockMicroseconds(input.observed_at) ||
            observationClockMicroseconds(row.ingested_at) === null ||
            JSON.stringify(ordered(saved)) !== JSON.stringify(ordered(retainedVin.receipt))) {
          return new Response(JSON.stringify({ error: "Persisted protected VIN reference unavailable", writes: 0, model_calls: 0 }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ success: true, dry_run: false, duplicate, observation_id: row.id,
          vehicle_id: row.vehicle_id, requested_taxonomy_revision_id: retainedVin.revision_id,
          supporting_taxonomy_revision_id: String(row.source_vin_taxonomy_revision_id), receipt: saved,
          derived_ingested_at: row.ingested_at, physical_configuration_verified: false,
          writes: duplicate ? 0 : 1, model_calls: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!archivedSale?.ok) return null;
      const saved = row?.structured_data?.source_sale_receipt;
      const exactTuple = saved && Object.entries(archivedSale.receipt).every(([key,value]) => saved[key] === value);
      // JSONB may reorder object keys; order is not part of header identity.
      const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered)
        : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key,ordered(value[key])])) : value;
      const episodeExact = !input.source_vehicle_event_id || (row?.source_vehicle_event_id === input.source_vehicle_event_id
        && row.content_hash === contentHash && observationClockMicroseconds(row.ingested_at) !== null
        && observationClockMicroseconds(row.observed_at) === observationClockMicroseconds(input.observed_at)
        && ["source_episode_context","source_snapshot_context"].every(key => {
          const expected = input.extraction_metadata?.[key], actual = row?.extraction_metadata?.[key];
          return expected && actual && JSON.stringify(ordered(expected)) === JSON.stringify(ordered(actual));
        }));
      if (!row?.id || row.vehicle_id !== input.vehicle_id || row.source_snapshot_id !== archivedSale.receipt.snapshot_id || !Number.isFinite(Date.parse(row.ingested_at)) || !exactTuple
        || !episodeExact
        || row.kind !== "sale_result" || row.is_superseded !== false || row.source_id !== source?.id
        || row.extraction_method !== ARCHIVED_SALE_METHOD || row.extractor_id !== null
        || row.raw_source_ref !== input.raw_source_ref || row.source_identifier !== input.source_identifier
        || row.source_url !== input.source_url || Date.parse(row.observed_at) !== Date.parse(input.observed_at)) {
        return new Response(JSON.stringify({ error: "Persisted protected sale receipt unavailable" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true, dry_run: false, duplicate, observation_id: row.id,
        vehicle_id: input.vehicle_id, receipt: saved, derived_ingested_at: row.ingested_at,
        availability_known_at: input.source_vehicle_event_id ? null : row.ingested_at,
        ...(input.source_vehicle_event_id ? { source_vehicle_event_id: row.source_vehicle_event_id,
          recorded_clock_basis: "database_transaction_start_not_commit_availability", source_public_visibility: "unestablished" } : {}),
        model_calls: 0, writes: duplicate ? 0 : 1 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    };

    // Validate required fields
    if (!input.source_slug || !input.kind || !input.observed_at) {
      return new Response(JSON.stringify({
        error: "Missing required fields: source_slug, kind, observed_at"
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Writes are never anonymous — except the share-page verdict argued above.
    const denied = await requireWriteAuth(req, {
      allowAnonymous: () => allowShareVerdict(supabase, req, input),
    });
    if (denied) return denied;

    if (input.source_comment_id !== undefined &&
        (typeof input.source_comment_id !== "string" ||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.source_comment_id) ||
         input.kind !== "comment" || input.agent_inferred !== true || input.structured_data?.is_inferred !== true)) {
      return new Response(JSON.stringify({ error: "Comment atoms require a source UUID, comment kind and inferred qualification" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (input.defer_analysis !== undefined && typeof input.defer_analysis !== "boolean") {
      return new Response(JSON.stringify({ error: "defer_analysis must be boolean" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (input.defer_analysis === true) {
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Deferred analysis requires service role" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Look up source
    const { data: source, error: sourceError } = (retainedSourceId && batchLookups?.get(`source-slug:${input.source_slug}`)) || await supabase
      .from("observation_sources")
      .select("id, base_trust_score, supported_observations")
      .eq("slug", input.source_slug)
      .maybeSingle();

    if (sourceError || !source) {
      return new Response(JSON.stringify({
        error: `Unknown source: ${input.source_slug}`,
        hint: "Register source in observation_sources table first"
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate observation kind is supported by source
    if (!source.supported_observations?.includes(input.kind)) {
      return new Response(JSON.stringify({
        error: `Source ${input.source_slug} does not support observation kind: ${input.kind}`,
        supported: source.supported_observations
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // This existing source's new capability is restricted to the protected
    // report selector, including service callers; generic activity is broader.
    if (source.id === "4cdc735c-f117-42f2-889f-ba33805639a5" && input.kind === "activity" && !retainedReportedWork) {
      return new Response(JSON.stringify({ error: "BaT activity requires its retained report selector", writes: 0, model_calls: 0 }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // A claim keyed to the condition dimension must name a live descriptor.
    let descriptorId: string | null = null;
    if (input.descriptor_key) {
      const { data: descriptor } = await supabase
        .from("condition_taxonomy")
        .select("descriptor_id")
        .eq("canonical_key", input.descriptor_key)
        .is("deprecated_at", null)
        .maybeSingle();
      if (!descriptor) {
        return new Response(JSON.stringify({
          error: `Unknown or deprecated descriptor_key: ${input.descriptor_key}`,
          hint: "Add it to condition_taxonomy through a migration first"
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      descriptorId = descriptor.descriptor_id;
    }

    let propertyRow = null;
    if (input.property_key !== undefined) {
      if (!isSupportedImagePropertyKey(input.property_key) && !isImageReadingKey(input.property_key) &&
          !(titleFacetVerified && (TITLE_FACET_KEYS as readonly string[]).includes(input.property_key)) &&
          !(retainedSourceId && RETAINED_PROPERTY_KEYS.includes(input.property_key))) {
        return new Response(JSON.stringify({ error: "Unsupported property_key for this intake" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const lookup = (retainedSourceId && batchLookups?.get(`property:${input.property_key}`)) || await supabase.from("observation_properties")
        .select("id, property_key, applies_to_kinds, namespace, deprecated_at")
        .eq("property_key", input.property_key).maybeSingle();
      if (lookup.error) {
        return new Response(JSON.stringify({ error: "Property registry unavailable" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      propertyRow = lookup.data;
    }
    const property = validateObservationProperty(input, propertyRow, retainedSourceId !== null, titleFacetVerified);
    if (!property.ok) {
      return new Response(JSON.stringify({ error: property.error }),
        { status: property.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (retainedSourceId && input.property_key && propertyRow) {
      batchLookups?.remember(`property:${input.property_key}`, { data: propertyRow, error: null });
    }

    // Compute content hash for deduplication.
    // Hash includes vehicle_id + observed_at + observer_raw so observations on different
    // vehicles or from different source photos don't collapse onto each other.
    // Bug fix 2026-05-24: previously two observations with same source/kind but different
    // vehicle_id collapsed into one row; cross-vehicle reuse of an observation_id was
    // returned to callers. See ISSUES.md "[MEDIUM] ingest-observation dedup ignores vehicle_id".
    const contentHash = await observationContentHash(input);

    // Check for duplicate
    const protectedColumns = "id,vehicle_id,ingested_at,structured_data,source_snapshot_id,kind,is_superseded,source_id,extraction_method,extractor_id,raw_source_ref,source_identifier,source_url,observed_at";
    const replayQuery = () => {
      let query = supabase.from("vehicle_observations").select(retainedVin?.ok
        ? protectedColumns + ",source_vin,source_vin_taxonomy_revision_id,content_hash" : archivedSale?.ok
        ? protectedColumns + (input.source_vehicle_event_id ? ",source_vehicle_event_id,extraction_metadata,content_hash" : "") : "id").eq("content_hash",contentHash);
      if (archivedSale?.ok || retainedVin?.ok) query = query.eq("source_id",source.id).eq("source_identifier",input.source_identifier!).eq("kind",input.kind);
      return query.maybeSingle().returns<Record<string, unknown> | null>();
    };
    const { data: existing, error: replayError } = await replayQuery();
    if ((input.source_vehicle_event_id && archivedSale?.ok || retainedVin?.ok || retainedReportedWork) && replayError) {
      return new Response(JSON.stringify({ error: "Typed sale replay unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (existing) {
      const protectedResponse = await protectedReply(existing,true);
      if (protectedResponse) return protectedResponse;
      return new Response(JSON.stringify({
        success: true,
        duplicate: true,
        observation_id: existing.id,
        message: "Observation already exists"
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve vehicle if not provided
    let vehicleId = input.vehicle_id;
    let vehicleMatchConfidence = 1.0;
    let vehicleMatchSignals: Record<string, unknown> = {};

    if (!vehicleId && input.vehicle_hints) {
      const hints = input.vehicle_hints;

      // Try VIN match first (highest confidence)
      if (hints.vin) {
        const cleanVin = normalizeVin(hints.vin);
        if (cleanVin) {
          const { data: vinMatch } = await supabase
            .from("vehicles")
            .select("id")
            .eq("vin", cleanVin)
            .maybeSingle();

          if (vinMatch) {
            vehicleId = vinMatch.id;
            vehicleMatchConfidence = 0.99;
            vehicleMatchSignals = { vin_match: true, normalized_vin: cleanVin };
          }
        }
      }

      // Try URL match — first normalized, then exact (for listings we've seen before)
      if (!vehicleId && hints.url) {
        const normUrl = normalizeListingUrl(hints.url);

        // Try canonical listing ID match against vehicles.listing_url and discovery_url
        if (normUrl?.canonicalListingId) {
          // Extract the platform-specific ID pattern to match against existing URLs
          const listingIdPart = normUrl.canonicalListingId.split(":")[1];
          const { data: urlMatches } = await supabase
            .from("vehicles")
            .select("id, listing_url, discovery_url")
            .or(`listing_url.ilike.%${listingIdPart}%,discovery_url.ilike.%${listingIdPart}%`)
            .not("status", "in", "(merged,deleted)")
            .limit(5);

          if (urlMatches?.length === 1) {
            vehicleId = urlMatches[0].id;
            vehicleMatchConfidence = 0.95;
            vehicleMatchSignals = { normalized_url_match: true, canonical_id: normUrl.canonicalListingId };
          } else if (urlMatches && urlMatches.length > 1) {
            // Multiple matches — pick the one with exact canonical listing ID match
            for (const m of urlMatches) {
              const mNormListing = normalizeListingUrl(m.listing_url);
              const mNormDiscovery = normalizeListingUrl(m.discovery_url);
              if (
                mNormListing?.canonicalListingId === normUrl.canonicalListingId ||
                mNormDiscovery?.canonicalListingId === normUrl.canonicalListingId
              ) {
                vehicleId = m.id;
                vehicleMatchConfidence = 0.95;
                vehicleMatchSignals = { normalized_url_match: true, canonical_id: normUrl.canonicalListingId };
                break;
              }
            }
          }
        }

        // Fall back to exact URL match in vehicle_events
        if (!vehicleId) {
          const { data: urlMatch } = await supabase
            .from("vehicle_events")
            .select("vehicle_id")
            .eq("source_url", hints.url)
            .not("vehicle_id", "is", null)
            .maybeSingle();

          if (urlMatch?.vehicle_id) {
            vehicleId = urlMatch.vehicle_id;
            vehicleMatchConfidence = 0.95;
            vehicleMatchSignals = { exact_url_match: true };
          }
        }

        // Also try normalized URL match in vehicle_events
        if (!vehicleId && normUrl?.normalized && normUrl.normalized !== hints.url) {
          const { data: normUrlMatch } = await supabase
            .from("vehicle_events")
            .select("vehicle_id")
            .eq("source_url", normUrl.normalized)
            .not("vehicle_id", "is", null)
            .maybeSingle();

          if (normUrlMatch?.vehicle_id) {
            vehicleId = normUrlMatch.vehicle_id;
            vehicleMatchConfidence = 0.90;
            vehicleMatchSignals = { normalized_event_url_match: true };
          }
        }
      }

      // Try year/make/model fuzzy match (lower confidence)
      if (!vehicleId && hints.year && hints.make) {
        const { data: fuzzyMatches } = await supabase
          .from("vehicles")
          .select("id")
          .eq("year", hints.year)
          .ilike("make", `%${hints.make}%`)
          .limit(5);

        if (fuzzyMatches?.length === 1) {
          vehicleId = fuzzyMatches[0].id;
          vehicleMatchConfidence = 0.60;
          vehicleMatchSignals = { fuzzy_match: true, year: hints.year, make: hints.make };
        } else if (fuzzyMatches && fuzzyMatches.length > 1) {
          // Multiple matches - leave unresolved for manual review
          vehicleMatchSignals = {
            multiple_candidates: true,
            count: fuzzyMatches.length,
            hints
          };
        }
      }
    }

    // Compute confidence score
    const confidenceFactors: Record<string, number> = {};
    if (vehicleMatchConfidence >= 0.95) confidenceFactors.vehicle_match = 0.1;
    if (input.source_url) confidenceFactors.has_source_url = 0.05;
    if (input.content_text && input.content_text.length > 100) confidenceFactors.substantial_content = 0.05;
    // The owner signing off on a fact about their own vehicle is the highest-trust
    // testimony the system can hold. owner-input's base_trust_score (0.70) would
    // otherwise render an owner's signature as merely "medium".
    if (input.structured_data?.owner_confirmed === true) confidenceFactors.owner_confirmed = 0.30;

    let confidenceScore = Math.min(1.0,
      (source.base_trust_score || 0.5) +
      Object.values(confidenceFactors).reduce((a, b) => a + b, 0)
    );
    // An LLM reading seller text is testimony about testimony: it never outranks a person.
    if (input.agent_inferred === true && confidenceScore > 0.6) {
      confidenceFactors.agent_inferred_cap = 0.6 - confidenceScore;
      confidenceScore = 0.6;
    }
    // A freshly derived Craigslist label retains its source profile's cap;
    // source-URL/content/vehicle-match bonuses cannot turn it into stronger evidence.
    if (retainedSourceId && ["craigslist_auto_miles_v1","craigslist_year_attribute_v1"].includes(String(input.structured_data?.source_profile)) && confidenceScore > 0.4) {
      confidenceFactors.retained_listing_source_cap = 0.4 - confidenceScore;
      confidenceScore = 0.4;
    }
    // A label read from the record's own title has no retained capture or author behind it.
    if (titleFacetVerified && confidenceScore > 0.3) {
      confidenceFactors.record_title_label_cap = 0.3 - confidenceScore;
      confidenceScore = 0.3;
    }

    // Determine confidence level from score
    let confidenceLevel = "medium";
    if (confidenceScore >= 0.95) confidenceLevel = "verified";
    else if (confidenceScore >= 0.85) confidenceLevel = "high";
    else if (confidenceScore < 0.4) confidenceLevel = "low";

    // Insert observation
    const { data: observation, error: insertError } = await supabase
      .from("vehicle_observations")
      .insert({
        vehicle_id: vehicleId,
        // Only freshly verified protected admission sets the typed source key.
        // Generic input, including caller-provided source_snapshot_id, is ignored.
        ...(archivedSale?.ok ? { source_snapshot_id: archivedSale.receipt.snapshot_id } : {}),
        ...(retainedVin?.ok ? { source_vin: input.source_vin,
          source_vin_taxonomy_revision_id: input.source_vin_taxonomy_revision_id } : {}),
        ...(archivedSale?.ok && input.source_vehicle_event_id ? { source_vehicle_event_id: input.source_vehicle_event_id } : {}),
        ...(retainedSourceId ? { source_observation_id: retainedSourceId } : {}),
        vehicle_match_confidence: vehicleId ? vehicleMatchConfidence : null,
        vehicle_match_signals: Object.keys(vehicleMatchSignals).length > 0 ? vehicleMatchSignals : null,
        // Polymorphic subject (engineering-manual/20). Conditional spread: with no
        // subject passed, this is byte-identical to before and the DB default
        // (subject_type='vehicle', subject_id=NULL) applies.
        ...(input.subject?.type ? { subject_type: input.subject.type } : {}),
        ...(input.subject?.id ? { subject_id: input.subject.id } : {}),
        observed_at: input.observed_at,
        source_id: source.id,
        source_url: input.source_url,
        source_identifier: input.source_identifier,
        kind: input.kind,
        content_text: input.content_text,
        content_hash: contentHash,
        structured_data: input.structured_data || {},
        confidence: confidenceLevel,
        confidence_score: confidenceScore,
        confidence_factors: confidenceFactors,
        observer_raw: input.observer_raw,
        extractor_id: input.extractor_id,
        extraction_metadata: input.extraction_metadata,
        // LLM provenance fields
        agent_tier: input.agent_tier || null,
        agent_model: input.agent_model || null,
        agent_cost_cents: input.agent_cost_cents ?? null,
        agent_duration_ms: input.agent_duration_ms ?? null,
        extraction_method: input.extraction_method || null,
        raw_source_ref: input.raw_source_ref || null,
        // Provenance of the claim itself: which document, which page, which words.
        citation_document_id: input.citation?.document_id ?? null,
        citation_secure_document_id: input.citation?.secure_document_id ?? null,
        citation_page_number: input.citation?.page_number ?? null,
        citation_excerpt: input.citation?.excerpt ?? null,
        ...(descriptorId ? { descriptor_id: descriptorId } : {}),
        ...(property.propertyId ? { property_id: property.propertyId } : {}),
        ...(input.source_comment_id ? { source_comment_id: input.source_comment_id } : {}),
        ...(input.rank ? { rank: input.rank } : {})
      })
      .select()
      .maybeSingle();

    if (insertError) {
      // Two identical workers may pass the pre-read simultaneously. Protected
      // replay resolves the complete source/id/kind/hash tuple; other failures fail.
      if (insertError.code === "23505") {
        const { data: winner } = await replayQuery();
        if (winner) {
          const protectedResponse = await protectedReply(winner,true);
          if (protectedResponse) return protectedResponse;
          return new Response(JSON.stringify({ success: true, duplicate: true,
          observation_id: winner.id }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({
        error: "Failed to insert observation",
        details: insertError.message
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const protectedResponse = await protectedReply(observation,false);
    if (protectedResponse) return protectedResponse;

    // Fire-and-forget: trigger analysis engine for this vehicle+observation kind
    if (vehicleId && input.kind && input.defer_analysis !== true) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = projectSecretKey() ?? "";
      fetch(`${supabaseUrl}/functions/v1/analysis-engine-coordinator`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
        body: JSON.stringify({ action: "observation_trigger", vehicle_id: vehicleId, observation_kind: input.kind }),
      }).catch(() => {}); // intentionally fire-and-forget
    }

    return new Response(JSON.stringify({
      success: true,
      observation_id: observation.id,
      vehicle_id: vehicleId,
      vehicle_resolved: !!vehicleId,
      vehicle_match_confidence: vehicleMatchConfidence,
      confidence_score: confidenceScore,
      duplicate: false
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({
      error: e.message
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
