/** Full parsed prose belongs to the existing listing intake, not the vehicle summary. */
import { observationClockMicroseconds } from '../_shared/observationContentHash.ts';
export async function recordListingDescription(supabase: any, input: {
  vehicleId: string; sourceUrl: string; text: string; capturedAt: string | null; extractorVersion: string;
  captureBasis: "direct" | "snapshot"; captureSha256: string; snapshotId?: string | null;
  snapshotCustody?: { vehicleId?: string; matched?: boolean; sha256?: string | null };
}) {
  if (!input.text.trim()) return { status: "unavailable", reason: "Parsed listing prose is empty" };
  if (input.text.length > 32_000) return { status: "refused", reason: "Parsed listing prose exceeds 32000 characters; not truncated" };
  // Intake requires a clock. A missing capture must stay missing, never become now/the sale date.
  const captureClock = observationClockMicroseconds(input.capturedAt);
  if (captureClock === null || captureClock > BigInt(Date.now())*1000n) {
    return { status: "refused", reason: "Source capture clock is unknown" };
  }
  const capturedAt = input.capturedAt;
  if (!/^[0-9a-f]{64}$/i.test(input.captureSha256)) {
    return { status: "refused", reason: "Source capture fingerprint is unknown" };
  }
  if (input.captureBasis === "snapshot" && (!input.snapshotId ||
      input.snapshotCustody?.vehicleId !== input.vehicleId || input.snapshotCustody?.matched !== true ||
      input.snapshotCustody?.sha256?.toLowerCase() !== input.captureSha256.toLowerCase())) {
    return { status: "refused", reason: "Protected same-source snapshot custody is unverified" };
  }
  const { data, error } = await supabase.functions.invoke("ingest-observation", { body: {
    source_slug: "bat", kind: "listing", vehicle_id: input.vehicleId,
    source_url: input.sourceUrl, observed_at: capturedAt, content_text: input.text,
    structured_data: { description_capture: true, source_captured_at: capturedAt,
      extractor: "extract-bat-core", extractor_version: input.extractorVersion,
      source_event_time_status: "unknown", observation_time_basis: "source_capture",
      source_capture_basis: input.captureBasis === "snapshot" ? "protected_snapshot" : "direct_fetch",
      source_capture_sha256: input.captureSha256, source_completeness: "unknown",
      source_text_field: "extract-bat-core.extractDescription", extractor_input_truncated: false },
    // extractor_id names an optional registry UUID. A producer label is not that identity.
    extraction_method: "html_description_capture",
    raw_source_ref: input.snapshotId ? `listing_page_snapshots:${input.snapshotId}` : input.sourceUrl,
    defer_analysis: true,
  } });
  if (error || !data?.success || !data?.observation_id) {
    return { status: "failed", reason: error?.message || data?.error || "Description intake returned no receipt" };
  }
  return { status: "recorded", observation_id: data.observation_id, duplicate: data.duplicate === true };
}
