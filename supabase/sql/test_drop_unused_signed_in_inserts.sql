-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_unused_signed_in_inserts -f this-file.sql
-- Proves that after 20261014220000_drop_unused_signed_in_inserts.sql a signed-in stranger (any account: sign-up is
-- open and anonymous sign-in is on) can no longer insert into the 15 tables whose insert policy checked nothing more
-- than a signed-in caller, that the scoped insert paths that stay still work (an organization's discoverer, a
-- vehicle's editor), that the service role still inserts everywhere, and that the live policies let the stranger
-- insert into each. Starts from the live policies and grants as read on 2026-10-14. The seeds are a disposable
-- database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'owp_table_owner') THEN CREATE ROLE owp_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, owp_table_owner;
GRANT CREATE ON SCHEMA public TO owp_table_owner;
CREATE FUNCTION public.t_as(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;
GRANT EXECUTE ON FUNCTION public.t_as(text) TO anon, authenticated, service_role;

-- The 15 tables as live: the open insert policies verbatim, a read policy, row security on, every privilege granted to
-- the API roles. Owned like production's by a non-superuser.
CREATE TABLE public.t_open_inserts (tbl text NOT NULL, pol text NOT NULL, roles text NOT NULL, chk text NOT NULL, PRIMARY KEY (tbl, pol));
INSERT INTO public.t_open_inserts VALUES
  ('organization_behavior_signals', 'obs_insert', 'PUBLIC', '(SELECT auth.uid()) IS NOT NULL'),
  ('component_identifications', 'component_ids_create', 'authenticated', 'true'),
  ('image_analysis_records', 'analysis_records_create', 'authenticated', 'true'),
  ('organizations', 'Authenticated users can create businesses', 'PUBLIC', '(SELECT auth.uid()) IS NOT NULL'),
  ('organizations', 'Users can create businesses', 'PUBLIC', '(SELECT auth.uid()) IS NOT NULL'),
  ('vehicle_unverified_owners', 'vehicle_unverified_owners_insert', 'PUBLIC', '(SELECT auth.uid()) IS NOT NULL'),
  ('unverified_contacts', 'unverified_contacts_insert', 'PUBLIC', '(SELECT auth.uid()) IS NOT NULL'),
  ('parts_catalog', 'Verified users can contribute to parts catalog', 'PUBLIC', '(SELECT auth.uid()) IS NOT NULL'),
  ('brands', 'Authenticated users can create brands', 'authenticated', 'true'),
  ('tag_vocabulary', 'Authenticated users can suggest tags', 'PUBLIC', '(SELECT auth.uid()) IS NOT NULL'),
  ('component_definitions', 'component_defs_auth_create', 'authenticated', 'true'),
  ('part_catalog', 'Authenticated users can suggest parts', 'authenticated', 'true'),
  ('archive_imports', 'archive_imports_insert', 'PUBLIC', '(SELECT auth.uid()) IS NOT NULL'),
  ('knowledge_gaps', 'gaps_auth_create', 'authenticated', 'true'),
  ('vehicle_nomenclature', 'vehicle_nomenclature_authenticated_write', 'authenticated', 'true'),
  ('research_requests', 'research_create', 'authenticated', 'true');
GRANT SELECT ON public.t_open_inserts TO anon, authenticated, service_role, owp_table_owner;

SET ROLE owp_table_owner;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, uploaded_by uuid, owner_id uuid);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, role text);
GRANT SELECT ON public.vehicles, public.vehicle_contributors TO anon, authenticated, service_role;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM public.t_open_inserts LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text, discovered_by uuid, uploaded_by uuid, vehicle_id uuid)', r.tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', r.tbl || '_read', r.tbl);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', r.tbl);
  END LOOP;
  FOR r IN SELECT * FROM public.t_open_inserts LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO %s WITH CHECK (%s)', r.pol, r.tbl,
      CASE r.roles WHEN 'PUBLIC' THEN 'public' ELSE r.roles END, r.chk);
  END LOOP;
END $$;
-- The scoped insert policies that stay, verbatim.
CREATE POLICY "Users create orgs" ON public.organizations FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = discovered_by OR (SELECT auth.uid()) = uploaded_by);
CREATE POLICY vehicle_nomenclature_insert ON public.vehicle_nomenclature FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_nomenclature.vehicle_id
    AND ((SELECT auth.uid()) = v.uploaded_by OR (SELECT auth.uid()) = v.owner_id
      OR EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = v.id AND vc.user_id = (SELECT auth.uid())
        AND vc.role = ANY (ARRAY['owner', 'restorer', 'contributor', 'moderator'])))));
RESET ROLE;
INSERT INTO public.vehicles VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', NULL);

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text), public.t_rows(text) TO anon, authenticated, service_role;

-- 1. Before: a signed-in stranger inserts into every one of the 15 tables, in no one's name.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000f9');
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM public.t_open_inserts LOOP
    PERFORM public.t_assert(public.t_rows(format($f$INSERT INTO public.%I (note) VALUES ('planted')$f$, r.tbl)) = 1,
      format('before: a stranger inserts into %s', r.tbl));
  END LOOP;
END $$;
ROLLBACK;
RESET ROLE;

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET ROLE owp_table_owner;
\ir ../migrations/20261014220000_drop_unused_signed_in_inserts.sql
\ir ../migrations/20261014220000_drop_unused_signed_in_inserts.sql
RESET ROLE;

-- 3. The stranger and anon insert nowhere; the discoverer and the vehicle's editor still insert; the service role too.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000f9');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM public.t_open_inserts LOOP
    PERFORM public.t_assert(public.t_refused(format($f$INSERT INTO public.%I (note) VALUES ('planted')$f$, r.tbl)), format('a stranger insert refused on %s', r.tbl));
  END LOOP;
END $$;
SELECT public.t_as('20000000-0000-0000-0000-0000000000d1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organizations (note, discovered_by) VALUES ('found it', '20000000-0000-0000-0000-0000000000d1')$q$) = 1,
  'the discoverer still files an organization in their own name');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organizations (note, discovered_by) VALUES ('found it', '20000000-0000-0000-0000-0000000000b1')$q$),
  'not in someone else''s name');
SELECT public.t_as('20000000-0000-0000-0000-0000000000b1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_nomenclature (note, vehicle_id) VALUES ('Cheyenne', '10000000-0000-0000-0000-000000000001')$q$) = 1,
  'the vehicle''s uploader still adds nomenclature');
RESET ROLE;
SET ROLE anon;
SELECT public.t_as('');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM public.t_open_inserts LOOP
    PERFORM public.t_assert(public.t_refused(format($f$INSERT INTO public.%I (note) VALUES ('planted')$f$, r.tbl)), format('anon insert refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_rows(format('SELECT 1 FROM public.%I LIMIT 1', r.tbl)) >= 0, format('anon still reads %s', r.tbl));
  END LOOP;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM public.t_open_inserts LOOP
    PERFORM public.t_assert(public.t_rows(format($f$INSERT INTO public.%I (note) VALUES ('service')$f$, r.tbl)) = 1, format('the service role inserts into %s', r.tbl));
  END LOOP;
END $$;
RESET ROLE;
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM pg_policy p JOIN public.t_open_inserts o ON p.polname = o.pol), 'all 16 open insert policies are gone');
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND has_table_privilege('authenticated', 'public.' || tbl, 'INSERT') = (tbl IN ('organizations', 'vehicle_nomenclature'))
  AND NOT has_table_privilege('authenticated', 'public.' || tbl, 'TRUNCATE'), 'grants as left on ' || tbl)
FROM (SELECT DISTINCT tbl FROM public.t_open_inserts) t;

-- 4. Drift stops the migration, and it changes nothing: an open insert policy back under a known name, reshaped.
SET ROLE owp_table_owner;
CREATE POLICY brands_public_insert_drift ON public.brands FOR INSERT WITH CHECK (true);
CREATE POLICY research_create ON public.research_requests FOR INSERT TO authenticated WITH CHECK (false);
GRANT INSERT ON public.knowledge_gaps TO anon;
\set ON_ERROR_STOP off
\ir ../migrations/20261014220000_drop_unused_signed_in_inserts.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.knowledge_gaps', 'INSERT'), 'drift: the migration changed nothing');
RESET ROLE;

SELECT 'unused signed-in inserts contract: all checks passed' AS result;
