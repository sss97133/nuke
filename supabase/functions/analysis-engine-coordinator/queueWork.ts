// The existing queue owns pending work. A wake is optional; a lease is not.
export interface AnalysisClaim {
  id: string;
  vehicle_id: string;
  claimed_revision: number;
  lease_token: string;
  claimed_widget_slugs: string[];
}
export class AnalysisLeaseLost extends Error {}
type Database = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

export async function enqueueAnalysis(db: Database, vehicle: string, source: string,
  reasons: string[], widgets: string[] | null, priority: number) {
  const result = await db.rpc("enqueue_analysis_work", { p_vehicle_id: vehicle, p_source: source,
    p_reasons: reasons, p_widget_slugs: widgets, p_priority: priority });
  if (result.error) throw new Error(`Analysis enqueue failed: ${result.error.message}`);
  return result.data as string | null;
}

export async function runAnalysisQueue(db: Database, options: {
  batchSize: number;
  vehicleId?: string;
  compute: (claim: AnalysisClaim, widget: string, workerId: string) => Promise<Record<string, unknown>>;
  now?: () => number;
  workerId?: string;
}) {
  const now = options.now ?? Date.now;
  if (!Number.isFinite(options.batchSize)) throw new Error("Invalid analysis batch size");
  const deadline = now() + 90_000;
  const worker = options.workerId ?? `coordinator-${crypto.randomUUID()}`;
  const limit = Math.max(0, Math.min(Math.floor(options.batchSize), 20));
  const results: Array<Record<string, any>> = [];
  let claimedCount = 0;
  // Claim one at a time: a short-lived function must not lease a batch it will
  // die before reaching. Completed widget receipts survive a later crash.
  for (let n = 0; n < limit && now() < deadline - 35_000; n++) {
    const response = await db.rpc("claim_analysis_queue_batch", { p_batch_size: 1,
      p_worker_id: worker, p_vehicle_id: options.vehicleId ?? null });
    if (response.error) throw new Error(`Analysis claim failed: ${response.error.message}`);
    const claim: AnalysisClaim | undefined = response.data?.[0];
    if (!claim) break;
    claimedCount++;
    const started = now();
    const succeeded: string[] = [];
    const signals: Record<string, unknown>[] = [];
    const failures: string[] = [];
    let lost = false;
    if (!Array.isArray(claim.claimed_widget_slugs)) throw new Error("Missing claimed widget snapshot");
    for (const slug of claim.claimed_widget_slugs) {
      if (now() >= deadline - 35_000) break;
      try {
        signals.push(await options.compute(claim, slug, worker));
        succeeded.push(slug);
      } catch (error) {
        if (error instanceof AnalysisLeaseLost) { lost = true; break; }
        failures.push(`${slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (lost) break;
    const finished = await db.rpc("finish_analysis_queue_work", { p_id: claim.id,
      p_worker_id: worker, p_revision: claim.claimed_revision, p_lease_token: claim.lease_token, p_succeeded_widgets: succeeded,
      p_failed: failures.length, p_compute_time_ms: Math.max(0, now() - started),
      p_error: failures.length ? failures.join("; ").slice(0, 2000) : null });
    if (finished.error) throw new Error(`Analysis completion failed: ${finished.error.message}`);
    if (!["pending", "complete", "failed", "lease_lost"].includes(finished.data?.status)) {
      throw new Error("Analysis completion receipt missing");
    }
    if (finished.data?.status === "lease_lost") break;
    results.push({ vehicle_id: claim.vehicle_id, queue_id: claim.id,
      processed_revision: claim.claimed_revision, status: finished.data?.status,
      widgets_computed: succeeded.length, widgets_failed: failures.length,
      duration_ms: Math.max(0, now() - started), signals });
  }
  return { claimed: claimedCount, processed: results.length,
    total_computed: results.reduce((n, r) => n + r.widgets_computed, 0),
    total_failed: results.reduce((n, r) => n + r.widgets_failed, 0), results };
}
