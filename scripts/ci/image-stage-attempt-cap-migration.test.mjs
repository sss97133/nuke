// Static contract for 20261112110000_image_stage_attempt_cap.sql and the post-classifier attribution wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sql = read("../../supabase/migrations/20261112110000_image_stage_attempt_cap.sql");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const index = read("../../supabase/functions/photo-pipeline-orchestrator/index.ts");

test("counter lives on the work item and is bumped at claim, independent of receipts", () => {
  assert.match(code, /add column if not exists attempts integer not null default 0/);
  assert.match(code, /set status = 'claimed', attempts = w\.attempts \+ 1/);
  assert.doesNotMatch(code, /image_stage_receipts/);
});

test("exhausted items go dead with a typed reason, at claim and at lease expiry", () => {
  assert.match(code, /w\.attempts >= s\.max_attempts/);
  assert.equal((code.match(/max_attempts_exceeded/g) ?? []).length >= 4, true);
  assert.match(code, /status in \('queued', 'claimed', 'done', 'dropped', 'dead'\)/);
  assert.match(code, /\(status = 'dead'\) = \(dead_reason is not null\)/);
});

test("reconciler skips dead items until required_version moves; insert cannot revive one", () => {
  assert.match(code, /d\.status = 'dead' and d\.target_version >= s\.required_version/);
  assert.match(code, /create trigger image_stage_work_no_revive before insert/);
  assert.match(code, /d\.target_version >= new\.target_version/);
});

test("filing and evidence stages registered as not-required; no row writes to testimony", () => {
  assert.match(code, /'filing'[^)]*1, false/);
  assert.match(code, /'evidence'[^)]*1, false/);
  assert.doesNotMatch(code, /(insert into|update|delete from)\s+public\.(vehicle_images|image_stage_receipts)/i);
  assert.match(sql, /set local lock_timeout/);
});

test("orchestrator attributes post-classifier failures to filing/evidence, not the classifier", () => {
  assert.match(index, /afterClassifier = \{ phase: "filing"/);
  assert.match(index, /afterClassifier = \{ phase: "evidence"/);
  assert.match(index, /postClassifierFailureReceipts\(processingImageId, afterClassifier\.phase/);
  assert.match(index, /\} else await classifierReceipt\(processingImageId, "failed"/);
});
