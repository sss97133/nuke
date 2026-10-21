// Ordered rollout compatibility: the implementation belongs to canonical intake.
// Core still uses its unchanged HTTP adapter until its one-handoff PR deploys.
export { closingBatTargets, collectBatLive, batStreamIO, type BatStreamIO } from "../ingest-observation/batLiveCollector.ts";

import { BAT_LIVE_COLLECT_MODE, batUrl } from "../_shared/batLiveEvents.ts";

/** One authenticated handoff, never an automatic retry of an ambiguous launch. */
export async function handoffBatLiveCollection(url: string, key: string, dryRun: boolean,
  context: { requestAt?: string; authMs?: number } = {},
) {
  const started = performance.now();
  try {
    const response = await fetch(`${url}/functions/v1/ingest-observation?native_collection_handoff=1`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: BAT_LIVE_COLLECT_MODE, dry_run: dryRun }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`bat_live_handoff_http_${response.status}`);
    const result = await response.json(), count = result?.selected_lots;
    const accepted = !dryRun && Number.isSafeInteger(count) && count > 0;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (result?.success !== true || result.mode !== BAT_LIVE_COLLECT_MODE || result.dry_run !== dryRun
      || !Number.isSafeInteger(count) || count < 0 || count > 200 || result.collector_duration_seconds !== 115
      || result.transport !== "public_pusher" || result.accepted !== accepted
      || (accepted ? !uuid.test(result.collector_run_id ?? "") : result.collector_run_id !== null)
      || (dryRun && (!Array.isArray(result.targets) || result.targets.length !== count)))
      throw new Error("bat_live_handoff_invalid_response");
    if (dryRun && result.targets.some((t: any) => !uuid.test(t?.id ?? "") || !uuid.test(t?.vehicle_id ?? "")
      || !Number.isSafeInteger(t?.post_id) || t.post_id <= 0 || !Number.isSafeInteger(t?.last_comment_id)
      || t.last_comment_id < 0 || batUrl(t?.source_url) !== t.source_url))
      throw new Error("bat_live_handoff_invalid_targets");
    console.info(JSON.stringify({ event: "bat_live_handoff_v1", at: new Date().toISOString(),
      request_at: context.requestAt, auth_ms: context.authMs, elapsed_ms: performance.now() - started,
      outcome: accepted ? "accepted" : dryRun ? "dry_run" : "idle", selected_lots: count,
      collector_run_id: result.collector_run_id }));
    return { success: true, mode: "live_stream", dry_run: dryRun, accepted,
      collector_run_id: result.collector_run_id, selected_lots: count, collector_duration_seconds: 115,
      model_calls: 0, transport: "public_pusher", targets: dryRun ? result.targets : undefined };
  } catch (error) {
    console.error(JSON.stringify({ event: "bat_live_handoff_v1", at: new Date().toISOString(),
      request_at: context.requestAt, elapsed_ms: performance.now() - started, outcome: "unconfirmed" }));
    throw new Error(error instanceof Error && error.message.startsWith("bat_live_handoff_")
      ? error.message : "bat_live_handoff_acceptance_unknown");
  }
}
