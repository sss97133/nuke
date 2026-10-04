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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeListingUrl, normalizeVin } from "../_shared/urlNormalization.ts";
import { requireWriteAuth, authenticateWriter } from "../_shared/writeGuard.ts";
import { checkRateLimit, getClientIp } from "../_shared/rateLimit.ts";
import { validateObservationProperty, isSupportedImagePropertyKey } from "./imageProperties.ts";
import { observationContentHash } from "../_shared/observationContentHash.ts";
import { readPinnedArchivedPage } from "../_shared/archiveFetch.ts";
import { parseQualifiedBaTSale } from "../_shared/batParser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ObservationInput {
  mode?: string;
  snapshot_id?: string;
  dry_run?: boolean;
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
  agent_model?: string;
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
    structured_data: { source_sale_receipt: receipt }, extractor_id: ARCHIVED_SALE_METHOD,
    extraction_method: ARCHIVED_SALE_METHOD, raw_source_ref: `listing_page_snapshots:${capture.snapshot.id}`,
    extraction_metadata: { producer_qualified_at: new Date().toISOString(), clock_basis: "producer_verification_attempt" },
    defer_analysis: true,
  };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // Receipt attribution is a producer declaration, never authorization.
      global: { headers: { "X-Nuke-Writer": "ingest-observation" } },
    }
  );

  try {
    let input: ObservationInput = await req.json();
    let archivedSale: Awaited<ReturnType<typeof deriveArchivedSale>> | undefined;
    if (input.mode === "source_sale_qualification") {
      const denied = await requireWriteAuth(req);
      if (denied) return denied;
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ error: "Protected sale qualification requires a service writer" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const dryRun = input.dry_run !== false;
      archivedSale = await deriveArchivedSale(supabase,input);
      if (!archivedSale.ok) return new Response(JSON.stringify({ success: false, reason: archivedSale.reason }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (dryRun) return new Response(JSON.stringify({ success: true, dry_run: true, status: "qualified_preview",
        vehicle_id: archivedSale.input.vehicle_id, receipt: archivedSale.receipt, derived_ingested_at: null,
        availability_known_at: null, model_calls: 0, writes: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      input = archivedSale.input;
    } else if (input.extraction_method === ARCHIVED_SALE_METHOD || input.extractor_id === ARCHIVED_SALE_METHOD
      || (input.structured_data?.source_sale_receipt as Record<string,unknown> | undefined)?.method === ARCHIVED_SALE_METHOD) {
      return new Response(JSON.stringify({ error: "Protected sale receipts must be derived through source_sale_qualification" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const protectedReply = (row: any, duplicate: boolean) => {
      if (!archivedSale?.ok) return null;
      const saved = row?.structured_data?.source_sale_receipt;
      const exactTuple = saved && Object.entries(archivedSale.receipt).every(([key,value]) => saved[key] === value);
      if (!row?.id || row.source_snapshot_id !== archivedSale.receipt.snapshot_id || !Number.isFinite(Date.parse(row.ingested_at)) || !exactTuple
        || row.kind !== "sale_result" || row.is_superseded !== false || row.source_id !== source.id
        || row.extraction_method !== ARCHIVED_SALE_METHOD || row.extractor_id !== ARCHIVED_SALE_METHOD
        || row.raw_source_ref !== input.raw_source_ref || row.source_identifier !== input.source_identifier
        || row.source_url !== input.source_url || Date.parse(row.observed_at) !== Date.parse(input.observed_at)) {
        return new Response(JSON.stringify({ error: "Persisted protected sale receipt unavailable" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true, dry_run: false, duplicate, observation_id: row.id,
        vehicle_id: input.vehicle_id, receipt: saved, derived_ingested_at: row.ingested_at,
        availability_known_at: row.ingested_at, model_calls: 0, writes: duplicate ? 0 : 1 }),
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
    const { data: source, error: sourceError } = await supabase
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
      if (!isSupportedImagePropertyKey(input.property_key)) {
        return new Response(JSON.stringify({ error: "Unsupported property_key for this intake" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const lookup = await supabase.from("observation_properties")
        .select("id, property_key, applies_to_kinds, namespace, deprecated_at")
        .eq("property_key", input.property_key).maybeSingle();
      if (lookup.error) {
        return new Response(JSON.stringify({ error: "Property registry unavailable" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      propertyRow = lookup.data;
    }
    const property = validateObservationProperty(input, propertyRow);
    if (!property.ok) {
      return new Response(JSON.stringify({ error: property.error }),
        { status: property.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Compute content hash for deduplication.
    // Hash includes vehicle_id + observed_at + observer_raw so observations on different
    // vehicles or from different source photos don't collapse onto each other.
    // Bug fix 2026-05-24: previously two observations with same source/kind but different
    // vehicle_id collapsed into one row; cross-vehicle reuse of an observation_id was
    // returned to callers. See ISSUES.md "[MEDIUM] ingest-observation dedup ignores vehicle_id".
    const contentHash = await observationContentHash(input);

    // Check for duplicate
    const { data: existing } = await supabase
      .from("vehicle_observations")
      .select(archivedSale?.ok ? "id,ingested_at,structured_data,source_snapshot_id,kind,is_superseded,source_id,extraction_method,extractor_id,raw_source_ref,source_identifier,source_url,observed_at" : "id")
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (existing) {
      const protectedResponse = protectedReply(existing,true);
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
      // Two identical workers may pass the pre-read simultaneously. Only the
      // unique content-hash winner is a replay; other constraint failures fail.
      if (insertError.code === "23505") {
        const { data: winner } = await supabase.from("vehicle_observations")
            .select(archivedSale?.ok ? "id,ingested_at,structured_data,source_snapshot_id,kind,is_superseded,source_id,extraction_method,extractor_id,raw_source_ref,source_identifier,source_url,observed_at" : "id").eq("content_hash", contentHash).maybeSingle();
        if (winner) {
          const protectedResponse = protectedReply(winner,true);
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

    const protectedResponse = protectedReply(observation,false);
    if (protectedResponse) return protectedResponse;

    // Fire-and-forget: trigger analysis engine for this vehicle+observation kind
    if (vehicleId && input.kind && input.defer_analysis !== true) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
