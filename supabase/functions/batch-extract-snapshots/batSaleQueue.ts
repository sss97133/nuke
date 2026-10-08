// Deterministic retained-capture lane. Only canonical ingest may admit testimony.
import { corsHeaders } from "../_shared/cors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSIENT = new Set(["parent_read_failed", "current_sale_read_failed", "snapshot_read_failed",
  "storage_body_unavailable", "archive_read_failed", "source_episode_read_failed"]);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

export async function drainBatSaleQueue(supabase: any, body: any): Promise<Response> {
  const allowed = new Set(["mode", "use_source_queue", "dry_run", "batch_size", "platform", "qualification_version"]);
  if (Object.keys(body).some(key => !allowed.has(key)) || body.dry_run !== false
    || (body.qualification_version !== undefined && body.qualification_version !== "v1")
    || body.vehicle_ids !== undefined || body.snapshot_id !== undefined
    || body.force || body.use_queue || (body.platform !== undefined && body.platform !== "bat")
    || (body.batch_size !== undefined && (!Number.isInteger(body.batch_size) || body.batch_size < 1 || body.batch_size > 20))) {
    return json({ success: false, error: "source_queue_requires_explicit_bounded_write", writes: 0, model_calls: 0 }, 400);
  }
  const worker = `bat-sale-${crypto.randomUUID()}`;
  const started = Date.now();
  const { data: items, error } = await supabase.rpc("claim_bat_sale_snapshots", {
    p_worker: worker, p_limit: body.batch_size ?? 20,
  }).abortSignal(AbortSignal.timeout(10000));
  if (error || !Array.isArray(items)) return json({ success: false, error: "source_queue_claim_failed" }, 503);
  let stored = 0, refused = 0, retries = 0, writes = 0, verifiedWrites = 0, completionFailures = 0;
  const results: Record<string, unknown>[] = [];
  for (const item of items) {
    let status = "retry", reason = "intake_request_failed", observationId: string | null = null, recordWrites = 0;
    const unstarted = Date.now() - started >= 40000;
    if (unstarted) reason = "batch_budget_deferred";
    else if (!UUID.test(item.id) || !UUID.test(item.source_snapshot_id) || !UUID.test(item.source_vehicle_id)) {
      reason = "source_queue_locator_invalid";
    } else {
      try {
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!key) throw new Error("credential_unavailable");
        const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ingest-observation`, {
          method: "POST", signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key,
            "x-nuke-internal": key },
          body: JSON.stringify({ mode: "source_sale_qualification", qualification_version: "v1", dry_run: false,
            vehicle_id: item.source_vehicle_id, snapshot_id: item.source_snapshot_id }),
        });
        const out = await response.json().catch(() => null);
        if (response.ok && out?.success === true && out.dry_run === false && out.model_calls === 0
          && (out.writes === 0 || out.writes === 1) && UUID.test(out.observation_id ?? "")
          && out.receipt?.method === "protected_archived_sale_observation_v1"
          && out.receipt.snapshot_id === item.source_snapshot_id && out.receipt.vehicle_id === item.source_vehicle_id) {
          status = "done"; reason = ""; observationId = out.observation_id; recordWrites = out.writes;
        } else if (response.status === 422 && typeof out?.reason === "string" && /^[a-z][a-z0-9_]{0,100}$/.test(out.reason)) {
          reason = out.reason; status = TRANSIENT.has(reason) ? "retry" : "skipped";
        } else reason = "intake_http_or_receipt_failed";
      } catch { reason = "intake_request_failed"; }
    }
    // CAS and typed result validation live in PostgreSQL. An HTTP200 is insufficient.
    writes += recordWrites;
    const { data: completed, error: completionError } = await supabase.rpc("finish_bat_sale_snapshot", {
      p_id: item.id, p_worker: worker, p_status: status, p_observation: observationId,
      p_reason: reason || null,
    }).abortSignal(AbortSignal.timeout(Math.max(1, Math.min(5000, 55000 - (Date.now() - started)))));
    if (completionError || completed !== true) {
      completionFailures++; results.push({ id: item.id, status: "completion_unverified" }); break;
    }
    if (status === "done") { stored++; verifiedWrites += recordWrites; }
    else if (status === "skipped") refused++;
    else retries++;
    results.push({ id: item.id, status, ...(reason ? { reason } : {}), ...(observationId ? { observation_id: observationId } : {}) });
  }
  return json({ success: completionFailures === 0, mode: "source_sale_qualification", use_source_queue: true,
    dry_run: false, claimed: items.length, stored, refused, retries, completion_failures: completionFailures,
    writes_reported: writes, writes: verifiedWrites, model_calls: 0, duration_ms: Date.now() - started, results }, completionFailures ? 503 : 200);
}
