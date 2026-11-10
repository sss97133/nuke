// Static contract for 20261113110000_image_stage_receipts_reconciler.sql. No database here: this pins the
// properties the review depends on (closed outcomes, idempotency index, disabled-by-default, service-role-only,
// no writes to testimony or ai_processing_status). A live replay on a disposable PG remains the real proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql", import.meta.url), "utf8");
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
  assert.match(code, /"enabled": false, "user_ids": \[\]/);   // off, and nobody named: switching on means naming the reader's user
  assert.match(code, /least\(greatest\(p_limit, 0\)[^;]*, 500\)/);
  assert.match(code, /backfill_share/);
  assert.match(code, /order by c\.created_at asc, c\.id asc limit v_scan/);   // oldest-first backfill, keyset tie-break
  assert.match(code, /\(c\.created_at, c\.id\) > \(st\.cursor_created_at, st\.cursor_id\)/);
  // candidates come from the user-owned partial index (id, created_at only); eligibility is judged by primary key
  assert.match(code, /where v\.id = any \(v_cand\)/);
  assert.match(code, /v\.id = any \(v_cand\) order by v\.created_at desc, v\.id desc limit 1/);   // cursor follows candidates
  assert.match(code, /pg_try_advisory_xact_lock/);
});

test("reads #3024 stage_unavailable; independent of the paid drain's breaker and retry table; redefines neither", () => {
  assert.match(code, /stage_unavailable/);
  // a reader on the owner's subscription must keep working while the paid provider is refused
  assert.doesNotMatch(code, /photo_pipeline_provider_state/);
  assert.doesNotMatch(code, /photo_pipeline_retry_state/);
  assert.doesNotMatch(code, /create (or replace )?(table|function) (if not exists )?public\.(photo_pipeline_|claim_photo_pipeline)/i);
});

test("one transaction, short lock wait, foreign keys to vehicle_images added last", () => {
  const body = code.trim();
  assert.match(body, /^begin;/);
  assert.match(body, /commit;$/);
  assert.match(code, /set local lock_timeout = '2s'/);
  assert.doesNotMatch(code, /statement_timeout\s*=\s*'?0/);
  assert.doesNotMatch(code, /create table[^;]*references public\.vehicle_images/i);   // not inline: added in the last block
  const fk = code.indexOf("foreign key (image_id) references public.vehicle_images(id)");
  assert.ok(fk > code.indexOf("cron.schedule('image-stage-reconciler'"), "the vehicle_images lock is taken after everything else");
});

test("privacy is judged at enqueue and again at claim; scope by user", () => {
  const eligible = "v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'";
  assert.ok(code.split(eligible).length - 1 >= 3, "the same predicate in the reconciler, the claim and the claim's drop");
  assert.match(code, /set status = 'dropped'/);
  assert.match(code, /v_cfg -> 'user_ids'/);
  assert.match(code, /p_user_id is null or v\.user_id = p_user_id/);
});

test("service role only; anon/authenticated revoked on every object", () => {
  assert.match(code, /revoke all on public\.image_pipeline_stages, public\.image_stage_receipts, public\.image_stage_work, public\.image_stage_reconciler_state from public, anon, authenticated, service_role/);
  assert.match(code, /grant select on public\.image_pipeline_stages, public\.image_stage_receipts, public\.image_stage_work, public\.image_stage_reconciler_state[^;]* to service_role/);
  assert.doesNotMatch(code, /grant (all|insert|update|delete)[^;]* on (table )?public\.image_/i);
  for (const fn of ["record_image_stage_receipt", "image_stage_gaps", "reconcile_image_stages", "claim_image_stage_work", "release_expired_image_stage_work"]) {
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\(`));
  }
  assert.match(code, /create or replace view public\.image_stage_current with \(security_invoker = true\)/);
});

test("cron is defined in the migration and is inert until enabled", () => {
  assert.match(code, /cron\.schedule\('image-stage-reconciler', '8-59\/10 \* \* \* \*'/);   // off the :00/:10 slots the drains use
  assert.match(code, /cron\.unschedule\(j\)/);   // a replay leaves one job
  assert.match(code, /set statement_timeout = '30s'; select public\.release_expired_image_stage_work\(\); select public\.reconcile_image_stages\(100\)/);
});

test("legacy classifier evidence accepts the live shapes and requires pipeline_version, image_type and numeric confidence", () => {
  assert.match(code, /create or replace function public\.image_stage_legacy_version/);
  assert.match(code, /jsonb_typeof\(p_meta #> '\{classification,image_type\}'\) = 'string'/);
  assert.match(code, /jsonb_typeof\(p_meta #> '\{classification,confidence\}'\) = 'number'/);
  assert.match(code, /jsonb_typeof\(p_meta -> 'pipeline_version'\) = 'string'/);
  assert.match(code, /'legacy-' \|\| btrim\(p_meta ->> 'pipeline_version'\)/);
  assert.match(code, /revoke all on function public\.image_stage_legacy_version\(text, jsonb\)/);
});
