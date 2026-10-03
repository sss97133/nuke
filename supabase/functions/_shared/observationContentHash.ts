/** Preserve the canonical intake's JSON bytes, including omitted undefined keys. */
export interface ObservationHashInput {
  source_slug?: unknown; kind?: unknown; vehicle_id?: unknown; source_url?: unknown;
  source_identifier?: unknown; observed_at?: unknown; content_text?: unknown;
  structured_data?: unknown; observer_raw?: unknown; descriptor_key?: unknown;
  property_key?: unknown; source_comment_id?: unknown;
}

export function observationContentForHash(input: ObservationHashInput): string {
  return JSON.stringify({
    source: input.source_slug,
    kind: input.kind,
    vehicle_id: input.vehicle_id || "",
    source_url: input.source_url || "",
    source_identifier: input.source_identifier || "",
    observed_at: input.observed_at,
    text: input.content_text || "",
    data: input.structured_data || {},
    observer: input.observer_raw || {},
    descriptor: input.descriptor_key,
    property: input.property_key,
    source_comment: input.source_comment_id,
  });
}

export async function observationContentHash(input: ObservationHashInput): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(observationContentForHash(input)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
