import { writeObservation, type ObservationInput } from "../_shared/observationWriter.ts";

const TEXT_FIELDS = new Set([
  "description", "import_metadata", "highlights", "equipment", "modifications", "known_flaws", "recent_service_history",
]);

const jsonKey = (value: unknown) => JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

export interface CabObservation {
  vehicleId: string;
  listingUrl: string;
  listingId: string | null;
  capturedAt: string;
  vehicleData: Record<string, unknown>;
}

/** Use the existing writer, then verify its persisted receipt before reporting a load. */
export async function loadCabObservation(supabase: any, capture: CabObservation, writer = writeObservation) {
  const clock = Date.parse(capture.capturedAt);
  if (!Number.isFinite(clock) || !capture.listingId) throw new Error("C&B observation needs its source ID and capture clock");
  const observedAt = capture.capturedAt;
  const input: ObservationInput = {
    vehicleId: capture.vehicleId,
    source: { platform: "cars-and-bids", url: capture.listingUrl, sourceIdentifier: capture.listingId, trustScore: 0.8 },
    fields: Object.fromEntries(Object.entries(capture.vehicleData).filter(([key]) => !TEXT_FIELDS.has(key))),
    contentText: typeof capture.vehicleData.description === "string" ? capture.vehicleData.description : undefined,
    rawData: {
      source_captured_at: observedAt,
      import_metadata: capture.vehicleData.import_metadata ?? null,
    },
    hashRawData: true,
    observedAt,
    observationKind: "listing",
    extractionMethod: "dom_parse",
  };
  const result = await writer(supabase, input);
  if (!result.observationId || result.errors.length) {
    throw new Error(`C&B observation load failed: ${result.errors.join("; ") || "no persisted receipt"}`);
  }
  const { data: row, error } = await supabase.from("vehicle_observations")
    .select("id,vehicle_id,source_url,source_identifier,kind,observed_at,is_superseded,structured_data,content_text,extraction_metadata")
    // PostgreSQL retains microseconds that JavaScript's Date comparison truncates.
    .eq("id", result.observationId).eq("observed_at", observedAt).maybeSingle();
  if (error || !row || row.vehicle_id !== capture.vehicleId || row.source_url !== capture.listingUrl ||
      row.source_identifier !== capture.listingId || row.kind !== "listing" || row.is_superseded === true ||
      Date.parse(row.observed_at) !== clock || (row.content_text ?? undefined) !== input.contentText ||
      !Object.entries(input.fields).every(([key, value]) => jsonKey(row.structured_data?.[key]) === jsonKey(value)) ||
      jsonKey(row.extraction_metadata?.raw) !== jsonKey(input.rawData)) {
    throw new Error("C&B observation receipt does not match the retained source or is superseded");
  }
  return { observationId: result.observationId, duplicate: result.duplicate ?? false };
}
