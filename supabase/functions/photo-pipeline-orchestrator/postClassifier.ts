/**
 * Runners for the post-classifier stages ('filing', 'evidence') of image_stage_work.
 *
 * They re-run only the steps AFTER the classifier, from the classification saved in ai_scan_metadata.classification
 * (kept by the orchestrator when it failed after the paid call, and by the success path). They never receive or call
 * classifyImage: the dependency list below has no classifier, and a missing saved classification is a typed
 * `blocked_input` receipt, not a reason to re-pay the model.
 *
 * Each outcome is one receipt on the stage that ran (image_stage_receipts). A failed receipt is retried by the
 * reconciler with the backoff record_image_stage_receipt chose; this runner only reports what it observed.
 * Order mirrors the live pipeline: filing, then evidence. A filing retry that succeeds continues into evidence when no
 * evidence receipt has succeeded yet, because the original run stopped at the filing throw and never reached it.
 */
import { buildStageReceipt, type StageReceiptArgs } from "./stageReceipts.ts";
import type { StageRunResult, WorkItem } from "./stageWorker.ts";

export type Classification = Record<string, any> & { image_type?: string };

export interface PostClassifierDeps {
  /** ai_scan_metadata.classification and the row's current vehicle_id; null classification = nothing saved. */
  loadSaved(imageId: string): Promise<{ classification: Classification | null; vehicle_id: string | null; image_url: string | null } | null>;
  /** Newest receipt outcome for (image, stage) at any version, or null. */
  latestOutcome(imageId: string, stage: string): Promise<string | null>;
  /** Step 3: resolve + file. Returns the vehicle the photo is now on (null = nothing to file on). Throws on a filing error. */
  fileVehicle(imageId: string, userId: string | null, classification: Classification): Promise<string | null>;
  /** Steps 4-6 for a vehicle (or none). Throws on a handler / observation / field-evidence error. */
  gatherEvidence(item: WorkItem, imageUrl: string, vehicleId: string | null, classification: Classification): Promise<void>;
  /** Marks the image completed again after a retry closed the failure (via the guarded state writer). */
  markCompleted(imageId: string): Promise<void>;
  record(receipt: StageReceiptArgs | null): Promise<boolean>;
}

const receipt = (deps: PostClassifierDeps, imageId: string, stage: "filing" | "evidence", outcome: Parameters<typeof buildStageReceipt>[2],
  opts: Parameters<typeof buildStageReceipt>[3] = {}) => deps.record(buildStageReceipt(imageId, stage, outcome, { detail: { via: "stage_worker" }, ...opts }));

/** Runs one claimed filing / evidence item. Always writes a receipt for what it observed; never throws. */
export async function runPostClassifierStage(deps: PostClassifierDeps, stage: string, item: WorkItem): Promise<StageRunResult> {
  if (stage !== "filing" && stage !== "evidence") return { ok: false };
  try {
    const saved = await deps.loadSaved(item.image_id);
    const classification = saved?.classification;
    if (!saved || !classification || typeof classification !== "object" || !classification.image_type) {
      // Terminal: without the saved answer the only recovery is the paid classifier, which this worker will not call.
      await receipt(deps, item.image_id, stage, "blocked_input", { errorClass: "no_saved_classification" });
      return { ok: false };
    }
    const imageUrl = saved.image_url ?? item.image_url;
    let vehicleId = saved.vehicle_id ?? item.vehicle_id;

    if (stage === "filing") {
      let filedNow = false;
      try {
        if (!vehicleId) { vehicleId = await deps.fileVehicle(item.image_id, item.user_id, classification); filedNow = vehicleId !== null; }
      } catch {
        await receipt(deps, item.image_id, "filing", "failed", { errorClass: "photo_pipeline_attribution_failed" });
        return { ok: false };
      }
      await receipt(deps, item.image_id, "filing", "succeeded", { detail: { via: "stage_worker", vehicle_filed: filedNow || vehicleId !== null } });
      // The original run threw at filing and never reached the handlers: continue unless evidence already succeeded.
      if ((await deps.latestOutcome(item.image_id, "evidence")) === "succeeded") { await deps.markCompleted(item.image_id).catch(() => {}); return { ok: true }; }
      return await runEvidence(deps, item, imageUrl, vehicleId, classification);
    }

    // evidence only: a photo whose filing is still failing is not run vehicle-less (that would record the wrong evidence)
    if ((await deps.latestOutcome(item.image_id, "filing")) === "failed") {
      await receipt(deps, item.image_id, "evidence", "failed", { errorClass: "filing_not_settled" });
      return { ok: false };
    }
    return await runEvidence(deps, item, imageUrl, vehicleId, classification);
  } catch {
    // loadSaved / receipt plumbing failed: leave the lease to expire; the item returns to the queue (attempt-capped)
    return { ok: false };
  }
}

async function runEvidence(deps: PostClassifierDeps, item: WorkItem, imageUrl: string, vehicleId: string | null, classification: Classification): Promise<StageRunResult> {
  try {
    await deps.gatherEvidence(item, imageUrl, vehicleId, classification);
  } catch {
    await receipt(deps, item.image_id, "evidence", "failed", { errorClass: "pipeline_operation_failed" });
    return { ok: false };
  }
  await receipt(deps, item.image_id, "evidence", "succeeded");
  await deps.markCompleted(item.image_id).catch(() => {});
  return { ok: true };
}
