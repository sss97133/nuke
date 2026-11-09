// node --test scripts/garage/derivation-evidence.test.mjs   (mappers, sink and importer; no network, no database)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, createSink, evidenceRow, fromDuplicateJudgment, fromPlaceExemplar, fromPlaceMatch, fromRelationshipRole, fromSceneLabel, fromSellerHistory, fromSignRead, insertRows, KINDS } from './derivation-evidence.mjs';
import { classify, fileRunId, mapFile, uuidFrom } from './import-derivation-evidence.mjs';

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx = { version: 'abc123:test' };
const scene = { run_id: U(1), vehicle_id: U(2), session_key: U(3), image_ids: [U(3), U(4)], scene_label: 'shop_interior', model: 'claude-cli:default', confidence: 0.9, rationale: 'lift', photo_count: 2, producer: 'scripts/garage/label-scenes.mjs', created_at: '2026-11-08T03:02:56.377Z' };

test('canonical sorts keys; scene label maps to a signed row', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  const r = fromSceneLabel(scene, ctx);
  assert.equal(r.kind, 'scene_label'); assert.equal(r.conclusion, 'shop_interior'); assert.equal(r.producer_agent, 'injestion');
  assert.equal(r.producer_version, 'abc123:test'); assert.equal(r.producer_script, 'scripts/garage/label-scenes.mjs');
  assert.equal(r.run_id, U(1)); assert.equal(r.viewer, 1); assert.deepEqual(r.image_ids, [U(3), U(4)]);
  assert.match(r.dedupe_key, /^[0-9a-f]{64}$/); assert.match(r.content_hash, /^[0-9a-f]{64}$/);
});

test('same conclusion -> same key; changed conclusion, viewer or run -> new key', () => {
  const a = fromSceneLabel(scene, ctx);
  assert.equal(fromSceneLabel({ ...scene }, ctx).dedupe_key, a.dedupe_key);
  assert.equal(fromSceneLabel(scene, { version: 'other' }).dedupe_key, a.dedupe_key); // the producing commit is not part of the identity
  assert.notEqual(fromSceneLabel({ ...scene, scene_label: 'showroom' }, ctx).dedupe_key, a.dedupe_key);
  assert.notEqual(fromSceneLabel({ ...scene, viewer: 2 }, ctx).dedupe_key, a.dedupe_key);
  assert.notEqual(fromSceneLabel({ ...scene, run_id: U(9) }, ctx).dedupe_key, a.dedupe_key);
});

test('place match: neither is a conclusion, an organization is a reference', () => {
  const base = { run_id: U(1), vehicle_id: U(2), session_key: 'k', image_ids: [], confidence: 0.88, model: 'm', viewer: 2, rationale: 'r', cues: ['c'], candidate_org_ids: [U(5)] };
  const n = fromPlaceMatch({ ...base, org_id: null }, ctx); const o = fromPlaceMatch({ ...base, org_id: U(5) }, ctx);
  assert.equal(n.conclusion, 'neither'); assert.equal(n.organization_id, null);
  assert.equal(o.conclusion, U(5)); assert.equal(o.organization_id, U(5)); assert.equal(o.viewer, 2); assert.deepEqual(o.evidence.cues, ['c']);
});

test('duplicate judgment keeps both sides, verdict, contradictions and fields', () => {
  const r = fromDuplicateJudgment({ run_id: U(1), a_id: U(2), b_id: U(3), same_vehicle: 'unsure', verdict: 'unsure', confidence: 0.6, rationale: 'x', contradictions: ['c'], model: 'm', fields: { a: { vin: 'V' } }, cite: { viewers: [] } }, ctx);
  assert.equal(r.vehicle_id, U(2)); assert.equal(r.other_vehicle_id, U(3)); assert.equal(r.conclusion, 'unsure'); assert.deepEqual(r.evidence.contradictions, ['c']); assert.deepEqual(r.evidence.cite, { viewers: [] });
});

test('sign read cites the place run it read; exemplar and seller history and role map', () => {
  const s = fromSignRead({ run_id: U(7), vehicle_id: U(2), session_key: 'k', org_id: U(5), quote: "'Viva' sign", source_run_id: U(1), source_viewer: 1, producer: 'scripts/garage/mine-sign-evidence.mjs' }, ctx);
  assert.equal(s.kind, 'sign_read'); assert.equal(s.source_run_id, U(1)); assert.equal(s.run_id, U(7)); assert.equal(s.organization_id, U(5));
  assert.throws(() => fromSignRead({ vehicle_id: U(2), org_id: U(5), source_run_id: U(1) }, ctx), /run_id/);
  const e = fromPlaceExemplar({ org_id: U(5), org_name: 'Shop', org_kind: 'shop' }, { url: 'https://x/y.jpg', source: 'scene_session', cite: { vehicle_id: U(2), session_key: 'k', confidence: 0.9, run_id: U(1), model: 'm' } }, { runId: U(8) }, ctx);
  assert.equal(e.subject_key, 'https://x/y.jpg'); assert.equal(e.conclusion, 'scene_session'); assert.equal(e.source_run_id, U(1)); assert.equal(e.organization_id, U(5));
  const h = fromSellerHistory({ url: 'https://bat/x/', handle: 'viva', vin: 'V', result: { status: 'sold', price: 1 } }, { runId: U(8) }, ctx);
  assert.equal(h.vehicle_id, null); assert.equal(h.conclusion, 'listing_unmatched'); // an unresolved match is retained, not guessed
  assert.equal(fromSellerHistory({ url: 'u' }, { runId: U(8), vehicleId: U(2), matchedBy: 'vin_equal' }, ctx).conclusion, 'vehicle_matched');
  const ro = fromRelationshipRole({ vehicle_id: U(2), derived_role: 'imported_by_user', confidence: '0.3', reason: 'why', evidence: { chain: [] } }, { runId: U(8), userId: U(6), mode: 'dry_run' }, ctx);
  assert.equal(ro.confidence, 0.3); assert.equal(ro.user_id, U(6)); assert.equal(ro.evidence.mode, 'dry_run');
});

test('evidenceRow rejects unknown kind and non-uuid run; bad confidence becomes null', () => {
  assert.throws(() => evidenceRow('nope', { run_id: U(1), script: 's', conclusion: 'c' }), /unknown kind/);
  assert.throws(() => evidenceRow('scene_label', { run_id: 'x', script: 's', conclusion: 'c' }), /run_id/);
  assert.equal(evidenceRow('scene_label', { run_id: U(1), script: 's', conclusion: 'c', confidence: 'abc' }).confidence, null);
  assert.equal(KINDS.length, 8);
});

test('imported_from is stored but not hashed', () => {
  const a = fromSceneLabel(scene, { ...ctx, importedFrom: { file: 'a.jsonl' } }); const b = fromSceneLabel(scene, { ...ctx, importedFrom: { file: 'b.jsonl' } });
  assert.equal(a.dedupe_key, b.dedupe_key); assert.equal(a.evidence.imported_from.file, 'a.jsonl');
});

test('insertRows: idempotent upsert request, error body returned without the key', async () => {
  const calls = [];
  const ok = await insertRows([fromSceneLabel(scene, ctx)], { url: 'https://p', key: 'SECRET', fetchFn: async (u, o) => { calls.push({ u, o }); return { ok: true }; } });
  assert.equal(ok.sent, 1);
  assert.equal(calls[0].u, 'https://p/rest/v1/garage_derivation_evidence?on_conflict=dedupe_key');
  assert.match(calls[0].o.headers.Prefer, /resolution=ignore-duplicates/);
  const bad = await insertRows([fromSceneLabel(scene, ctx)], { url: 'https://p', key: 'SECRET', fetchFn: async () => ({ ok: false, status: 400, text: async () => 'boom' }) });
  assert.equal(bad.ok, false); assert.ok(!bad.error.includes('SECRET'));
});

test('sink: off without a key or with --no-db; counts failures and never throws', async () => {
  const logs = [];
  const off = createSink({ script: 's', args: [], env: {}, log: (m) => logs.push(m) });
  assert.equal(off.enabled, false); assert.deepEqual(await off.write(fromSceneLabel(scene, ctx)), { ok: true, sent: 0 }); assert.equal(off.finish(), true);
  const noDb = createSink({ script: 's', args: ['--no-db'], env: { SUPABASE_SECRET_KEY: 'k' }, log: (m) => logs.push(m) });
  assert.equal(noDb.enabled, false);
  const calls = [];
  const on = createSink({ script: 's', args: [], env: { SUPABASE_SECRET_KEY: 'k', SUPABASE_URL: 'https://p' }, fetchFn: async (u) => { calls.push(u); return { ok: false, status: 500, text: async () => 'down' }; }, log: (m) => logs.push(m) });
  await on.write(fromSceneLabel(scene, on.ctx)); assert.equal(on.stats.failed, 1); assert.equal(on.finish(), false);
  const thrower = createSink({ script: 's', args: [], env: { SUPABASE_SERVICE_ROLE_KEY: 'k' }, fetchFn: async () => { throw new Error('net'); }, log: () => {} });
  assert.equal((await thrower.write(fromSceneLabel(scene, thrower.ctx))).ok, false);
  assert.ok(logs.every((l) => !l.includes('SECRET')));
});

test('importer: classification, deterministic run ids, per-file mapping and idempotence', () => {
  assert.equal(classify('scene_labels6.jsonl'), 'scene_label'); assert.equal(classify('place7d_3.jsonl'), 'place_match'); assert.equal(classify('place7_base.jsonl'), 'place_match');
  assert.equal(classify('place7_0.jsonl.r7a'), null); assert.equal(classify('place7_0.cte.sql'), null); assert.equal(classify('run_match7.sh'), null);
  assert.equal(classify('dupjudge7.jsonl'), 'duplicate_judgment'); assert.equal(classify('viva_history.jsonl'), 'seller_history_match');
  assert.equal(classify('place_exemplars_r7d.json'), 'place_exemplar'); assert.equal(classify('preview_out21.json'), 'relationship_role'); assert.equal(classify('sign.jsonl'), 'sign_read');
  assert.equal(uuidFrom('a'), uuidFrom('a')); assert.match(uuidFrom('a'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fileRunId('sign_read', '/x/sign.jsonl'), fileRunId('sign_read', '/y/sign.jsonl'));

  const text = [scene, { ...scene, session_key: 'k2' }].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const a = mapFile('scene_label', '/w/scene_labels6.jsonl', { text, mtime: 't' }); const b = mapFile('scene_label', '/w/other.jsonl', { text, mtime: 't2' });
  assert.equal(a.rows.length, 2); assert.deepEqual(a.rows.map((r) => r.dedupe_key), b.rows.map((r) => r.dedupe_key)); // same rows from another file are the same rows
  assert.equal(a.rows[0].producer_version, 'unversioned-import:scripts/garage/label-scenes.mjs'); assert.equal(a.rows[0].evidence.imported_from.file, 'scene_labels6.jsonl');
  const bad = mapFile('scene_label', '/w/x.jsonl', { text: JSON.stringify({ ...scene, run_id: 'nope' }) + '\n', mtime: 't' });
  assert.equal(bad.rows.length, 0); assert.equal(bad.skipped.length, 1);

  const ex = JSON.stringify([{ org_id: U(5), org_name: 'S', org_kind: 'shop', exemplars: [{ url: 'u1', source: 'bat_listing', cite: {} }, { url: 'u2', source: 'scene_session', cite: { vehicle_id: U(2) } }] }]);
  const e = mapFile('place_exemplar', '/w/place_exemplars_r7d.json', { text: ex, mtime: 't' });
  assert.equal(e.rows.length, 2); assert.equal(new Set(e.rows.map((r) => r.run_id)).size, 1);
  const h = mapFile('seller_history_match', '/w/viva_history.jsonl', { text: JSON.stringify({ url: 'https://bat/a/', handle: 'viva' }) + '\n' + JSON.stringify({ url: 'https://bat/b/' }) + '\n', mtime: 't', vinMatches: new Map([['https://bat/a/', { vehicle_id: U(2) }]]) });
  assert.deepEqual(h.rows.map((r) => r.conclusion), ['vehicle_matched', 'listing_unmatched']);
});

test('migration: append-only, service-role only, rollback by run supersedes and never deletes', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261111195000_garage_derivation_evidence.sql', import.meta.url), 'utf8');
  const later = readFileSync(new URL('../../supabase/migrations/20261111210500_receipt_work_reconciliation.sql', import.meta.url), 'utf8');
  for (const k of KINDS) assert.ok(sql.includes(`'${k}'`) || later.includes(`'${k}'`), k);
  assert.match(sql, /UNIQUE \(dedupe_key\)/); assert.match(sql, /derived_rows_append_only/); assert.match(sql, /REVOKE ALL ON public\.garage_derivation_evidence FROM anon, authenticated/);
  assert.match(sql, /rollback_garage_derivation_run/); assert.match(sql, /SET superseded_at = now\(\)/); assert.ok(!/DELETE FROM/i.test(sql)); assert.match(sql, /producer_agent text NOT NULL DEFAULT 'injestion'/);
  // the column list the mappers send must all exist in the table
  const cols = Object.keys(fromSceneLabel(scene, ctx));
  for (const c of cols) assert.ok(new RegExp(`\\n  ${c} `).test(sql), `column ${c} missing from migration`);
});
