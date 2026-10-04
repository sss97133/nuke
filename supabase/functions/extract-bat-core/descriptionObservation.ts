/** Full parsed prose belongs to the existing listing intake, not the vehicle summary. */
import { observationClockMicroseconds, observationContentHash } from '../_shared/observationContentHash.ts';
export async function recordListingDescription(supabase: any, input: {
  vehicleId: string; sourceUrl: string; text: string; capturedAt: string | null; extractorVersion: string;
  captureBasis: "direct" | "snapshot"; captureSha256: string; snapshotId?: string | null;
  snapshotCustody?: { vehicleId?: string; matched?: boolean; sha256?: string | null };
  sourceTextField?: string; sourceArchiveIngestedAt?: string;
  dryRun?: boolean; strictReceipt?: boolean;
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
  if (input.sourceArchiveIngestedAt !== undefined) {
    const archiveClock = observationClockMicroseconds(input.sourceArchiveIngestedAt);
    if (archiveClock === null || archiveClock < captureClock || archiveClock > BigInt(Date.now())*1000n) {
      return { status: "refused", reason: "Source archive ingestion clock is invalid" };
    }
  }
  const body = {
    source_slug: "bat", kind: "listing", vehicle_id: input.vehicleId,
    source_url: input.sourceUrl, observed_at: capturedAt, content_text: input.text,
    structured_data: { description_capture: true, source_captured_at: capturedAt,
      extractor: "extract-bat-core", extractor_version: input.extractorVersion,
      source_event_time_status: "unknown", observation_time_basis: "source_capture",
      source_capture_basis: input.captureBasis === "snapshot" ? "protected_snapshot" : "direct_fetch",
      source_capture_sha256: input.captureSha256, source_completeness: "unknown",
      source_text_field: input.sourceTextField || "extract-bat-core.extractDescription", extractor_input_truncated: false,
      ...(input.sourceArchiveIngestedAt ? { source_archive_ingested_at: input.sourceArchiveIngestedAt } : {}) },
    // extractor_id names an optional registry UUID. A producer label is not that identity.
    extraction_method: "html_description_capture",
    raw_source_ref: input.snapshotId ? `listing_page_snapshots:${input.snapshotId}` : input.sourceUrl,
    defer_analysis: true,
  };
  // A pinned historical operation must not mistake a superseded/relinked hash
  // winner for successful replay. This uses the existing unique hash/PK indexes.
  const payloadHash = input.strictReceipt || input.dryRun ? await observationContentHash(body) : null;
  const receiptColumns = "id,vehicle_id,kind,subject_type,is_superseded,observed_at,source_url,raw_source_ref,extraction_method,content_text,structured_data,content_hash";
  const matches = (row: any) => row && row.vehicle_id === input.vehicleId && row.kind === "listing" &&
    row.subject_type === "vehicle" && row.is_superseded !== true && row.source_url === input.sourceUrl &&
    row.raw_source_ref === body.raw_source_ref && row.extraction_method === body.extraction_method &&
    row.content_hash === payloadHash && row.content_text === input.text &&
    observationClockMicroseconds(row.observed_at) === captureClock &&
    Object.keys(row.structured_data || {}).sort().join() === Object.keys(body.structured_data).sort().join() &&
    Object.entries(body.structured_data).every(([key,value]) => row.structured_data[key] === value);
  let existing: any = null;
  if (payloadHash) {
    const lookup = await supabase.from("vehicle_observations").select(receiptColumns)
      .eq("content_hash", payloadHash).maybeSingle();
    if (lookup.error || (lookup.data && !matches(lookup.data))) {
      return { status: "refused", reason: "Native receipt unavailable or superseded/relinked/changed; replay refused" };
    }
    existing = lookup.data;
  }
  if (input.dryRun) return { status: "preview", observation_payload_sha256: payloadHash,
    existing_observation_id: existing?.id || null, duplicate: !!existing };
  if (input.strictReceipt) {
    // Multi-request admission is not an atomic parent/snapshot SQL constraint.
    // Recheck immediately before intake; current public readers close private parents.
    const parent = await supabase.from("vehicles").select("id").eq("id", input.vehicleId)
      .eq("is_public", true).is("deleted_at", null)
      .or("listing_kind.is.null,listing_kind.neq.non_vehicle_item").maybeSingle();
    if (parent.error || !parent.data) return { status: "refused", reason: "Public vehicle unavailable at native intake" };
  }
  const { data, error } = await supabase.functions.invoke("ingest-observation", { body });
  if (error || !data?.success || !data?.observation_id) {
    return { status: "failed", reason: error?.message || data?.error || "Description intake returned no receipt" };
  }
  if (input.strictReceipt) {
    const receipt = await supabase.from("vehicle_observations").select(receiptColumns)
      .eq("id", data.observation_id).maybeSingle();
    if (receipt.error || !matches(receipt.data)) {
      return { status: "failed", reason: "Canonical intake returned a changed or unrelated native receipt" };
    }
  }
  return { status: "recorded", observation_id: data.observation_id, duplicate: data.duplicate === true };
}
