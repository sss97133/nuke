import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findExposures, unallowed } from './no-pii-exposure.mjs';

const pii = { people: ['email', 'phone'], shops: ['phone'] };
const tables = (sql) => findExposures(sql, pii).map((h) => `${h.table}:${h.audience}:${h.columns.join(',')}`);

test('a select grant to an API role on a table with personal columns is an exposure', () => {
  assert.deepEqual(tables('GRANT SELECT ON public.people TO anon, authenticated;'),
    ['people:anon:email,phone', 'people:authenticated:email,phone']);
  assert.deepEqual(tables('GRANT ALL ON TABLE people TO PUBLIC;'), ['people:anon:email,phone', 'people:authenticated:email,phone']);
});

test('a column grant counts only the personal columns it names; other grants do not count', () => {
  assert.deepEqual(tables('GRANT SELECT (id, created_at) ON people TO anon;'), []);
  assert.deepEqual(tables('GRANT SELECT (id, email) ON people TO anon;'), ['people:anon:email']);
  assert.deepEqual(tables('GRANT INSERT ON people TO authenticated; GRANT SELECT ON people TO service_role;'), []);
  assert.deepEqual(tables('GRANT EXECUTE ON FUNCTION public.f(uuid) TO anon;'), []);
});

test('a permissive select policy that is true opens the table; restrictive, write-only and conditional ones do not', () => {
  assert.deepEqual(tables('CREATE POLICY p ON people FOR SELECT USING (true);'), ['people:anon:email,phone', 'people:authenticated:email,phone']);
  assert.deepEqual(tables('CREATE POLICY "Anyone" ON public.people FOR SELECT TO authenticated USING ((true));'), ['people:authenticated:email,phone']);
  assert.deepEqual(tables('CREATE POLICY p ON people USING (true) WITH CHECK (false);'), ['people:anon:email,phone', 'people:authenticated:email,phone']);
  assert.deepEqual(tables('ALTER POLICY p ON people USING (true);'), ['people:anon:email,phone', 'people:authenticated:email,phone']);
  assert.deepEqual(tables('CREATE POLICY p ON people AS RESTRICTIVE FOR SELECT USING (true);'), []);
  assert.deepEqual(tables('CREATE POLICY p ON people FOR INSERT WITH CHECK (true);'), []);
  assert.deepEqual(tables('CREATE POLICY p ON people FOR SELECT USING (user_id = auth.uid());'), []);
  assert.deepEqual(tables('CREATE POLICY p ON people FOR SELECT TO service_role USING (true);'), []);
});

test('disabling row level security and owner-run views are exposures; invoker views are not', () => {
  assert.deepEqual(tables('ALTER TABLE people DISABLE ROW LEVEL SECURITY;'), ['people:anon:email,phone', 'people:authenticated:email,phone']);
  assert.deepEqual(tables('CREATE OR REPLACE VIEW public.v AS SELECT p.email, p.id FROM people p;'), ['v:anon:email', 'v:authenticated:email']);
  assert.deepEqual(tables('CREATE VIEW v WITH (security_invoker = true) AS SELECT email FROM people;'), []);
  assert.deepEqual(tables('CREATE MATERIALIZED VIEW mv WITH (security_invoker = true) AS SELECT phone FROM shops;'), ['mv:anon:phone', 'mv:authenticated:phone']);
  assert.deepEqual(tables('ALTER VIEW people SET (security_invoker = false);'), ['people:anon:email,phone', 'people:authenticated:email,phone']);
  assert.deepEqual(tables('ALTER VIEW people SET (security_invoker = true);'), []);
});

test('columns added in the same migration count; comments, strings and function bodies do not', () => {
  assert.deepEqual(tables('CREATE TABLE public.leads (id uuid PRIMARY KEY, contact_email text, notes text);\nCREATE POLICY open ON public.leads FOR SELECT USING (true);'),
    ['leads:anon:contact_email', 'leads:authenticated:contact_email']);
  assert.deepEqual(tables('ALTER TABLE shops ADD COLUMN owner_name text; GRANT SELECT ON shops TO anon;'), ['shops:anon:owner_name,phone']);
  assert.deepEqual(tables("-- GRANT SELECT ON people TO anon;\nSELECT 'GRANT SELECT ON people TO anon;';"), []);
  assert.deepEqual(tables('CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ GRANT SELECT ON people TO anon; $$;'), []);
});

test('the allowlist covers named columns for named audiences only', () => {
  const hits = findExposures('GRANT SELECT ON people TO anon, authenticated;', pii);
  const allow = [{ table: 'people', columns: ['phone'], audience: ['anon'] }];
  assert.deepEqual(unallowed(hits, allow).map((h) => `${h.audience}:${h.columns.join(',')}`), ['anon:email', 'authenticated:email,phone']);
  assert.deepEqual(unallowed(hits, [{ table: 'people', columns: ['email', 'phone'] }]), []);
});

test('the SEC3 migration closes paths and opens none', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261020163000_pii_reads_admin_or_own.sql', import.meta.url), 'utf8');
  assert.deepEqual(findExposures(sql, { agent_messages: ['from_email', 'to_email'], device_attributions: ['latitude'] }), []);
});

test('free-form columns with personal content count as personal in static mode', async () => {
  const { freeformColumns } = await import('./no-pii-exposure.mjs');
  const listed = freeformColumns({ columns: [{ table: 'generated_invoices', columns: ['html_content', 'payment_token'] }] });
  assert.deepEqual(findExposures('GRANT SELECT ON generated_invoices TO authenticated;', listed).map((h) => h.columns.join(',')),
    ['html_content,payment_token']);
});

test('the content probe samples as anon, counts only, and rolls back', async () => {
  const { contentProbeSql } = await import('./no-pii-exposure.mjs');
  const sql = contentProbeSql([{ t: 'vehicles', k: 'r', est: 1300000, cols: ['description'] }, { t: 'v', k: 'v', est: 0, cols: ['notes'] }]);
  assert.match(sql, /SET LOCAL ROLE anon;/);
  assert.match(sql, /TABLESAMPLE SYSTEM \(0\.231\)/);
  assert.match(sql, /count\(v\) FILTER \(WHERE v ~ /);
  assert.doesNotMatch(sql, /SELECT v FROM|string_agg|array_agg/);
  assert.match(sql, /ROLLBACK;$/);
});
