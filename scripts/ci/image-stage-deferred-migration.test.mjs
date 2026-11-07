// Static contract for 20261112120000_image_stage_deferred_and_availability.sql (the behavioural contract is
// supabase/sql/test_image_stage_attempt_cap.sql, run by CI db-contracts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sql = read("../../supabase/migrations/20261112120000_image_stage_deferred_and_availability.sql");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

test("deferred is a typed work status, not dead and not failed", () => {
  assert.match(code, /status in \('queued', 'claimed', 'done', 'dropped', 'dead', 'deferred'\)/);
  assert.match(code, /deferred_reason in \('provider_rate_limited'\)/);
  assert.match(code, /image_stage_cap_outcome/);
});

test("a spent rate-limit budget parks the image instead of making it terminal", () => {
  assert.match(code, /terminal = false, next_attempt_at = null, deferred_at = now\(\)/);
  assert.match(code, /'status','deferred'/);
});

test("recovery waits for the provider and is bounded", () => {
  assert.match(code, /blocked_until > now\(\)/);
  assert.match(code, /for update (of r )?skip locked/);
  assert.match(code, /r\.deferrals < v_maxdef/);
});

test("availability signal and retry do not depend on required", () => {
  assert.match(code, /add column if not exists available boolean/);
  assert.match(code, /s\.available is true/);
  const fn = code.slice(code.indexOf("function public.enqueue_available_stage_retries"), code.indexOf("function public.reconcile_image_pipeline"));
  assert.doesNotMatch(fn, /s\.required\b/);
});

test("new functions are service_role only", () => {
  assert.match(code, /revoke all on function public\.set_image_stage_availability/);
  assert.match(code, /to service_role;/);
});
