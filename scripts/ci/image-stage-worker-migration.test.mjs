// Static contract for 20261112100000_image_stage_worker_cron.sql and the orchestrator wiring. No database here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sql = read("../../supabase/migrations/20261112100000_image_stage_worker_cron.sql");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const index = read("../../supabase/functions/photo-pipeline-orchestrator/index.ts");

test("worker tick is gated by the reconciler flag (default false) and skips when nothing is queued", () => {
  assert.match(code, /config_key = 'image_stage_reconciler'/);
  assert.match(code, /coalesce\(\(v_cfg ->> 'enabled'\)::boolean, false\) is not true/);
  assert.match(code, /skipped', 'queue_empty'/);
  assert.doesNotMatch(code, /insert into public\.platform_config/i);   // flag is owned by 20261112090000
});

test("tick is bounded, service-role-only, cadence not faster than 5 minutes", () => {
  assert.match(code, /least\(greatest\(p_limit, 1\), 8\)/);
  assert.match(code, /revoke all on function public\.image_stage_worker_tick\(text, integer\) from public, anon, authenticated/);
  assert.match(code, /grant execute on function public\.image_stage_worker_tick\(text, integer\) to service_role/);
  assert.match(code, /cron\.schedule\('image-stage-worker-classifier', '2-59\/5 \* \* \* \*'/);
  assert.match(sql, /set local lock_timeout/);
});

test("migration writes no testimony and no receipts", () => {
  assert.doesNotMatch(code, /(insert into|update|delete from)\s+public\.(vehicle_images|image_stage_receipts)/i);
});

test("orchestrator records a receipt at every classifier outcome and exposes run_stage", () => {
  assert.match(index, /action === "run_stage"/);
  for (const o of ["policy_skip", "rate_limited", "failed", "succeeded"]) assert.match(index, new RegExp(`classifierReceipt\\([^)]*"${o}"`));
  assert.match(index, /unavailableReceipts\(image_id, routeResult\.stage_unavailable\)/);
  assert.equal((index.match(/classifierReceipt\([^)]*"policy_skip"/g) ?? []).length, 4);   // junk x2, cross-sweep, apple-ml
});
