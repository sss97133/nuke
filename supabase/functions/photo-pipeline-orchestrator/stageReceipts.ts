/**
 * Per-image stage receipts (image_stage_receipts, PR #3027) written by the orchestrator.
 *
 * Every stage outcome the orchestrator decides becomes one append-only receipt through
 * record_image_stage_receipt(): producer + version come from the registry row (image_pipeline_stages), the
 * outcome vocabulary is closed (succeeded | policy_skip | unavailable | rate_limited | failed), and a retry time
 * rides only on unavailable / rate_limited. Pure builders here; the I/O helper is best-effort and loud because a
 * receipt that cannot be written must never fail the photo (the reconciler then sees a gap and retries).
 */
import type { ClassifierReceipt } from "./classifier.ts";

/** Must equal image_pipeline_stages.required_version for the stage (migration 20261112090000). */
export const STAGE_VERSION: Record<string, number> = { classifier: 1, filing: 1, evidence: 1, engine_bay: 1, receipt_ocr: 1 };
/** #3024 stage_unavailable entries are keyed by edge-function name; the registry keys by stage. */
export const FUNCTION_TO_STAGE: Record<string, string> = { "analyze-engine-bay": "engine_bay", "receipt-photo-ocr": "receipt_ocr" };
export const UNAVAILABLE_RETRY_SECONDS = 3600;   // an undeployed function is rechecked hourly, not every tick
const MAX_RETRY_SECONDS = 86400;                 // the RPC clamps to this too

export type StageOutcome = "succeeded" | "policy_skip" | "unavailable" | "rate_limited" | "failed";

export interface StageReceiptArgs {
  p_image_id: string; p_stage: string; p_producer_version: number; p_outcome: StageOutcome;
  p_error_class: string | null; p_http_status: number | null; p_retry_after_seconds: number | null;
  p_detail: Record<string, unknown>;
}

export function buildStageReceipt(imageId: string, stage: string, outcome: StageOutcome, opts: {
  errorClass?: string | null; httpStatus?: number | null; retryAfterSeconds?: number | null; detail?: Record<string, unknown>;
} = {}): StageReceiptArgs | null {
  const version = STAGE_VERSION[stage];
  if (!imageId || !version) return null;
  const retryable = outcome === "unavailable" || outcome === "rate_limited";
  // the table's CHECK: every non-success says why, typed
  const errorClass = opts.errorClass ?? (outcome === "succeeded" || outcome === "policy_skip" ? null
    : outcome === "rate_limited" ? "classifier_rate_limited" : outcome === "unavailable" ? "edge_function_not_deployed" : "stage_failed");
  const retry = retryable && opts.retryAfterSeconds && opts.retryAfterSeconds > 0
    ? Math.min(Math.ceil(opts.retryAfterSeconds), MAX_RETRY_SECONDS) : null;
  return { p_image_id: imageId, p_stage: stage, p_producer_version: version, p_outcome: outcome,
    p_error_class: errorClass, p_http_status: opts.httpStatus ?? null, p_retry_after_seconds: retry, p_detail: opts.detail ?? {} };
}

/** Seconds until the retry time photo_pipeline_note_failure chose, else the provider's own Retry-After. */
export function rateLimitRetrySeconds(retry: unknown, detail: Pick<ClassifierReceipt, "retry_after_seconds"> | undefined, now = Date.now()): number | null {
  const next = (retry as { next_attempt_at?: string | null } | null)?.next_attempt_at;
  const at = next ? Date.parse(next) : NaN;
  if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - now) / 1000));
  return detail?.retry_after_seconds && detail.retry_after_seconds > 0 ? detail.retry_after_seconds : null;
}

/** Receipts for stages #3024 found undeployed: one `unavailable` per known stage, retry in an hour. */
export function unavailableReceipts(imageId: string, functionNames: string[] | undefined): StageReceiptArgs[] {
  const out: StageReceiptArgs[] = [];
  for (const fn of functionNames ?? []) {
    const stage = FUNCTION_TO_STAGE[fn];
    const r = stage ? buildStageReceipt(imageId, stage, "unavailable",
      { errorClass: "edge_function_not_deployed", retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS, detail: { function: fn } }) : null;
    if (r) out.push(r);
  }
  return out;
}

/** Phase of the pipeline after the classifier answered; each maps to its own registry stage. */
export type PostClassifierPhase = "filing" | "evidence";

/**
 * A failure after the classifier produced an answer (vehicle filing, route handlers, observation / field-evidence
 * writes, state persist). The classifier DID succeed, so it is receipted succeeded (the reconciler must not re-pay it)
 * and the failure is receipted on the phase's own stage, typed.
 */
export function postClassifierFailureReceipts(imageId: string, phase: PostClassifierPhase, errorClass: string,
  classification?: { image_type?: string; model?: string | null }): StageReceiptArgs[] {
  const out = [
    buildStageReceipt(imageId, "classifier", "succeeded", { detail: { classification: classification?.image_type ?? null, model: classification?.model ?? null, later_phase_failed: phase } }),
    buildStageReceipt(imageId, phase, "failed", { errorClass, detail: { after: "classifier_succeeded" } }),
  ];
  return out.filter((r): r is StageReceiptArgs => r !== null);
}

export async function recordStageReceipt(db: { rpc: (fn: string, args: Record<string, unknown>) => any },
  receipt: StageReceiptArgs | null): Promise<boolean> {
  if (!receipt) return false;
  try {
    const { error } = await db.rpc("record_image_stage_receipt", receipt as unknown as Record<string, unknown>);
    if (error) { console.warn("[photo-pipeline] stage receipt not written:", receipt.p_stage, error.code ?? "rpc_error"); return false; }
    return true;
  } catch { console.warn("[photo-pipeline] stage receipt threw:", receipt.p_stage); return false; }
}
