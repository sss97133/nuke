-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_ov_anon_read -f this-file.sql
-- Contract for 20261014235900_ownership_verifications_anon_read_path.sql. Synthetic rows only; never production.
-- ownership_verifications is built with production's row policies and its exact ACL text after
-- 20261014234500_ownership_verifications_select_scoped (anon holds no SELECT). An invoker function that references
-- the table in a branch anon never reaches, the way vehicle_profile_read's viewer CASE does, proves the regression
-- and its repair:
--   * before: anon gets insufficient_privilege from the function and from a direct read;
--   * after: the function answers for anon, anon reads no row and still writes nothing, the claimant reads their
--     own row only, an active admin and the service role read every row; the migration is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.ownership_verifications') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role, dm_contract_deployer;
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- denied(sql) is true when the statement fails with insufficient_privilege (42501).
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END $$;
-- rows(sql) runs a write and returns how many rows it touched, then undoes it.
CREATE FUNCTION pg_temp.rows(p_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001', DETAIL = n::text;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS p_sql = PG_EXCEPTION_DETAIL;
    RETURN p_sql::integer;
  END;
END $$;
-- count(sql) returns a count the current role can see.
CREATE FUNCTION pg_temp.n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN v;
END $$;

-- Production shape (information_schema and pg_policies, 2026-10-14 22:50Z; the URL columns kept, the rest elided).
CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY, is_active boolean DEFAULT true);
GRANT SELECT ON public.admin_users TO anon, authenticated, service_role;
CREATE TABLE public.ownership_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  vehicle_id uuid,
  status text,
  title_document_url text,
  drivers_license_url text,
  face_scan_url text,
  human_reviewer_id uuid,
  human_reviewed_at timestamp,
  human_review_notes text,
  approved_at timestamp,
  rejected_at timestamp,
  rejection_reason text
);
ALTER TABLE public.ownership_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own verifications" ON public.ownership_verifications AS PERMISSIVE FOR SELECT TO public
  USING ((SELECT auth.uid() AS uid) = user_id);
CREATE POLICY ownership_verifications_admin_access ON public.ownership_verifications AS PERMISSIVE FOR ALL TO public
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = (SELECT auth.uid() AS uid) AND admin_users.is_active = true));
CREATE POLICY ownership_verifications_insert_self ON public.ownership_verifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (human_reviewer_id IS NULL)
    AND (human_reviewed_at IS NULL) AND (human_review_notes IS NULL) AND (approved_at IS NULL) AND (rejected_at IS NULL)
    AND (rejection_reason IS NULL));
CREATE POLICY "Users can update their own verification documents" ON public.ownership_verifications AS PERMISSIVE
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid() AS uid))
  WITH CHECK ((user_id = (SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (human_reviewer_id IS NULL)
    AND (human_reviewed_at IS NULL) AND (human_review_notes IS NULL) AND (approved_at IS NULL) AND (rejected_at IS NULL)
    AND (rejection_reason IS NULL));
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ownership_verifications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ownership_verifications
  TO authenticated, service_role;
SELECT pg_temp.ok('the fixture ACL is production''s text (owner renamed)',
  replace((SELECT relacl::text FROM pg_class WHERE oid = 'public.ownership_verifications'::regclass),
          'dm_contract_deployer', 'postgres')
  = '{postgres=arwdDxtm/postgres,anon=awdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres}');

-- An invoker reader shaped like vehicle_profile_read's viewer CASE: anon is answered by the first branch.
CREATE FUNCTION public.vehicle_viewer(p_vehicle_id uuid) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL THEN 'anon'
    WHEN EXISTS (SELECT 1 FROM public.ownership_verifications ov
                 WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = (SELECT auth.uid()) AND ov.status = 'approved'
                   AND coalesce(ov.title_document_url, '') NOT IN ('', 'pending')
                   AND coalesce(ov.drivers_license_url, '') NOT IN ('', 'pending')) THEN 'owner'
    ELSE 'viewer'
  END
$fn$;
GRANT EXECUTE ON FUNCTION public.vehicle_viewer(uuid) TO anon, authenticated, service_role;

INSERT INTO public.admin_users (user_id) VALUES ('30000000-0000-0000-0000-000000000001');
INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, title_document_url, drivers_license_url) VALUES
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'approved', 'title-1', 'license-1'),
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'pending', 'pending', 'pending');

-- 1. Before: the logged-out read path fails on the table privilege.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
SELECT pg_temp.ok('before: anon reading through the invoker reader is refused',
  pg_temp.denied($q$SELECT public.vehicle_viewer('10000000-0000-0000-0000-000000000001')$q$));
SELECT pg_temp.ok('before: anon reading the table directly is refused',
  pg_temp.denied($q$SELECT count(*) FROM public.ownership_verifications$q$));
RESET ROLE;
SET ROLE dm_contract_deployer;
\ir ../migrations/20261014235900_ownership_verifications_anon_read_path.sql
-- A second application changes nothing and passes its own check.
\ir ../migrations/20261014235900_ownership_verifications_anon_read_path.sql

-- 2. After: the read path answers; row security keeps every row from anon.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
SELECT pg_temp.ok('anon: the invoker reader answers',
  public.vehicle_viewer('10000000-0000-0000-0000-000000000001') = 'anon');
SELECT pg_temp.ok('anon: reads no verification row and no document field',
  pg_temp.n($q$SELECT count(*) FROM public.ownership_verifications$q$) = 0
  AND pg_temp.n($q$SELECT count(*) FROM public.ownership_verifications WHERE drivers_license_url IS NOT NULL$q$) = 0);
SELECT pg_temp.ok('anon: still writes nothing',
  pg_temp.rows($q$UPDATE public.ownership_verifications SET status = 'approved'$q$) = 0
  AND pg_temp.rows($q$DELETE FROM public.ownership_verifications$q$) = 0
  AND pg_temp.denied($q$INSERT INTO public.ownership_verifications (user_id, vehicle_id, status) VALUES (NULL, NULL, 'approved')$q$));
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('claimant: reads their own row only, and the reader names them owner',
  pg_temp.n($q$SELECT count(*) FROM public.ownership_verifications$q$) = 1
  AND public.vehicle_viewer('10000000-0000-0000-0000-000000000001') = 'owner');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000002', false);
SELECT pg_temp.ok('a pending claimant: reads their own row only, and is not an owner',
  pg_temp.n($q$SELECT count(*) FROM public.ownership_verifications$q$) = 1
  AND public.vehicle_viewer('10000000-0000-0000-0000-000000000001') = 'viewer');
SELECT set_config('test.auth_uid', '30000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('an active admin reads every row',
  pg_temp.n($q$SELECT count(*) FROM public.ownership_verifications$q$) = 2);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('the service role reads every row',
  pg_temp.n($q$SELECT count(*) FROM public.ownership_verifications$q$) = 2);
RESET ROLE;
SELECT pg_temp.ok('only SELECT changed for anon',
  replace((SELECT relacl::text FROM pg_class WHERE oid = 'public.ownership_verifications'::regclass),
          'dm_contract_deployer', 'postgres')
  = '{postgres=arwdDxtm/postgres,anon=arwdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres}');
