// node --test scripts/doubts/fact-doubt-cycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickVehicles, main } from './fact-doubt-cycle.mjs';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const OWNER = id(999);

test('recent landings come first, then round-robin after the cursor, wrapping', () => {
  const all = [id(1), id(2), id(3), id(4)];
  assert.deepEqual(pickVehicles({ recent: [id(3)], all, cursor: null, n: 3 }), { vehicles: [id(3), id(1), id(2)], cursor: id(2) });
  assert.deepEqual(pickVehicles({ recent: [], all, cursor: id(3), n: 2 }), { vehicles: [id(4), id(1)], cursor: id(1) });
  assert.deepEqual(pickVehicles({ recent: [id(1), id(2)], all, cursor: null, n: 2 }).vehicles, [id(1), id(2)]);
  assert.deepEqual(pickVehicles({ recent: ['not-a-uuid'], all, cursor: null, n: 0 }).vehicles, []);
});

test('a fire raises for the picked vehicles, answers department-wide on the subscription, and keeps the cursor', async () => {
  const calls = { raise: [], answer: [] };
  const db = { req: async (path) => path.startsWith('vehicles?') ? [{ id: id(1) }, { id: id(2) }, { id: id(3) }]
    : path.startsWith('vehicle_images?') ? [{ vehicle_id: id(2) }, { vehicle_id: id(77) }] : [] };
  const raise = async (argv) => { calls.raise.push(argv); return { doubts: [{ action: 'inserted' }, { action: 'unchanged' }], retired: 1, skipped_no_frames: [], errors: [] }; };
  const answer = async (argv) => { calls.answer.push(argv); return { pending_for_vehicle: 4, answered: [{ outcome: 'value' }, { outcome: 'cannot_tell' }], failed: [] }; };
  const cursorFile = join(mkdtempSync(join(tmpdir(), 'fdc-')), 'cursor');
  const s = await main(['--owner', OWNER, '--vehicles', '2', '--answer-limit', '5'], {}, { db, raise, answer, cursorFile, land: async (argv) => { calls.land = argv; return { landed: 2, duplicate: 0, refused: 1, failed: 0, refusal_classes: { '400: Unsupported property_key for this intake': 1 } }; } });
  assert.deepEqual(calls.raise.map((a) => a[1]), [id(2), id(1)], 'owned recent vehicle first; an unowned landing is ignored');
  assert.deepEqual(calls.answer[0], ['--all-vehicles', '--limit', '5', '--provider', 'subscription']);
  assert.equal(s.raised, 2); assert.equal(s.existing, 2); assert.equal(s.retired, 2);
  assert.equal(s.answered, 2); assert.equal(s.answered_value, 1); assert.equal(s.errors, 0);
  assert.equal(readFileSync(cursorFile, 'utf8'), id(1));
  assert.ok(!JSON.stringify(s).includes('outcome'), 'summary carries counts, not answers');
  assert.deepEqual(calls.land, ['--limit', '50']); assert.equal(s.landed, 2); assert.equal(s.land_refused, 1);
  assert.equal(s.error_classes['land 400: Unsupported property_key for this intake'], 1);
});

test('a dry run passes --dry-run through and writes no cursor', async () => {
  const db = { req: async (path) => path.startsWith('vehicles?') ? [{ id: id(1) }] : [] };
  const seen = [];
  const raise = async (argv) => { seen.push(argv); return { doubts: [{ action: 'would_raise' }], retired: 0, skipped_no_frames: [], errors: [] }; };
  const answer = async (argv) => { seen.push(argv); return { answered: [{ would_ask: true }], failed: [] }; };
  const cursorFile = join(mkdtempSync(join(tmpdir(), 'fdc-')), 'cursor');
  const s = await main(['--owner', OWNER, '--dry-run'], {}, { db, raise, answer, cursorFile, land: async (argv) => { seen.push(argv); return { landed: 0, duplicate: 0, refused: 0, failed: 0 }; } });
  assert.ok(seen.every((a) => a.includes('--dry-run')));
  assert.equal(s.raised, 1);
  assert.throws(() => readFileSync(cursorFile, 'utf8'));
});

test('failed answers are counted by class without their values', async () => {
  const db = { req: async (path) => path.startsWith('vehicles?') ? [] : [] };
  const answer = async () => ({ answered: [], failed: [
    { id: 'a', key: 'k', error: "Cannot find package '@anthropic-ai/sdk' imported from /x/y.mjs" },
    { id: 'b', key: 'k', problems: ['value 1234 not allowed'] }] });
  const s = await main(['--owner', OWNER, '--vehicles', '0'], {}, { db, raise: async () => ({}), answer, land: async () => ({ landed: 0, duplicate: 0, refused: 0, failed: 0 }), cursorFile: join(mkdtempSync(join(tmpdir(), 'fdc-')), 'c') });
  assert.equal(s.failed, 2);
  assert.equal(s.error_classes.refused_locally, 1);
  assert.ok(Object.keys(s.error_classes).some((k) => k.startsWith("answer: Cannot find package")));
  assert.ok(!JSON.stringify(s).includes('1234'), 'a refused value stays out of the summary');
  assert.equal(s.errors, 0, 'answer failures do not make the fire an error (the heartbeat still lands)');
  assert.equal(s.frames, 2, 'doubts taken up');
  assert.equal(s.read, 0, 'none answered: the heartbeat starts a zero-read run');
});

test('a land step that cannot reach the writer is an error of the fire, by class', async () => {
  const db = { req: async () => [] };
  const s = await main(['--owner', OWNER, '--vehicles', '0', '--answer-limit', '0'], {}, { db, raise: async () => ({}), answer: async () => ({}),
    land: async () => ({ landed: 1, duplicate: 0, refused: 0, failed: 2 }), cursorFile: join(mkdtempSync(join(tmpdir(), 'fdc-')), 'c') });
  assert.equal(s.landed, 1); assert.equal(s.land_failed, 2); assert.equal(s.error_classes.land, 1); assert.equal(s.errors, 1);
});
