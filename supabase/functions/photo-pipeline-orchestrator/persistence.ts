/** Mutable processing receipt, not capture testimony. No upstream error text or URLs. */
export interface PipelineReceipt {
  receipt_id: string;
  attempt_id: string;
  image_id: string;
  method: "photo-pipeline-orchestrator";
  pipeline_version: "v2";
  receipt_version: 1;
  outcome: "processing" | "completed" | "failed" | "policy_skip";
  processing_started_at: string;
  processing_finished_at: string | null;
  classifier_model?: string | null;
  classifier_attempts?: number;
  failure_phase?: string;
  error_class?: string;
  http_status?: number;
  observation_id?: string;
  observation_status?: "created" | "existing" | "no_vehicle";
}

export interface MetadataSnapshot {
  metadata: Record<string, unknown>;
  updated_at: string;
  image_url?: string;
  vehicle_id?: string | null;
}

export interface MetadataStore {
  read(): Promise<MetadataSnapshot>;
  compareAndSwap(snapshot: MetadataSnapshot, patch: Record<string, unknown>): Promise<boolean>;
}

/**
 * Compare-and-swap uses the row's trigger-maintained updated_at token. On a
 * conflict, re-read and merge again; never claim that a stale spread is atomic.
 * Only processing state is changed here. Facts still use ingest-observation.
 */
export async function persistPipelineState(
  store: MetadataStore,
  receipt: PipelineReceipt,
  state: Record<string, unknown>,
  compatibilityMetadata: Record<string, unknown> = {},
  source?: { image_url: string; vehicle_id: string | null },
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await store.read();
    if (source && (snapshot.image_url !== source.image_url || snapshot.vehicle_id !== source.vehicle_id)) {
      throw new Error("photo_pipeline_source_changed");
    }
    const namespace = snapshot.metadata.photo_pipeline as Record<string, unknown> | undefined;
    const previous = namespace?.receipt as PipelineReceipt | undefined;
    if (previous?.receipt_id === receipt.receipt_id) return;
    if (previous && previous.attempt_id !== receipt.attempt_id &&
      (previous.processing_started_at >= receipt.processing_started_at || receipt.outcome !== "processing")) {
      throw new Error("photo_pipeline_stale_attempt");
    }
    const patch = {
      ...state,
      ai_scan_metadata: {
        ...snapshot.metadata,
        ...compatibilityMetadata,
        photo_pipeline: { ...namespace, receipt,
          ...(receipt.outcome === "failed" ? { last_failure: receipt } : {}),
          ...(receipt.outcome === "completed" ? { last_success: receipt } : {}),
        },
      },
    };
    if (await store.compareAndSwap(snapshot, patch)) return;
  }
  throw new Error("photo_pipeline_metadata_conflict_budget_exhausted");
}

/** An on-device VIN read uploaded with the photo (vehicle_vin) that may file it by exact match to one owned vehicle:
 * a full VIN read at >= 0.9, or a 5-16 char classic chassis serial (iOS writes these at 0.8 when the album names a make).
 * Never from a document; a document VIN only names a capture set. */
export function rowVinQualifies(vin: unknown, confidence: unknown, isDocument: unknown, docFlag: unknown): string | null {
  if (isDocument === true || docFlag === true || typeof vin !== "string") return null;
  const v = vin.trim().toUpperCase();
  const c = Number(confidence ?? 0);
  if (!Number.isFinite(c)) return null;
  if (v.length >= 17) return c >= 0.9 ? v : null;
  if (v.length >= 5 && /[0-9]/.test(v) && /^[A-Z0-9-]+$/.test(v)) return c >= 0.8 ? v : null;
  return null;
}
