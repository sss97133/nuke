import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { definerFunctions, grantsStated, scan } from './no-default-grant-definer.mjs';

function assay(files, cutoff = '20261014040000') {
  const root = mkdtempSync(join(tmpdir(), 'nuke-definer-guard-'));
  try {
    const dir = join(root, 'supabase/migrations');
    mkdirSync(dir, { recursive: true });
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
    return scan(dir, cutoff).map((v) => `${v.file.split('/').pop()}:${v.name}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const definer = (name, tail = '') =>
  `CREATE OR REPLACE FUNCTION public.${name}(p uuid) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT 1 $$;\n${tail}`;

test('a definer function with no stated grants is a violation', () => {
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('leaky') }), ['20261015000000_a.sql:public.leaky']);
});
test('revoking from PUBLIC and granting to anon leaves authenticated unstated', () => {
  const tail = 'REVOKE ALL ON FUNCTION public.leaky(uuid) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public.leaky(uuid) TO anon;\n';
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('leaky', tail) }), ['20261015000000_a.sql:public.leaky']);
});
test('revoking from PUBLIC and granting to anon and authenticated states all three', () => {
  const tail = 'REVOKE ALL ON FUNCTION public.leaky(uuid) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public.leaky(uuid) TO anon, authenticated, service_role;\n';
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('leaky', tail) }), []);
});
test('replacing an existing definer and revoking from PUBLIC alone keeps explicit anon grants: a violation', () => {
  const tail = 'REVOKE EXECUTE ON FUNCTION public.get_county_detail(text) FROM PUBLIC;\n';
  const sql = "CREATE OR REPLACE FUNCTION public.get_county_detail(p_fips text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $function$ BEGIN RETURN NULL; END $function$;\n" + tail;
  assert.deepEqual(assay({ '20261015000000_a.sql': sql }), ['20261015000000_a.sql:public.get_county_detail']);
});
test('REVOKE EXECUTE from PUBLIC, anon, authenticated counts too', () => {
  const tail = 'REVOKE EXECUTE ON FUNCTION leaky(uuid) FROM PUBLIC, anon, authenticated;\n';
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('leaky', tail) }), []);
});
test('revoking from anon only does not state the default PUBLIC grant', () => {
  const tail = 'REVOKE EXECUTE ON FUNCTION public.leaky(uuid) FROM anon;\n';
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('leaky', tail) }), ['20261015000000_a.sql:public.leaky']);
});
test('the reviewed marker with a reason is accepted', () => {
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('open_form', '-- definer-grants: default reviewed open_form: a public form, checks its own code\n') }), []);
});
test('the reviewed marker without a reason is not', () => {
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('open_form', '-- definer-grants: default reviewed open_form\n') }), ['20261015000000_a.sql:public.open_form']);
});
test('ALTER FUNCTION ... SECURITY DEFINER needs stated grants too', () => {
  const sql = 'ALTER FUNCTION public.trigger_fn() SECURITY DEFINER;\nALTER FUNCTION public.trigger_fn() SET search_path = public;\n';
  assert.deepEqual(assay({ '20261015000000_a.sql': sql }), ['20261015000000_a.sql:public.trigger_fn']);
  const ok = sql + 'REVOKE EXECUTE ON FUNCTION public.trigger_fn() FROM PUBLIC, anon, authenticated;\n';
  assert.deepEqual(assay({ '20261015000000_b.sql': ok }), []);
});
test('a scanner error exits 2, never clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'nuke-definer-guard-err-'));
  try {
    mkdirSync(join(root, 'supabase'), { recursive: true });
    writeFileSync(join(root, 'supabase/migrations'), 'not a directory');
    const r = spawnSync('node', [new URL('./no-default-grant-definer.mjs', import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, GUARDRAIL_REPO_ROOT: root } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('an invoker function is not a definer', () => {
  assert.deepEqual(assay({ '20261015000000_a.sql': 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;' }), []);
});
test('"security definer" inside a body or a comment is not an attribute', () => {
  const sql = "-- this is not SECURITY DEFINER\nCREATE FUNCTION public.f() RETURNS text LANGUAGE sql AS $fn$ SELECT 'security definer' $fn$;";
  assert.deepEqual(definerFunctions(sql), []);
});
test('attributes after the body are read', () => {
  const sql = 'CREATE FUNCTION g() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql SECURITY DEFINER;';
  assert.deepEqual(definerFunctions(sql), ['public.g']);
});
test('files before the cutoff are the past, not the floor', () => {
  assert.deepEqual(assay({ '20261013000000_old.sql': definer('legacy') }), []);
});
test('another function revoked does not cover this one', () => {
  const tail = 'REVOKE ALL ON FUNCTION public.leaky_two(uuid) FROM PUBLIC;\n';
  assert.equal(grantsStated(definer('leaky', tail), 'public.leaky'), false);
});
