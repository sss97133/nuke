// Static contract for 20261112090000_image_stage_receipts_reconciler.sql. No database here: this pins the
// properties the review depends on (closed outcomes, idempotency index, disabled-by-default, service-role-only,
// no writes to testimony or ai_processing_status). A live replay on a disposable PG remains the real proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../supabase/migrations/20261112090000_image_stage_receipts_reconciler.sql", import.meta.url), "utf8");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

test("outcome vocabulary is closed and covers the retryable cases", () => {
  for (const o of ["succeeded", "policy_skip", "blocked_input", "unavailable", "rate_limited", "failed"]) assert.match(code, new RegExp(`'${o}'`));
  assert.match(code, /stage_receipt_retry_only_retryable/);
  assert.match(code, /stage_receipt_reason_required/);
});

test("receipts are append-only: no UPDATE/DELETE of image_stage_receipts, one row per attempt", () => {
  assert.doesNotMatch(code, /update\s+public\.image_stage_receipts/i);
  assert.doesNotMatch(code, /delete\s+from\s+public\.image_stage_receipts/i);
  assert.match(code, /unique \(image_id, stage, producer_version, attempt\)/);
});

test("queue is idempotent: one open item per (image, stage) and the insert uses it", () => {
  assert.match(code, /unique index if not exists image_stage_work_one_open on public\.image_stage_work \(image_id, stage\) where status in \('queued', 'claimed'\)/);
  assert.match(code, /on conflict \(image_id, stage\) where status in \('queued', 'claimed'\) do nothing/);
});

test("reconciler never mutates vehicle_images or calls a provider", () => {
  assert.doesNotMatch(code, /update\s+public\.vehicle_images/i);
  assert.doesNotMatch(code, /ai_processing_status\s*=/i);
  assert.doesNotMatch(code, /net\.http_/i);
});

test("disabled by default, bounded, rate-limited, fair", () => {
  assert.match(code, /"enabled": false/);
  assert.match(code, /least\(greatest\(p_limit, 0\)[^;]*, 500\)/);
  assert.match(code, /backfill_share/);
  assert.match(code, /order by v\.created_at asc, v\.id asc limit v_scan/);   // oldest-first backfill, keyset tie-break
  assert.match(code, /\(v\.created_at, v\.id\) > \(st\.cursor_created_at, st\.cursor_id\)/);
  assert.match(code, /pg_try_advisory_xact_lock/);
});

test("compatible with #3024 and #3025 state, without redefining it", () => {
  assert.match(code, /stage_unavailable/);
  assert.match(code, /photo_pipeline_provider_state/);
  assert.match(code, /photo_pipeline_retry_state/);
  assert.doesNotMatch(code, /create (or replace )?(table|function) (if not exists )?public\.(photo_pipeline_|claim_photo_pipeline)/i);
});

test("service role only; anon/authenticated revoked on every object", () => {
  assert.match(code, /revoke all on public\.image_pipeline_stages, public\.image_stage_receipts, public\.image_stage_work, public\.image_stage_reconciler_state from public, anon, authenticated/);
  for (const fn of ["record_image_stage_receipt", "image_stage_gaps", "reconcile_image_stages", "claim_image_stage_work", "release_expired_image_stage_work"]) {
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\(`));
  }
  assert.match(code, /create or replace view public\.image_stage_current with \(security_invoker = true\)/);
});

test("cron is defined in the migration and is inert until enabled", () => {
  assert.match(code, /cron\.schedule\('image-stage-reconciler'/);
  assert.match(code, /reconcile_image_stages\(100\)/);
});

test("legacy classifier evidence accepts the live shapes and requires pipeline_version, image_type and numeric confidence", () => {
  assert.match(code, /create or replace function public\.image_stage_legacy_version/);
  assert.match(code, /jsonb_typeof\(p_meta #> '\{classification,image_type\}'\) = 'string'/);
  assert.match(code, /jsonb_typeof\(p_meta #> '\{classification,confidence\}'\) = 'number'/);
  assert.match(code, /jsonb_typeof\(p_meta -> 'pipeline_version'\) = 'string'/);
  assert.match(code, /'legacy-' \|\| btrim\(p_meta ->> 'pipeline_version'\)/);
  assert.match(code, /revoke all on function public\.image_stage_legacy_version\(text, jsonb\)/);
});
