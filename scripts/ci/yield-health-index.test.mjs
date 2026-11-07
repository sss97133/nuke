// Contract: the yield-health loop query has a partial index to use, and the migration is safe to run in a txn.
//   node --test scripts/ci/yield-health-index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../supabase/migrations/20261111120000_vehicle_images_ai_completed_at_index.sql', import.meta.url), 'utf8');
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
