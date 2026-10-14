-- Empty disposable PG17 only. Auto-run by scripts/ci/run-db-contracts.sh (db-contracts job) in dm_refinement_*.
-- Proves that after 20261014234500_ownership_verifications_select_scoped.sql only the claimant, an admin and the
-- service role read ownership_verifications; a logged-out or signed-in non-owner reads none. Builds the two live
-- SELECT policies plus the admin policy, and shows the blanket read exposing every row before.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.ownership_verifications') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ov_owner') THEN CREATE ROLE ov_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, ov_owner;
GRANT CREATE ON SCHEMA public TO ov_owner;

SET ROLE ov_owner;
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.ownership_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, vehicle_id uuid, status text DEFAULT 'pending',
  title_document_url text, drivers_license_url text, title_owner_name text
);
ALTER TABLE public.ownership_verifications ENABLE ROW LEVEL SECURITY;
-- The live SELECT policies plus the admin policy (the state after #1219), verbatim in shape.
CREATE POLICY "Users can view own verifications" ON public.ownership_verifications FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);
CREATE POLICY ownership_verifications_select ON public.ownership_verifications FOR SELECT TO public USING (true);
CREATE POLICY ownership_verifications_admin_access ON public.ownership_verifications FOR ALL TO public
  USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = (SELECT auth.uid()) AND a.is_active = true));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ownership_verifications TO anon, authenticated, service_role;
GRANT SELECT ON public.admin_users TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated, service_role;

-- Seeds: claimant C1's verification, and admin A1.
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000d1', true);
INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, title_document_url, title_owner_name)
  VALUES ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'pending', 'https://x/title.jpg', 'Jane Owner');

-- 1. Before: a logged-out visitor reads the row (document URL and owner name).
SET ROLE anon; SET test.auth_uid='';
SELECT public.t_assert((SELECT count(*) FROM public.ownership_verifications) = 1, 'before: anon reads every verification');
SELECT public.t_assert((SELECT title_owner_name FROM public.ownership_verifications LIMIT 1) = 'Jane Owner', 'before: anon reads the owner name');
RESET ROLE;

-- 2. Apply the migration as the table owner, twice.
SET ROLE ov_owner;
\ir ../migrations/20261014234500_ownership_verifications_select_scoped.sql
\ir ../migrations/20261014234500_ownership_verifications_select_scoped.sql
RESET ROLE;

-- 3. After: anon and a signed-in non-owner read nothing; the claimant reads their own; an admin reads all.
SET ROLE anon; SET test.auth_uid='';
SELECT public.t_assert(public.t_refused($q$SELECT count(*) FROM public.ownership_verifications$q$), 'after: anon read refused (grant revoked)');
SELECT public.t_assert(NOT has_table_privilege('anon','public.ownership_verifications','SELECT'), 'after: anon loses the table SELECT grant');
RESET ROLE;
SET ROLE authenticated; SET test.auth_uid='20000000-0000-0000-0000-0000000000f9';
SELECT public.t_assert((SELECT count(*) FROM public.ownership_verifications) = 0, 'after: a signed-in non-owner reads none');
SET test.auth_uid='20000000-0000-0000-0000-0000000000c1';
SELECT public.t_assert((SELECT count(*) FROM public.ownership_verifications) = 1, 'after: the claimant reads their own');
SET test.auth_uid='20000000-0000-0000-0000-0000000000d1';
SELECT public.t_assert((SELECT count(*) FROM public.ownership_verifications) = 1, 'after: an active admin reads all');
RESET ROLE;
SET ROLE service_role; SET test.auth_uid='';
SELECT public.t_assert((SELECT count(*) FROM public.ownership_verifications) = 1, 'after: the service role reads all');
RESET ROLE;

SELECT 'ownership_verifications select scoped contract: all checks passed' AS result;
