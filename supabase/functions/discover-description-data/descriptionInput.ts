import { extractDescription } from "../_shared/batParser.ts";

// Input resolution for the existing description miner. Never reconstruct missing
// text from a vehicle summary or silently replace a newer source with older prose.
export const MAX_DESCRIPTION_CHARS = 32_000;

export interface DescriptionInput {
  text: string;
  sourceRef: string;
  sourceUrl: string;
  observedAt: string | null;
  ingestedAt: string;
  textField?: string;
  capturedAt?: string;
  captureSha256?: string;
  custody?: "sanctioned_observation" | "protected_snapshot";
}

function urlKey(value: unknown): string | null {
  try {
    const u = new URL(String(value));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // Strip tracking only. Query parameters can identify a different listing.
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch { return null; }
}

export function requireCompleteInput(input: DescriptionInput): DescriptionInput {
  if (!input.text.trim()) throw new Error("Preserved listing text is empty");
  if (input.text.length > MAX_DESCRIPTION_CHARS) {
    throw new Error(`Preserved listing text exceeds ${MAX_DESCRIPTION_CHARS} characters; not truncated or mined`);
  }
  return input;
}

export async function loadDescriptionInput(
  supabase: any,
  vehicle: { id: string; listing_url?: string | null; discovery_url?: string | null; origin_metadata?: any },
  asOf = new Date().toISOString(),
): Promise<DescriptionInput> {
  const expectedUrl = urlKey(vehicle.listing_url || vehicle.discovery_url);
  const observations = await supabase.from("vehicle_observations")
      .select("id,source_url,content_text,structured_data,observed_at,ingested_at")
      .eq("vehicle_id", vehicle.id).eq("kind", "listing").eq("subject_type", "vehicle")
      .or("is_superseded.eq.false,is_superseded.is.null")
      .lte("observed_at", asOf).lte("ingested_at", asOf)
      .order("observed_at", { ascending: false }).order("ingested_at", { ascending: false }).limit(5);
  if (observations.error) {
    throw new Error("Preserved listing text lookup failed; mining refused");
  }
  // Keep source selection bounded and anchored to the vehicle's current listing.
  // If its URL is unknown, multiple URLs are ambiguous rather than a longest-text contest.
  const URLs = new Set([...(observations.data || [])]
    .map((row: any) => urlKey(row.source_url)).filter(Boolean));
  const selectedUrl = expectedUrl || (URLs.size === 1 ? [...URLs][0] : null);
  if (!selectedUrl) throw new Error("Listing source is unknown or ambiguous; mining refused");

  const rows = (observations.data || []).filter((row: any) => urlKey(row.source_url) === selectedUrl);
  const source = rows[0];
  if (source) {
    const data = source.structured_data || {};
    const visibility = await supabase.rpc("observation_is_public", { p_kind: "listing", p_data: data });
    if (visibility.error || visibility.data !== true ||
        (data.subject_type && data.subject_type !== "vehicle")) {
      throw new Error("Listing observation is restricted; mining refused");
    }
  }
  // extraction_metadata is publicly writable in the current schema. A vehicle's
  // mutable origin metadata is only a locator, never custody for its text/values.
  // Derive directly from the existing admin/service-only snapshot, and require
  // that its protected parser record matched this vehicle and source URL.
  const snapshotId = vehicle.origin_metadata?.bat_snapshot_parsed?.snapshot_id;
  if (snapshotId !== undefined) {
    if (typeof snapshotId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
      throw new Error("Snapshot locator invalid; source custody unknown, mining refused");
    }
    const { data: snapshot, error } = await supabase.from("listing_page_snapshots")
      .select("id,platform,listing_url,fetched_at,created_at,success,http_status,html,html_sha256,metadata")
      .eq("id", snapshotId).maybeSingle();
    const capture = Date.parse(snapshot?.fetched_at);
    const ingestion = Date.parse(snapshot?.created_at);
    if (error || !snapshot || snapshot.platform !== "bat" || snapshot.success !== true ||
        typeof snapshot.http_status !== "number" || snapshot.http_status < 200 || snapshot.http_status >= 300 ||
        urlKey(snapshot.listing_url) !== selectedUrl ||
        snapshot.metadata?.vehicle_id !== vehicle.id || snapshot.metadata?.vehicle_matched !== true ||
        !Number.isFinite(capture) || !Number.isFinite(ingestion) || capture > Date.parse(asOf) ||
        ingestion > Date.parse(asOf)) {
      throw new Error("Protected same-source snapshot unavailable; source custody unknown, mining refused");
    }
    // Never use an older capture to reconstruct a newer missing read. Receipt-only
    // snapshots and storage paths are explicit refusals; this reader adds no raw access.
    if (!source || capture >= Date.parse(source.ingested_at)) {
      if (typeof snapshot.html !== "string" || !snapshot.html || snapshot.html.length > 5_000_000) {
        throw new Error("Protected snapshot text unavailable or oversized; mining refused");
      }
      if (typeof snapshot.html_sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(snapshot.html_sha256) ||
          snapshot.html_sha256.toLowerCase() !== await descriptionInputFingerprint({ text: snapshot.html } as DescriptionInput)) {
        throw new Error("Protected snapshot capture hash missing or mismatched; mining refused");
      }
      const text = extractDescription(snapshot.html);
      if (!text || text.length < 100) throw new Error("Protected snapshot prose unavailable; mining refused");
      return requireCompleteInput({ text, sourceRef: `listing_page_snapshots:${snapshot.id}`,
        sourceUrl: snapshot.listing_url, observedAt: null, capturedAt: snapshot.fetched_at,
        ingestedAt: snapshot.created_at, textField: "listing_page_snapshots.html:batParser.extractDescription",
        custody: "protected_snapshot", captureSha256: snapshot.html_sha256.toLowerCase() });
    }
  }
  if (source) {
    const data = source.structured_data || {};
    // These fields have no enforced completeness contract. Within this one
    // capture, a short description must not hide a longer preserved body.
    const candidates = [["vehicle_observations.structured_data.raw_description", data.raw_description],
      ["vehicle_observations.content_text", source.content_text],
      ["vehicle_observations.structured_data.description", data.description]]
      .filter(([, text]) => typeof text === "string" && text.trim().length >= 100)
      .sort((a, b) => String(b[1]).length - String(a[1]).length);
    const [textField, text] = candidates[0] || [];
    // Old BaT rows contain only a title/marker (often 16 chars); that is not prose.
    if (typeof text === "string" && text.trim().length >= 100) {
      return requireCompleteInput({ text, sourceRef: `vehicle_observations:${source.id}`,
        sourceUrl: source.source_url, observedAt: source.observed_at, ingestedAt: source.ingested_at,
        textField, custody: "sanctioned_observation" });
    }
  }
  throw new Error("Preserved listing text unavailable; unverified metadata custody unknown, summary not mined");
}

export function descriptionSourceMetadata(input: DescriptionInput) {
  return { source_ref: input.sourceRef, source_url: input.sourceUrl,
    source_observed_at: input.observedAt, source_ingested_at: input.ingestedAt,
    source_captured_at: input.capturedAt || null,
    source_capture_sha256: input.captureSha256 || null,
    source_custody: input.custody || "unknown",
    source_event_time_status: input.observedAt ? "known" : "unknown",
    observation_time_basis: input.observedAt ? "source_event" : "source_capture",
    source_text_field: input.textField || "unknown", source_completeness: "unknown",
    input_characters: input.text.length, miner_input_truncated: false };
}

export async function descriptionInputFingerprint(input: DescriptionInput): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// Retained under the specification observation's existing parent RLS, never in
// the publicly readable description_discoveries cache. Retain the original
// generated items so retrying partial intake does not pay for or vary an assessment.
export async function conditionExtractionArtifact(input: DescriptionInput, conditions: any[], model: string) {
  return { ...descriptionSourceMetadata(input), input_sha256: await descriptionInputFingerprint(input),
    conditions, model };
}

export async function reusableConditionExtraction(rawExtraction: any, input: DescriptionInput) {
  const cached = rawExtraction?.__description_condition_extraction;
  if (!cached || cached.source_ref !== input.sourceRef || cached.source_url !== input.sourceUrl ||
      cached.source_observed_at !== input.observedAt || cached.source_ingested_at !== input.ingestedAt ||
      cached.source_captured_at !== (input.capturedAt || null) ||
      cached.source_capture_sha256 !== (input.captureSha256 || null) ||
      cached.input_sha256 !== await descriptionInputFingerprint(input)) return null;
  if (!Array.isArray(cached.conditions) || typeof cached.model !== "string" || !cached.model) {
    throw new Error("Cached condition artifact malformed; retry refused");
  }
  return { conditions: cached.conditions, model: cached.model };
}

export async function loadReusableConditionExtraction(supabase: any, vehicleId: string, input: DescriptionInput,
  asOf = new Date().toISOString()) {
  const { data, error } = await supabase.from("vehicle_observations")
    .select("structured_data,extraction_metadata")
    .eq("vehicle_id", vehicleId).eq("kind", "specification").eq("subject_type", "vehicle")
    .eq("extraction_method", "description_discovery_v2_full_source").eq("raw_source_ref", input.sourceRef)
    .eq("source_url", input.sourceUrl).or("is_superseded.eq.false,is_superseded.is.null")
    .lte("observed_at", asOf).lte("ingested_at", asOf)
    .order("ingested_at", { ascending: false }).limit(5);
  if (error) throw new Error("Protected condition output lookup failed; inference refused");
  for (const row of data || []) {
    const visibility = await supabase.rpc("observation_is_public", {
      p_kind: "specification", p_data: row.structured_data || {},
    });
    if (visibility.error || visibility.data !== true) throw new Error("Condition output restricted; retry refused");
    const artifact = await reusableConditionExtraction(row.extraction_metadata, input);
    if (artifact) return artifact;
  }
  return null;
}

export function conditionObservationInput(
  vehicleId: string, condition: any, input: DescriptionInput, model: string,
  inferredAt = new Date().toISOString(),
) {
  const quote = condition.quote;
  if (typeof quote !== "string" || !quote.trim() || !input.text.includes(quote)) {
    throw new Error("Condition quote does not occur verbatim in preserved source; claim refused");
  }
  return {
    source_slug: "ai-description-extraction", kind: "condition", vehicle_id: vehicleId,
    // The publication date remains unknown for snapshots. The known capture
    // clock anchors replay; it is explicitly labelled, never sold as event time.
    observed_at: input.observedAt || input.capturedAt || input.ingestedAt,
    content_text: condition.summary || quote,
    structured_data: { category: condition.category, severity: condition.severity,
      component: condition.component, is_positive: condition.is_positive ?? false,
      quote, is_inferred: true,
      ...descriptionSourceMetadata(input) },
    raw_source_ref: input.sourceRef, source_url: input.sourceUrl, citation: { excerpt: quote },
    extraction_metadata: { inference_at: inferredAt, ...descriptionSourceMetadata(input) },
    extraction_method: "description_condition_v2_full_source", agent_model: model,
    agent_inferred: true, defer_analysis: true,
  };
}

// Locator preview only: exact source sentences, not accepted condition/spec values.
export function descriptionPreview(input: DescriptionInput) {
  return { ...descriptionSourceMetadata(input), excerpts: input.text
    .split(/(?<=[.!?])\s+/)
    .filter(text => /\b(vin|needs?|replac\w*|rebuil\w*|transmission|tranny|titled|manuals?|choice)\b/i.test(text))
    .slice(0, 12).map(quote => ({ quote })) };
}
