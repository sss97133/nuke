// Contract: the yield-health loop query has a partial index to use, and the migration is safe to run in a txn.
//   node --test scripts/ci/yield-health-index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../supabase/migrations/20261111122500_vehicle_images_ai_completed_at_index.sql', import.meta.url), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('partial index matches the loop query predicate', () => {
  assert.match(code, /CREATE INDEX IF NOT EXISTS idx_vehicle_images_ai_completed_at/);
  assert.match(code, /ON public\.vehicle_images \(ai_processing_completed_at\)/);
  assert.match(code, /WHERE ai_processing_status = 'completed'/);
});

test('no CONCURRENTLY statement (migrations run in a transaction) and timeouts are set', () => {
  assert.doesNotMatch(code, /CONCURRENTLY/i);
  assert.match(code, /SET lock_timeout/);
  assert.match(code, /SET statement_timeout = '(?!0)/);
});

// Drift capture of the three yield functions (live bodies, 2026-11-07).
const fnSql = readFileSync(new URL('../../supabase/migrations/20261111130000_photo_analysis_yield_fn_capture.sql', import.meta.url), 'utf8');
const fnCode = fnSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('fn capture defines the three yield functions with intact dollar quoting', () => {
  for (const n of ['photo_analysis_yield_daily_refresh', 'photo_analysis_yield_snapshot_run', 'photo_analysis_yield_by_day']) {
    assert.match(fnCode, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${n}\\(`));
  }
  assert.equal((fnCode.match(/AS \$function\$/g) || []).length, 3);
  assert.equal((fnCode.match(/\$function\$;/g) || []).length, 3);
});

test('fn capture keeps the refresh loop bounded and sets timeouts without CONCURRENTLY/DISABLE', () => {
  assert.match(fnCode, /ai_processing_completed_at >= now\(\) - make_interval\(hours => p_hours\)/);
  assert.match(fnCode, /SET statement_timeout TO '280s'/);
  assert.match(fnCode, /s\.completed_at>=p_since and s\.completed_at<p_until/);
  assert.match(fnCode, /^SET lock_timeout/m);
  assert.match(fnCode, /^SET statement_timeout = '(?!0)/m);
  assert.doesNotMatch(fnCode, /CONCURRENTLY|DISABLE TRIGGER/i);
});
