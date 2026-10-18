-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_open_update_delete -f this-file.sql
-- Proves that after 20261014174500_close_open_update_delete_policies.sql anon and signed-in callers can no longer
-- update, delete, insert into or truncate the 26 service-only tables while the service role still writes them and
-- the public reads survive; that a visitor's presence heartbeat still inserts while nobody rewrites or deletes
-- another viewer's row; that a deck slide takes only a signed-in, attributed edit; that an uploader can no longer
-- move an ownership row onto another vehicle; and that the live policies it replaces allowed each of those writes.
-- Starts from the live policies and grants as read on 2026-10-14. The seeds are a disposable database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.user_presence') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'owp_table_owner') THEN CREATE ROLE owp_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, owp_table_owner;
GRANT CREATE ON SCHEMA public TO owp_table_owner;

-- The 25 service-only tables that carry one write policy for the service role with no TO clause, as live: that
-- policy verbatim, the live read policy where there is one, row security on, every privilege granted to the API
-- roles, one row each. Owned like production's by a non-superuser.
CREATE TABLE public.t_service_tables (tbl text PRIMARY KEY, write_pol text NOT NULL, write_chk boolean NOT NULL, read_pol text);
INSERT INTO public.t_service_tables VALUES
  ('actor_capabilities', 'Service role manages actor_capabilities', true, 'Anyone can view actor_capabilities'),
  ('actors', 'Service role manages actors', true, 'Anyone can view actors'),
  ('backfill_queue', 'Service role can manage backfill queue', true, 'Anyone can view backfill queue'),
  ('canonical_makes', 'Service role manages canonical makes', true, 'Anyone can view canonical data'),
  ('component_events', 'Service role manages component_events', true, 'Anyone can view component_events'),
  ('coverage_targets', 'Service role manage coverage_targets', false, 'Public read coverage_targets'),
  ('data_validation_rules', 'Service role manages validation rules', true, 'Anyone can view validation rules'),
  ('document_ocr_queue', 'allow_all', true, NULL),
  ('ds_cost_tracking', 'ds_cost_tracking_service', false, NULL),
  ('engine_blocks', 'Service role manages engine_blocks', true, 'Anyone can view engine_blocks'),
  ('engine_camshafts', 'Service role manages engine_camshafts', true, 'Anyone can view engine_camshafts'),
  ('engine_carburetors', 'Service role manages engine_carburetors', true, 'Anyone can view engine_carburetors'),
  ('engine_crankshafts', 'Service role manages engine_crankshafts', true, 'Anyone can view engine_crankshafts'),
  ('engine_distributors', 'Service role manages engine_distributors', true, 'Anyone can view engine_distributors'),
  ('engine_exhaust_manifolds', 'Service role manages engine_exhaust_manifolds', true, 'Anyone can view engine_exhaust_manifolds'),
  ('engine_heads', 'Service role manages engine_heads', true, 'Anyone can view engine_heads'),
  ('engine_intake_manifolds', 'Service role manages engine_intake_manifolds', true, 'Anyone can view engine_intake_manifolds'),
  ('engine_oil_systems', 'Service role manages engine_oil_systems', true, 'Anyone can view engine_oil_systems'),
  ('extraction_runs', 'Service role full access to extraction_runs', true, NULL),
  ('image_vehicle_mismatches', 'Service role can manage mismatches', false, 'Public can view mismatches'),
  ('normalization_rules', 'Service role manages normalization rules', true, 'Anyone can view normalization rules'),
  ('photo_inbox', 'Service role full access', true, NULL),
  ('scraper_versions', 'Service role can manage scraper versions', true, 'Anyone can view scraper versions'),
  ('vehicle_status_metadata', 'allow_status_metadata_all_ops', true, 'Public read access to vehicle status'),
  ('vehicle_validation_issues', 'Service role manages validation issues', true, 'Anyone can view validation issues');
GRANT SELECT ON public.t_service_tables TO anon, authenticated, service_role, owp_table_owner;

SET ROLE owp_table_owner;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.t_service_tables LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text)', r.tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I USING (true)%s', r.write_pol, r.tbl,
      CASE WHEN r.write_chk THEN ' WITH CHECK (true)' ELSE '' END);
    IF r.read_pol IS NOT NULL THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', r.read_pol, r.tbl);
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', r.tbl);
    EXECUTE format($f$INSERT INTO public.%I (note) VALUES ('seed')$f$, r.tbl);
  END LOOP;
END $$;
CREATE POLICY allow_status_metadata_insert ON public.vehicle_status_metadata FOR INSERT WITH CHECK (true);

-- publications: a public read, and an insert and an update open to everyone.
CREATE TABLE public.publications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL);
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY publications_read ON public.publications FOR SELECT USING (true);
CREATE POLICY publications_insert ON public.publications FOR INSERT WITH CHECK (true);
CREATE POLICY publications_update ON public.publications FOR UPDATE USING (true);
GRANT ALL ON public.publications TO anon, authenticated, service_role;
INSERT INTO public.publications (title) VALUES ('Issue 1');

-- user_presence: the vehicle page heartbeat's table, its eight live policies verbatim.
CREATE TABLE public.user_presence (
  id bigserial PRIMARY KEY,
  vehicle_id uuid NOT NULL,
  user_id uuid,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_presence_vehicle_user_unique ON public.user_presence (vehicle_id, user_id);
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow presence updates" ON public.user_presence TO anon, authenticated USING (true);
CREATE POLICY "Anyone can create presence" ON public.user_presence FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view presence" ON public.user_presence FOR SELECT USING (true);
CREATE POLICY "Users can delete their own presence" ON public.user_presence FOR DELETE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);
CREATE POLICY "Users can update their own presence" ON public.user_presence FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);
CREATE POLICY user_presence_insert_any ON public.user_presence FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY user_presence_select_all ON public.user_presence FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY user_presence_update_self ON public.user_presence FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
GRANT ALL ON public.user_presence TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.user_presence_id_seq TO anon, authenticated, service_role;

-- deck_slides: a public read, a signed-in insert, and an update open to everyone.
CREATE TABLE public.deck_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id text NOT NULL,
  slide_index integer NOT NULL,
  content jsonb,
  updated_by uuid
);
ALTER TABLE public.deck_slides ENABLE ROW LEVEL SECURITY;
CREATE POLICY deck_slides_insert ON public.deck_slides FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY deck_slides_read ON public.deck_slides FOR SELECT USING (true);
CREATE POLICY deck_slides_write ON public.deck_slides FOR UPDATE USING (true);
GRANT ALL ON public.deck_slides TO anon, authenticated, service_role;

-- vehicle_ownerships and the vehicles its rules read.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, uploaded_by uuid, is_public boolean);
GRANT SELECT ON public.vehicles TO anon, authenticated, service_role;
CREATE TABLE public.vehicle_ownerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  owner_profile_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  is_current boolean NOT NULL DEFAULT true
);
ALTER TABLE public.vehicle_ownerships ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_ownerships_owner_update ON public.vehicle_ownerships FOR UPDATE
  USING (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND v.uploaded_by = (SELECT auth.uid())))
  WITH CHECK (true);
CREATE POLICY vehicle_ownerships_owner_write ON public.vehicle_ownerships FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND v.uploaded_by = (SELECT auth.uid())));
CREATE POLICY vehicle_ownerships_public_read ON public.vehicle_ownerships FOR SELECT
  USING ((EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND COALESCE(v.is_public, true) = true))
    OR owner_profile_id = (SELECT auth.uid()));
GRANT ALL ON public.vehicle_ownerships TO anon, authenticated, service_role;
RESET ROLE;

-- Seeds. Viewers U1 and U2; V1 uploaded by U1, V2 by U2; O1 on V1 (U1), O2 on V2 (U2); presence rows for a
-- visitor on V1 (user_id null), U1 on V1, U2 on V2; two slides.
INSERT INTO public.vehicles VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', true),
 ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000a2', true);
INSERT INTO public.vehicle_ownerships (id, vehicle_id, owner_profile_id) VALUES
 ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1'),
 ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000a2');
INSERT INTO public.user_presence (vehicle_id, user_id) VALUES
 ('10000000-0000-0000-0000-000000000001', NULL),
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1'),
 ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000a2');
INSERT INTO public.deck_slides (id, deck_id, slide_index, content) VALUES
 ('40000000-0000-0000-0000-000000000001', 'synthetic-deck', 0, '{"title": "One"}'),
 ('40000000-0000-0000-0000-000000000002', 'synthetic-deck', 1, '{"title": "Two"}');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
-- Runs one statement as the current role; true when it raised insufficient_privilege (a revoked grant or a
-- refused row), false when it ran.
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE FUNCTION public.t_count(p_tbl text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE format('SELECT count(*) FROM public.%I', p_tbl) INTO n; RETURN n; END $$;
-- The heartbeat as the vehicle page sends it: upsert on (vehicle_id, user_id), user_id null for a visitor.
CREATE FUNCTION public.t_heartbeat(p_vehicle uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO public.user_presence (vehicle_id, user_id, last_seen_at) VALUES (p_vehicle, auth.uid(), now())
  ON CONFLICT (vehicle_id, user_id) DO UPDATE
    SET vehicle_id = EXCLUDED.vehicle_id, user_id = EXCLUDED.user_id, last_seen_at = EXCLUDED.last_seen_at;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text), public.t_rows(text),
  public.t_count(text), public.t_heartbeat(uuid) TO anon, authenticated, service_role;

-- 1. Before: anon rewrites and deletes every row of every service-only table, and the scoped tables are open too.
SET ROLE anon;
SET test.auth_uid = '';
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl FROM public.t_service_tables LOOP
    PERFORM public.t_assert(public.t_rows(format($f$UPDATE public.%I SET note = 'tampered'$f$, r.tbl)) = 1,
      format('before: anon updates every %s row', r.tbl));
    PERFORM public.t_assert(public.t_rows(format('DELETE FROM public.%I', r.tbl)) = 1,
      format('before: anon deletes every %s row', r.tbl));
    PERFORM public.t_assert(public.t_rows(format($f$INSERT INTO public.%I (note) VALUES ('planted')$f$, r.tbl)) = 1,
      format('before: anon inserts into %s', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_rows($q$UPDATE public.publications SET title = 'tampered'$q$) = 1, 'before: anon rewrites publications');
SELECT public.t_assert(public.t_rows($q$UPDATE public.user_presence SET last_seen_at = now() - interval '1 year'$q$) = 3, 'before: anon rewrites every presence row');
SELECT public.t_assert(public.t_rows($q$DELETE FROM public.user_presence$q$) = 3, 'before: anon deletes every presence row');
SELECT public.t_assert(public.t_rows($q$UPDATE public.deck_slides SET content = '{"title": "tampered"}'$q$) = 2, 'before: anon rewrites every slide');
ROLLBACK;
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
BEGIN;
SELECT public.t_assert(public.t_rows($q$UPDATE public.vehicle_ownerships SET vehicle_id = '10000000-0000-0000-0000-000000000002', owner_profile_id = '20000000-0000-0000-0000-0000000000a1' WHERE id = '30000000-0000-0000-0000-000000000001'$q$) = 1,
  'before: an uploader moves their ownership row onto another vehicle');
ROLLBACK;
RESET ROLE;
SELECT public.t_assert(has_table_privilege('anon', 'public.extraction_runs', 'TRUNCATE'), 'before: anon holds TRUNCATE');

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET ROLE owp_table_owner;
\ir ../migrations/20261014174500_close_open_update_delete_policies.sql
\ir ../migrations/20261014174500_close_open_update_delete_policies.sql
RESET ROLE;

-- 3. anon and a signed-in stranger: every write to a service-only table is refused; the public reads survive, and
--    the four tables whose only read path was the open policy read nothing.
SET test.auth_uid = '';
SET ROLE anon;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl, read_pol FROM public.t_service_tables LOOP
    PERFORM public.t_assert(public.t_refused(format($f$UPDATE public.%I SET note = 'tampered'$f$, r.tbl)), format('anon update refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_refused(format('DELETE FROM public.%I', r.tbl)), format('anon delete refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_refused(format($f$INSERT INTO public.%I (note) VALUES ('planted')$f$, r.tbl)), format('anon insert refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_refused(format('TRUNCATE public.%I', r.tbl)), format('anon truncate refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_count(r.tbl) = CASE WHEN r.read_pol IS NULL THEN 0 ELSE 1 END, format('anon reads %s as the read policy says', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_count('publications') = 1, 'anon still reads publications');
SELECT public.t_assert(public.t_refused($q$UPDATE public.publications SET title = 'tampered'$q$), 'anon publications update refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.publications (title) VALUES ('planted')$q$), 'anon publications insert refused');
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f9';
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl, read_pol FROM public.t_service_tables UNION ALL SELECT 'publications', 'publications_read' LOOP
    PERFORM public.t_assert(public.t_refused(format($f$UPDATE public.%I SET %I = 'tampered'$f$, r.tbl, CASE r.tbl WHEN 'publications' THEN 'title' ELSE 'note' END)),
      format('signed-in update refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_refused(format('DELETE FROM public.%I', r.tbl)), format('signed-in delete refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_refused(format('TRUNCATE public.%I', r.tbl)), format('signed-in truncate refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_count(r.tbl) = CASE WHEN r.read_pol IS NULL THEN 0 ELSE 1 END, format('signed-in reads %s as the read policy says', r.tbl));
  END LOOP;
END $$;
RESET ROLE;

-- 4. The service role still writes every service-only table.
SET ROLE service_role;
SET test.auth_uid = '';
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl FROM public.t_service_tables LOOP
    PERFORM public.t_assert(public.t_rows(format($f$INSERT INTO public.%I (note) VALUES ('service')$f$, r.tbl)) = 1, format('service role inserts into %s', r.tbl));
    PERFORM public.t_assert(public.t_rows(format($f$UPDATE public.%I SET note = 'service, updated' WHERE note = 'service'$f$, r.tbl)) = 1, format('service role updates %s', r.tbl));
    PERFORM public.t_assert(public.t_rows(format($f$DELETE FROM public.%I WHERE note = 'service, updated'$f$, r.tbl)) = 1, format('service role deletes from %s', r.tbl));
    PERFORM public.t_assert(public.t_count(r.tbl) = 1, format('service role reads %s', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_rows($q$UPDATE public.publications SET title = 'Issue 1, corrected'$q$) = 1, 'service role updates publications');
RESET ROLE;

-- 5. Presence: a visitor's heartbeat still inserts, and inserts again (null never conflicts); a visitor rewrites
--    and deletes nothing. A signed-in viewer's heartbeat updates their own row, and they touch nobody else's.
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert(public.t_heartbeat('10000000-0000-0000-0000-000000000002') = 1, 'visitor heartbeat inserts');
SELECT public.t_assert(public.t_heartbeat('10000000-0000-0000-0000-000000000002') = 1, 'visitor heartbeat inserts again');
SELECT public.t_assert(public.t_count('user_presence') = 5, 'a visitor reads every presence row');
SELECT public.t_assert(public.t_rows($q$UPDATE public.user_presence SET last_seen_at = now() - interval '1 year'$q$) = 0, 'a visitor rewrites no presence row');
SELECT public.t_assert(public.t_refused($q$DELETE FROM public.user_presence$q$), 'a visitor delete is refused');
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert(public.t_heartbeat('10000000-0000-0000-0000-000000000001') = 1, 'signed-in heartbeat upserts');
SELECT public.t_assert((SELECT count(*) FROM public.user_presence WHERE user_id = '20000000-0000-0000-0000-0000000000a1') = 1, 'the upsert updated U1''s row, no second row');
SELECT public.t_assert(public.t_rows($q$UPDATE public.user_presence SET last_seen_at = now() - interval '1 year'$q$) = 1, 'U1 rewrites only their own presence row');
SELECT public.t_assert(public.t_refused($q$DELETE FROM public.user_presence WHERE user_id IS NULL$q$), 'U1 cannot delete visitor rows');
RESET ROLE;
SELECT public.t_assert((SELECT count(*) FROM public.user_presence WHERE last_seen_at < now() - interval '300 days') = 1, 'only U1''s row was rewritten');

-- 6. Slides: anon is refused; a signed-in editor saves with updated_by set to themselves, and only so.
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert(public.t_refused($q$UPDATE public.deck_slides SET content = '{"title": "tampered"}'$q$), 'anon slide update refused');
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert(public.t_rows($q$UPDATE public.deck_slides SET content = '{"title": "One, edited"}', updated_by = '20000000-0000-0000-0000-0000000000a1' WHERE id = '40000000-0000-0000-0000-000000000001'$q$) = 1,
  'signed-in editor saves an attributed edit');
SELECT public.t_assert(public.t_refused($q$UPDATE public.deck_slides SET content = '{"title": "Two, edited"}' WHERE id = '40000000-0000-0000-0000-000000000002'$q$),
  'an edit without attribution is refused');
SELECT public.t_assert(public.t_refused($q$UPDATE public.deck_slides SET updated_by = '20000000-0000-0000-0000-0000000000a2' WHERE id = '40000000-0000-0000-0000-000000000001'$q$),
  'an edit attributed to someone else is refused');
SELECT public.t_assert(public.t_refused($q$DELETE FROM public.deck_slides$q$), 'signed-in slide delete refused');
RESET ROLE;
SELECT public.t_assert((SELECT content->>'title' FROM public.deck_slides WHERE id = '40000000-0000-0000-0000-000000000002') = 'Two', 'the refused edit left slide two as it was');

-- 7. Ownerships: the uploader still updates their row in place but cannot move it onto another vehicle; another
--    uploader and anon change nothing.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert(public.t_rows($q$UPDATE public.vehicle_ownerships SET role = 'co_owner' WHERE id = '30000000-0000-0000-0000-000000000001'$q$) = 1, 'the uploader updates their ownership row');
SELECT public.t_assert(public.t_refused($q$UPDATE public.vehicle_ownerships SET vehicle_id = '10000000-0000-0000-0000-000000000002' WHERE id = '30000000-0000-0000-0000-000000000001'$q$),
  'the uploader cannot move the row onto another vehicle');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a2';
SELECT public.t_assert(public.t_rows($q$UPDATE public.vehicle_ownerships SET role = 'tampered' WHERE id = '30000000-0000-0000-0000-000000000001'$q$) = 0, 'another uploader updates nothing');
RESET ROLE;
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert(public.t_refused($q$UPDATE public.vehicle_ownerships SET role = 'tampered'$q$), 'anon ownership update refused');
RESET ROLE;
SELECT public.t_assert((SELECT vehicle_id FROM public.vehicle_ownerships WHERE id = '30000000-0000-0000-0000-000000000001') = '10000000-0000-0000-0000-000000000001', 'O1 is still on V1');

-- 8. Grants and policies as left.
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND has_table_privilege('anon', 'public.' || tbl, 'SELECT'), 'no API write grant on ' || tbl)
FROM (SELECT tbl FROM public.t_service_tables UNION ALL SELECT 'publications') s;
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polroles = ARRAY['service_role'::regrole::oid]) = 25, 'the 25 service policies name the service role');
SELECT public.t_assert(has_table_privilege('anon', 'public.user_presence', 'INSERT')
  AND has_table_privilege('anon', 'public.user_presence', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.user_presence', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.user_presence', 'DELETE,TRUNCATE'),
  'presence: visitors keep the heartbeat''s INSERT and UPDATE, nobody deletes');
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.deck_slides', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND has_table_privilege('authenticated', 'public.deck_slides', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.deck_slides', 'DELETE,TRUNCATE'), 'slides: signed-in update only');
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.vehicle_ownerships', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.vehicle_ownerships', 'DELETE,TRUNCATE'), 'ownerships: no anon write, no delete');
SELECT public.t_assert(NOT EXISTS (
  SELECT 1 FROM pg_policy p WHERE p.polpermissive AND p.polcmd IN ('w', 'd', '*')
    AND p.polroles && ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid]
    AND (pg_get_expr(p.polqual, p.polrelid) = 'true' OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true')),
  'no UPDATE, DELETE or ALL policy for an API role passes every row');

-- 9. Drift stops the migration, and it changes nothing: (a) a policy no longer as read; (b) an open policy added.
SET ROLE owp_table_owner;
ALTER POLICY "Service role manages actors" ON public.actors USING (false);
GRANT UPDATE ON public.canonical_makes TO anon;
\set ON_ERROR_STOP off
\ir ../migrations/20261014174500_close_open_update_delete_policies.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.canonical_makes', 'UPDATE'), 'drift (a): the migration changed nothing');
ALTER POLICY "Service role manages actors" ON public.actors USING (true);
CREATE POLICY drifted_open_update ON public.publications FOR UPDATE USING (true);
\set ON_ERROR_STOP off
\ir ../migrations/20261014174500_close_open_update_delete_policies.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.canonical_makes', 'UPDATE'), 'drift (b): the migration rolled back');
SELECT public.t_assert(EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'drifted_open_update'), 'drift (b): the added policy is still there');
RESET ROLE;

SELECT 'open update and delete policies contract: all checks passed' AS result;
