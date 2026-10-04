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
  vehicle: { id: string; listing_url?: string | null; discovery_url?: string | null },
  asOf = new Date().toISOString(),
): Promise<DescriptionInput> {
  const expectedUrl = urlKey(vehicle.listing_url || vehicle.discovery_url);
  const [observations, metadata] = await Promise.all([
    supabase.from("vehicle_observations")
      .select("id,source_url,content_text,structured_data,observed_at,ingested_at")
      .eq("vehicle_id", vehicle.id).eq("kind", "listing").eq("subject_type", "vehicle")
      .or("is_superseded.eq.false,is_superseded.is.null")
      .lte("observed_at", asOf).lte("ingested_at", asOf)
      .order("observed_at", { ascending: false }).order("ingested_at", { ascending: false }).limit(5),
    supabase.from("extraction_metadata")
      .select("id,field_value,source_url,extracted_at")
      .eq("vehicle_id", vehicle.id).eq("field_name", "raw_listing_description")
      .lte("extracted_at", asOf).order("extracted_at", { ascending: false }).limit(5),
  ]);
  if (observations.error || metadata.error) {
    throw new Error("Preserved listing text lookup failed; mining refused");
  }
  // Keep source selection bounded and anchored to the vehicle's current listing.
  // If its URL is unknown, multiple URLs are ambiguous rather than a longest-text contest.
  const URLs = new Set([...observations.data || [], ...metadata.data || []]
    .map((row: any) => urlKey(row.source_url)).filter(Boolean));
  const selectedUrl = expectedUrl || (URLs.size === 1 ? [...URLs][0] : null);
  if (!selectedUrl) throw new Error("Listing source is unknown or ambiguous; mining refused");

  const rows = (observations.data || []).filter((row: any) => urlKey(row.source_url) === selectedUrl);
  const source = rows[0];
  const raw = (metadata.data || []).find((row: any) => urlKey(row.source_url) === selectedUrl);
  if (source) {
    const data = source.structured_data || {};
    const visibility = await supabase.rpc("observation_is_public", { p_kind: "listing", p_data: data });
    if (visibility.error || visibility.data !== true ||
        (data.subject_type && data.subject_type !== "vehicle")) {
      throw new Error("Listing observation is restricted; mining refused");
    }
  }
  // Prefer explicitly preserved full prose from the same/newer capture over an
  // observation's title/summary. Older metadata cannot rescue a missing latest read.
  if (raw && typeof raw.field_value === "string" && raw.extracted_at &&
      (!source || new Date(raw.extracted_at) >= new Date(source.ingested_at))) {
    // Metadata records an extraction clock, not the listing's publication/event
    // clock. Do not manufacture one from a different read of the same URL.
    return requireCompleteInput({ text: raw.field_value, sourceRef: `extraction_metadata:${raw.id}`,
      sourceUrl: raw.source_url, observedAt: null, ingestedAt: raw.extracted_at,
      textField: "extraction_metadata.field_value" });
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
        textField });
    }
  }
  throw new Error("Full preserved listing text unavailable for this source; summary not mined");
}

export function descriptionSourceMetadata(input: DescriptionInput) {
  return { source_ref: input.sourceRef, source_url: input.sourceUrl,
    source_observed_at: input.observedAt, source_ingested_at: input.ingestedAt,
    source_event_time_status: input.observedAt ? "known" : "unknown",
    observation_time_basis: input.observedAt ? "source_event" : "source_capture",
    source_text_field: input.textField || "unknown", source_completeness: "unknown",
    input_characters: input.text.length, miner_input_truncated: false };
}

export async function descriptionInputFingerprint(input: DescriptionInput): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// Private learning-cache artifact; not a new vehicle fact. Retain the original
// generated items so retrying partial intake does not pay for or vary an assessment.
export async function conditionExtractionArtifact(input: DescriptionInput, conditions: any[], model: string) {
  return { ...descriptionSourceMetadata(input), input_sha256: await descriptionInputFingerprint(input),
    conditions, model };
}

export async function reusableConditionExtraction(rawExtraction: any, input: DescriptionInput) {
  const cached = rawExtraction?.__description_condition_extraction;
  if (!cached || cached.source_ref !== input.sourceRef || cached.source_url !== input.sourceUrl ||
      cached.source_observed_at !== input.observedAt || cached.source_ingested_at !== input.ingestedAt ||
      cached.input_sha256 !== await descriptionInputFingerprint(input)) return null;
  if (!Array.isArray(cached.conditions) || typeof cached.model !== "string" || !cached.model) {
    throw new Error("Cached condition artifact malformed; retry refused");
  }
  return { conditions: cached.conditions, model: cached.model };
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
    // The publication date remains unknown for metadata. The known capture
    // clock anchors replay; it is explicitly labelled, never sold as event time.
    observed_at: input.observedAt || input.ingestedAt,
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
