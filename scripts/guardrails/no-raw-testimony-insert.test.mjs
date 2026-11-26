// node --test scripts/guardrails/no-raw-testimony-insert.test.mjs
// Changes mode of no-raw-testimony-insert.mjs: a migration may write testimony only inside a sanctioned writer.
// Fixtures are SQL strings here, never files under supabase/migrations/ (those would deploy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testimonyWritesInMigration, splitStatements, SANCTIONED_WRITERS, CHANGE_TESTIMONY_TABLES } from './no-raw-testimony-insert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hits = (sql) => testimonyWritesInMigration(sql).map((h) => `${h.verb} ${h.table} in ${h.where}`);

// The shape of #3707 (closed 2026-11-22): a new SECURITY DEFINER fold that supersedes and then inserts observations
// itself. The whole-repo scan blanked the function body and passed it.
const FOLD_3707 = `
CREATE OR REPLACE FUNCTION public.fold_byok_component_observations(p_vehicle_id uuid, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_obs_id uuid; prop_id uuid;
BEGIN
  SELECT id INTO prop_id FROM observation_properties WHERE property_key = 'byok_component';
  IF NOT p_dry_run THEN
    UPDATE vehicle_observations vo
       SET is_superseded = true,
           superseded_by = new_obs_id,
           superseded_at = now()
     WHERE vo.vehicle_id = p_vehicle_id AND vo.property_id = prop_id;
    INSERT INTO vehicle_observations (id, vehicle_id, property_id, structured_data)
    VALUES (new_obs_id, p_vehicle_id, prop_id, '{}'::jsonb);
  END IF;
  RETURN '{}'::jsonb;
END;
$$;`;

test('a new function that inserts observations itself fails; its supersession update alone would pass', () => {
  assert.deepEqual(hits(FOLD_3707), ['INSERT vehicle_observations in function fold_byok_component_observations']);
});

test('top-level and DO-block DML on testimony fails, with the line of the write', () => {
  const sql = `SET lock_timeout = '5s';
UPDATE public.vehicle_images SET vehicle_id = '00000000-0000-0000-0000-000000000001' WHERE id = '00000000-0000-0000-0000-000000000002';
DO $$ BEGIN DELETE FROM auction_comments WHERE id IS NULL; END $$;
INSERT INTO evidence_links (id) VALUES (gen_random_uuid());
TRUNCATE vehicle_timeline;`;
  const found = testimonyWritesInMigration(sql);
  assert.deepEqual(found.map((h) => `${h.verb} ${h.table} in ${h.where} @${h.line}`), [
    'UPDATE vehicle_images in top @2', 'DELETE auction_comments in do @3', 'INSERT evidence_links in top @4', 'TRUNCATE vehicle_timeline in top @5']);
});

test('a patch of a function body is attributed to the patched function', () => {
  const sql = `DO $patch$
DECLARE d text; r1 text := $r1$
    INSERT INTO public.vehicle_events (vehicle_id, event_type) VALUES (p_vehicle_id, 'x');
$r1$;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  d := replace(d, 'a', r1);
  EXECUTE d;
END $patch$;`;
  assert.deepEqual(hits(sql), ['INSERT vehicle_events in patch of vehicle_labor_appraisal']);
  // the same patch of a sanctioned writer passes
  assert.deepEqual(hits(sql.replace('vehicle_labor_appraisal', 'record_vehicle_statement')), []);
});

test('sanctioned writers, supersession-only updates and non-DML mentions pass', () => {
  const sql = `
CREATE OR REPLACE FUNCTION public.record_vehicle_statement(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN INSERT INTO vehicle_observations (id) VALUES (gen_random_uuid()); RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION public.supersede_one(p uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE vehicle_observations SET is_superseded = true, superseded_by = p, superseded_at = now() WHERE id = p $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_images TO service_role;
CREATE TRIGGER t BEFORE INSERT OR UPDATE OF vehicle_id ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION f();
CREATE TABLE x (image_id uuid REFERENCES public.vehicle_images(id) ON DELETE CASCADE);
CREATE OR REPLACE FUNCTION public.reader(p uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM vehicle_images WHERE vehicle_id = p FOR UPDATE OF vehicle_images $$;
-- INSERT INTO vehicle_observations in a comment is not a write
INSERT INTO public.vehicle_images_review_queue (id) VALUES (gen_random_uuid());
INSERT INTO receipt_items (id) SELECT id FROM receipts ON CONFLICT (id) DO UPDATE SET id = excluded.id;`;
  assert.deepEqual(hits(sql), []);
});

test('declared account-work intake is sanctioned but stock and build callers cannot insert testimony themselves', () => {
  const write = name => `CREATE FUNCTION public.${name}() RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.vehicle_observations(id) VALUES(gen_random_uuid()); END $$;`;
  assert.deepEqual(hits(write('record_account_work')), []);
  for (const caller of ['parts_stock_sign', 'record_parts_arrival', 'record_harness_build_operation', 'record_account_work_copy'])
    assert.equal(hits(write(caller)).length, 1, `${caller} must delegate to canonical admission`);
});

test('an exception counts only when it names the writer and gives a reason', () => {
  const body = `CREATE FUNCTION public.backfill_x() RETURNS void LANGUAGE sql AS $$ INSERT INTO vehicle_events (id) VALUES (gen_random_uuid()) $$;`;
  assert.equal(hits(body).length, 1);
  assert.equal(hits(`-- guardrail-allow(testimony-write): backfill_x: ok\n${body}`).length, 1, 'a reason under 12 characters does not count');
  assert.equal(hits(`-- guardrail-allow(testimony-write): other_fn: restores rows lost in the 05-01 incident\n${body}`).length, 1, 'it must name this writer');
  assert.equal(hits(`-- guardrail-allow(testimony-write): backfill_x: restores rows lost in the 05-01 incident\n${body}`).length, 0);
});

test('statements split on real semicolons only', () => {
  const parts = splitStatements(`SELECT ';'; CREATE FUNCTION f() RETURNS int AS $x$ SELECT 1; SELECT 2 $x$ LANGUAGE sql; -- ; \n SELECT "a;b"`);
  assert.equal(parts.length, 3);
});

test('the sanctioned list is the one AGENTS.md and db-safety.md name, and the tables are db-safety.md\'s', () => {
  const rules = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8') + readFileSync(join(ROOT, '.claude/rules/db-safety.md'), 'utf8');
  for (const w of SANCTIONED_WRITERS) assert.ok(rules.includes(`\`${w}`), `${w} is named in AGENTS.md or db-safety.md`);
  const safety = readFileSync(join(ROOT, '.claude/rules/db-safety.md'), 'utf8');
  const section = safety.slice(safety.indexOf('## Testimony'), safety.indexOf('## Grants'));
  const named = new Set();
  // the two sentences that list the tables: "Testimony is the rows ...: `a`, `b`, ..." and "The image evidence store is testimony too: ..."
  for (const sentence of section.match(/(?:Testimony is the rows|The image evidence store is testimony too)[\s\S]*?\.(?:\s|$)/g) ?? []) {
    for (const [, t] of sentence.matchAll(/`([a-z_]+)`/g)) named.add(t);
  }
  assert.ok(named.size >= 18, `read ${named.size} tables from db-safety.md`);
  assert.deepEqual([...CHANGE_TESTIMONY_TABLES].sort(), [...named].sort());
});

test('replay: no migration added on 2026-11-24 writes testimony outside a sanctioned writer', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const today = readdirSync(dir).filter((f) => /^20261124\d{6}_.+\.sql$/.test(f));
  assert.ok(today.length >= 25, `found ${today.length} migrations of 2026-11-24`);
  const found = today.flatMap((f) => testimonyWritesInMigration(readFileSync(join(dir, f), 'utf8')).map((h) => `${f}: ${h.verb} ${h.table} in ${h.where}`));
  assert.deepEqual(found, []);
});
