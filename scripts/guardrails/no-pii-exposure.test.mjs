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

// --counts (WARN only, 2026-11-24): a public reader that counts data-set memberships with no grade split.
import { ungradedCounts } from './no-pii-exposure.mjs';

test('a public reader counting memberships with no grade is warned; graded, revoked or invoker readers are not', () => {
  const ungraded = `CREATE OR REPLACE FUNCTION public.set_sizes(p uuid) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT count(DISTINCT vehicle_id)::int FROM data_set_members WHERE set_id = p AND state = 'active' $$;`;
  assert.deepEqual(ungradedCounts(ungraded).map((h) => `${h.fn}:${h.anon}`), ['set_sizes:default PUBLIC execute']);
  assert.deepEqual(ungradedCounts(`${ungraded}\nREVOKE ALL ON FUNCTION public.set_sizes(uuid) FROM PUBLIC, anon, authenticated;`), []);
  assert.deepEqual(ungradedCounts(`${ungraded}\nREVOKE ALL ON FUNCTION public.set_sizes(uuid) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.set_sizes(uuid) TO anon;`)
    .map((h) => h.anon), ['granted']);
  assert.deepEqual(ungradedCounts(ungraded.replace("state = 'active'", "grade = 'established'")), []);
  assert.deepEqual(ungradedCounts(ungraded.replace('SECURITY DEFINER', '')), []);
  assert.deepEqual(ungradedCounts(`CREATE FUNCTION public.n() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM vehicles $$;`), []);
});

test('subject keys: a USING (true) read policy or disabled RLS on a table with a photo, user or document key is an exposure', async () => {
  const { SUBJECT_COLUMN, SUBJECT_TABLE } = await import('./no-pii-exposure.mjs');
  const keys = { image_descriptions: ['image_id'], user_presence: ['user_id'], paint_codes: [] };
  const k = (sql) => findExposures(sql, pii, keys).map((h) => `${h.table}:${h.audience}:${h.columns.join(',')}`);
  // the 2026-11-25 shapes: model descriptions of unfiled photos and a who-was-where log, readable logged out
  assert.deepEqual(k('CREATE POLICY image_descriptions_select ON public.image_descriptions FOR SELECT USING (true);'),
    ['image_descriptions:anon:image_id', 'image_descriptions:authenticated:image_id']);
  assert.deepEqual(k('CREATE POLICY p ON user_presence FOR SELECT TO anon, authenticated USING (true);'),
    ['user_presence:anon:user_id', 'user_presence:authenticated:user_id']);
  assert.deepEqual(k('CREATE POLICY p ON image_descriptions FOR SELECT TO authenticated USING (true);'), ['image_descriptions:authenticated:image_id']);
  assert.deepEqual(k('ALTER TABLE user_presence DISABLE ROW LEVEL SECURITY;'), ['user_presence:anon:user_id', 'user_presence:authenticated:user_id']);
  // keys added in the same migration and tables named for photos count
  assert.deepEqual(k('CREATE TABLE public.photo_readings (id uuid, vehicle_image_id uuid, body text);\nCREATE POLICY r ON public.photo_readings FOR SELECT USING (true);'),
    ['photo_readings:anon:vehicle_image_id', 'photo_readings:authenticated:vehicle_image_id']);
  assert.deepEqual(k('ALTER TABLE paint_codes ADD COLUMN source_document_id uuid; CREATE POLICY r ON paint_codes FOR SELECT USING (true);'),
    ['paint_codes:anon:source_document_id', 'paint_codes:authenticated:source_document_id']);
  assert.deepEqual(k('CREATE TABLE public.shop_photos (id uuid, taken_at timestamptz);\nCREATE POLICY r ON public.shop_photos FOR SELECT USING (true);'),
    ['shop_photos:anon:id', 'shop_photos:authenticated:id']);
  // rule tables named after receipts carry no key (20261124163000, 20261125013000, 20261125014500 replay)
  assert.deepEqual(k('CREATE TABLE public.receipt_line_systems (id text, label text);\nCREATE POLICY r ON public.receipt_line_systems FOR SELECT USING (true);'), []);
  // the idempotent DO-block shape (20251101000009 organization_images) counts; an EXECUTE string does not
  assert.deepEqual(k(`DO $$\nBEGIN\nDROP POLICY IF EXISTS "a" ON user_presence;\nCREATE POLICY "a" ON user_presence\n  FOR SELECT\n  USING (true);\nEND $$;`),
    ['user_presence:anon:user_id', 'user_presence:authenticated:user_id']);
  assert.deepEqual(k(`DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'a') THEN CREATE POLICY a ON image_descriptions FOR SELECT TO authenticated USING (true); END IF; END $do$;`),
    ['image_descriptions:authenticated:image_id']);
  assert.deepEqual(k(`DO $$ BEGIN EXECUTE 'CREATE POLICY a ON user_presence FOR SELECT USING (true)'; END $$;`), []);
  // predicates, service_role, writes and reference tables without keys pass
  assert.deepEqual(k(`CREATE POLICY p ON image_descriptions FOR SELECT USING (EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.id = image_id AND vi.user_id = auth.uid()));`), []);
  assert.deepEqual(k('CREATE POLICY p ON image_descriptions FOR SELECT TO service_role USING (true);'), []);
  assert.deepEqual(k('CREATE POLICY p ON image_descriptions FOR INSERT WITH CHECK (true);'), []);
  assert.deepEqual(k('CREATE POLICY p ON paint_codes FOR SELECT USING (true);'), []);
  // a select grant alone is not a subject exposure (RLS still filters); without the keys map nothing changes
  assert.deepEqual(k('GRANT SELECT ON image_descriptions TO anon;'), []);
  assert.deepEqual(findExposures('CREATE POLICY p ON image_descriptions FOR SELECT USING (true);', pii), []);
  for (const c of ['image_id', 'vehicle_image_id', 'image_ids', 'source_document_id', 'receipt_id', 'user_id', 'author_bat_user_id', 'uploaded_by', 'owner_id', 'capture_set_id'])
    assert.ok(SUBJECT_COLUMN.test(c), c);
  for (const c of ['id', 'vehicle_id', 'created_by', 'image_count', 'user_agent', 'document_type'])
    assert.ok(!SUBJECT_COLUMN.test(c), c);
  for (const t of ['vehicle_images', 'shop_photos', 'organization_images', 'receipts', 'library_documents']) assert.ok(SUBJECT_TABLE.test(t), t);
  for (const t of ['paint_codes', 'vehicles', 'imagery_sources', 'receipt_line_systems', 'image_tags']) assert.ok(!SUBJECT_TABLE.test(t), t);
});

test('subject keys: the allowlist exempts named keys with a reason', () => {
  const hits = findExposures('CREATE POLICY p ON image_descriptions FOR SELECT USING (true);', pii, { image_descriptions: ['image_id'] });
  assert.deepEqual(unallowed(hits, [{ table: 'image_descriptions', columns: ['image_id'], why: 'test' }]), []);
  assert.equal(unallowed(hits, []).length, 2);
});
