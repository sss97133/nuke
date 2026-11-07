/**
 * Single-stage worker: claims image_stage_work (claim_image_stage_work, PR #3027) for ONE stage and runs only that
 * stage. Bounded three ways: items per run (limit <= MAX_ITEMS), wall-clock deadline, and the provider breaker, which
 * is re-read before every claim so a 429 mid-run stops the loop with nothing stranded (items are claimed one at a time).
 * Gated by platform_config image_stage_reconciler.enabled (default false), the same flag as the reconciler.
 * The stage runner is injected: the classifier runner is the orchestrator's own per-image path, which writes its
 * receipt; the worker never writes a receipt for a result it did not observe.
 */
import { readProviderGate } from "./providerBackoff.ts";

export const MAX_ITEMS = 8;
export const DEFAULT_DEADLINE_MS = 100_000;
/** Stages with a runner. A stage without one is refused before any claim, so no lease is wasted. */
export const SUPPORTED_STAGES = ["classifier"] as const;
/** Stages whose provider breaker applies. */
const PROVIDER_GATED = new Set(["classifier"]);

export interface WorkItem { work_id: number; image_id: string; image_url: string; user_id: string | null; vehicle_id: string | null; lane: string }
export interface StageRunResult { ok: boolean; rate_limited?: boolean }
type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export async function stageWorkerEnabled(db: Db): Promise<boolean> {
  try {
    const { data } = await db.from("platform_config").select("config_value").eq("config_key", "image_stage_reconciler").maybeSingle();
    return data?.config_value?.enabled === true;
  } catch { return false; }
}

export async function runStageWorker(db: Db, input: { stage?: string; limit?: number; deadline_ms?: number },
  run: (item: WorkItem) => Promise<StageRunResult>, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const stage = String(input.stage ?? "classifier");
  if (!(SUPPORTED_STAGES as readonly string[]).includes(stage)) return { success: false, error: "unsupported_stage", stage, status: 400 };
  if (!(await stageWorkerEnabled(db))) return { success: true, skipped: "disabled", stage, processed: 0 };

  const limit = Math.min(Math.max(Math.floor(Number(input.limit) || 4), 1), MAX_ITEMS);
  const deadline = now() + Math.min(Math.max(Number(input.deadline_ms) || DEFAULT_DEADLINE_MS, 1000), 140_000);
  let attempted = 0, ok = 0, stopped: string | null = null;
  while (attempted < limit) {
    if (now() >= deadline) { stopped = "deadline"; break; }
    if (PROVIDER_GATED.has(stage)) {
      const gate = await readProviderGate(db);
      if (gate.blocked) { stopped = "provider_cooldown"; break; }
    }
    const { data, error } = await db.rpc("claim_image_stage_work", { p_stage: stage, p_limit: 1, p_lease_seconds: 300 });
    if (error) return { success: false, error: "claim_failed", stage, attempted, processed: ok, status: 500 };
    const item = (data as WorkItem[] | null)?.[0];
    if (!item) { stopped = "queue_empty"; break; }
    if (attempted > 0) await sleep(2000);   // stagger provider calls, as process_pending does
    attempted++;
    try {
      const r = await run(item);
      if (r.ok) ok++;
      if (r.rate_limited) { stopped = "rate_limited"; break; }
    } catch { /* lease expiry returns the item to the queue; the runner's own receipt records the outcome */ }
  }
  return { success: true, stage, attempted, processed: ok, stopped: stopped ?? "limit" };
}

/**
 * Cheap availability probe. For each stage not known available (and either seen unavailable or flagged by #3024), send
 * ONE OPTIONS request to its edge function: 404 = not deployed (stays unavailable), anything else = deployed. The result
 * goes to set_image_stage_availability, which stamps available / available_since / last_probed_at. The reconciler then
 * enqueues the stage's unavailable receipts (enqueue_available_stage_retries). Bounded (MAX_PROBES, 5 s each), no body, no side effects.
 */
export const MAX_PROBES = 6;
export async function probeStageAvailability(db: Db, baseUrl: string, doFetch: typeof fetch = fetch) {
  if (!(await stageWorkerEnabled(db))) return { success: true, skipped: "disabled", probed: 0 };
  const { data, error } = await db.from("image_pipeline_stages")
    .select("stage, producer, legacy_unavailable_key, available, last_probed_at")
    .or("available.is.null,available.eq.false").order("last_probed_at", { ascending: true, nullsFirst: true }).limit(25);
  if (error) return { success: false, error: "stage_read_failed", probed: 0 };
  const due = ((data ?? []) as { stage: string; producer: string; legacy_unavailable_key: string | null; available: boolean | null }[])
    .filter((s) => s.available === false || s.legacy_unavailable_key).slice(0, MAX_PROBES);
  const results: { stage: string; available: boolean | null }[] = [];
  for (const s of due) {
    const fn = s.legacy_unavailable_key ?? s.producer;
    let available: boolean | null = null;
    try {
      const r = await doFetch(`${baseUrl}/functions/v1/${encodeURIComponent(fn)}`, { method: "OPTIONS", signal: AbortSignal.timeout(5000) });
      available = r.status !== 404;
    } catch { /* network error: unknown, leave the signal alone */ }
    if (available !== null) await db.rpc("set_image_stage_availability", { p_stage: s.stage, p_available: available, p_probed: true });
    results.push({ stage: s.stage, available });
  }
  return { success: true, probed: results.length, results };
}
