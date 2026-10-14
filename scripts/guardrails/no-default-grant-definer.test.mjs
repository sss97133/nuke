import assert from 'node:assert/strict';
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
test('REVOKE ... FROM PUBLIC in the same file states the grants', () => {
  const tail = 'REVOKE ALL ON FUNCTION public.leaky(uuid) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public.leaky(uuid) TO anon;\n';
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('leaky', tail) }), []);
});
test('REVOKE EXECUTE from PUBLIC, anon, authenticated counts too', () => {
  const tail = 'REVOKE EXECUTE ON FUNCTION leaky(uuid) FROM PUBLIC, anon, authenticated;\n';
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('leaky', tail) }), []);
});
test('revoking from anon only does not state the default PUBLIC grant', () => {
  const tail = 'REVOKE EXECUTE ON FUNCTION public.leaky(uuid) FROM anon;\n';
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('leaky', tail) }), ['20261015000000_a.sql:public.leaky']);
});
test('the reviewed marker on its own line is accepted', () => {
  assert.deepEqual(assay({ '20261015000000_a.sql': definer('open_form', '-- definer-grants: default reviewed open_form\n') }), []);
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
