/** Source-event identity stays stable when an observation is later attributed to a chassis.
 * Legacy callers retain their original hash grammar. Source-event callers must supply a stable
 * source_identifier and a frozen clock; a correction is new testimony followed by supersession.
 */
export interface ObservationIdentityInput {
  source_slug: string;
  kind: string;
  vehicle_id?: string;
  source_url?: string;
  source_identifier?: string;
  observed_at: string;
  content_text?: string;
  structured_data?: Record<string, unknown>;
  observer_raw?: Record<string, unknown>;
  descriptor_key?: string;
  dedup_scope?: "source_event";
  resolution_mode?: "exact_only" | "none";
}

/** These are attribution outputs, not immutable source claims. Share the list with preparers
 * so a named/canonical alias cannot accidentally fork source-event identity after resolution.
 */
export const MUTABLE_SOURCE_ATTRIBUTION_KEYS = [
  "vehicle_id", "auction_event_id", "event_id", "publication_id", "citation_publication_id",
  "resolved_vehicle_id", "resolved_auction_event_id", "resolved_event_id", "resolved_publication_id",
  "canonical_vehicle_id", "canonical_auction_event_id", "canonical_event_id", "canonical_publication_id",
  "resolution_status", "vehicle_resolution_status", "match_method", "match_confidence",
] as const;

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function observationHashInput(input: ObservationIdentityInput): string {
  const common = {
    source: input.source_slug,
    kind: input.kind,
    source_url: input.source_url || "",
    source_identifier: input.source_identifier || "",
    observed_at: input.observed_at,
    text: input.content_text || "",
    data: input.structured_data || {},
    observer: input.observer_raw || {},
    descriptor: input.descriptor_key,
  };
  if (input.dedup_scope === "source_event") {
    if (!input.source_identifier?.trim()) throw new Error("source_event dedup requires source_identifier");
    for (const parent of [input.structured_data?.event_context, input.structured_data?.attribution]) {
      if (parent && typeof parent === "object" && MUTABLE_SOURCE_ATTRIBUTION_KEYS
        .some(key => Object.hasOwn(parent, key))) {
        throw new Error("Source-event content cannot contain mutable attribution; use typed links or extraction_metadata");
      }
    }
    // Source keys identify the source occurrence. A later reread clock or URL alias is not
    // a second event; the first receipt retains its original capture clock and raw citation.
    const { observed_at: _captureClock, source_url: _urlAlias, ...sourceContent } = common;
    return canonicalJson({ version: "source-event-v1", ...sourceContent });
  }
  // Preserve the order of the original hash payload, including vehicle_id before source_url.
  return JSON.stringify({
    source: common.source, kind: common.kind, vehicle_id: input.vehicle_id || "",
    source_url: common.source_url, source_identifier: common.source_identifier,
    observed_at: common.observed_at, text: common.text, data: common.data,
    observer: common.observer, descriptor: common.descriptor,
  });
}
