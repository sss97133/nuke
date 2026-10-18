-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_ownership_verifications -f this-file.sql
-- Proves that after 20261014200000_ownership_verifications_arrive_pending.sql a vehicle-ownership claim arrives
-- pending and only a reviewer approves it: a signed-in claimant can no longer insert or self-update a verification to
-- 'approved' (which the AFTER-status trigger would turn into a vehicle_user_permissions 'owner' grant), while an
-- active admin still approves and the grant then fires. Starts from the live policies and the live
-- auto_grant_owner_on_verification trigger (helpers/ownership_verifications_live_20261014.sql) and shows the
-- self-grant there first.
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
-- The columns the policies and the trigger touch, with the live NOT NULL and CHECK on status, owned by a non-superuser.
CREATE TABLE public.ownership_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT NULL,
  vehicle_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','documents_uploaded','ai_processing','human_review','approved','rejected','expired')),
  title_document_url text NOT NULL,
  drivers_license_url text NOT NULL,
  human_reviewer_id uuid, human_reviewed_at timestamptz, human_review_notes text,
  approved_at timestamptz, rejected_at timestamptz, rejection_reason text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.vehicle_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, user_id uuid, role text, granted_by uuid, context text,
  is_active boolean, granted_at timestamptz, created_at timestamptz
);
CREATE UNIQUE INDEX vup_active_uq ON public.vehicle_user_permissions (vehicle_id, user_id, role) WHERE is_active = true;
ALTER TABLE public.ownership_verifications ENABLE ROW LEVEL SECURITY;
\ir helpers/ownership_verifications_live_20261014.sql
CREATE TRIGGER trg_auto_grant_owner AFTER INSERT OR UPDATE OF status ON public.ownership_verifications
  FOR EACH ROW EXECUTE FUNCTION public.auto_grant_owner_on_verification();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ownership_verifications TO anon, authenticated, service_role;
GRANT SELECT ON public.admin_users TO anon, authenticated, service_role;
GRANT SELECT ON public.vehicle_user_permissions TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_rows(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_policy_hash() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(string_agg(
           p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
  FROM pg_policy p WHERE p.polrelid = 'public.ownership_verifications'::regclass $$;

-- Seeds: admin A1; claimant C1. The URLs satisfy the live CHECKs.
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000d1', true);

-- 0. The fixture is the live policy set.
SELECT public.t_assert(public.t_policy_hash() = 'eRsDpwfz/KEF71HYdOJJYXnWkhwVkh6Oz/A9Wh973gY=', 'fixture: policies as live');

-- 1. Before: the claimant self-inserts an approved verification and the trigger grants them owner.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
BEGIN;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, title_document_url, drivers_license_url)
    VALUES ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'approved', 'https://x/title.jpg', 'https://x/dl.jpg')$q$) = 1,
  'before: claimant inserts an approved verification');
SELECT public.t_assert((SELECT count(*) FROM public.vehicle_user_permissions
    WHERE vehicle_id='10000000-0000-0000-0000-000000000001' AND user_id='20000000-0000-0000-0000-0000000000c1'
      AND role='owner' AND is_active) = 1, 'before: the trigger granted the claimant owner');
ROLLBACK;
RESET ROLE;

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET test.auth_uid = '';
SET ROLE ov_owner;
\ir ../migrations/20261014200000_ownership_verifications_arrive_pending.sql
\ir ../migrations/20261014200000_ownership_verifications_arrive_pending.sql
RESET ROLE;

-- 3. After: the claimant can file a pending claim but cannot insert or self-update to approved.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, title_document_url, drivers_license_url)
  VALUES ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'approved', 'https://x/t.jpg', 'https://x/d.jpg')$q$),
  'after: claimant cannot insert an approved verification');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, title_document_url, drivers_license_url, human_reviewer_id)
  VALUES ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'pending', 'https://x/t.jpg', 'https://x/d.jpg', '20000000-0000-0000-0000-0000000000c1')$q$),
  'after: claimant cannot name a reviewer on insert');
INSERT INTO public.ownership_verifications (id, user_id, vehicle_id, status, title_document_url, drivers_license_url)
  VALUES ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'pending', 'https://x/title.jpg', 'https://x/dl.jpg');
SELECT public.t_assert((SELECT status FROM public.ownership_verifications WHERE id='50000000-0000-0000-0000-000000000001') = 'pending', 'after: the pending claim is filed');
-- The claimant may re-upload a document, but cannot move status or set a decision field.
SELECT public.t_assert(public.t_rows($q$UPDATE public.ownership_verifications SET title_document_url='https://x/title2.jpg' WHERE id='50000000-0000-0000-0000-000000000001'$q$) = 1, 'after: claimant re-uploads a document');
SELECT public.t_assert(public.t_refused($q$UPDATE public.ownership_verifications SET status='approved' WHERE id='50000000-0000-0000-0000-000000000001'$q$), 'after: claimant cannot self-approve');
SELECT public.t_assert(public.t_refused($q$UPDATE public.ownership_verifications SET approved_at=now() WHERE id='50000000-0000-0000-0000-000000000001'$q$), 'after: claimant cannot set approved_at');
SELECT public.t_assert(public.t_refused($q$UPDATE public.ownership_verifications SET human_reviewer_id='20000000-0000-0000-0000-0000000000c1' WHERE id='50000000-0000-0000-0000-000000000001'$q$), 'after: claimant cannot set a reviewer');
SELECT public.t_assert((SELECT count(*) FROM public.vehicle_user_permissions WHERE user_id='20000000-0000-0000-0000-0000000000c1' AND is_active) = 0, 'after: still no owner grant for the claimant');
RESET ROLE;

-- 4. An active admin approves the pending claim, and the trigger grants owner.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000d1';
SELECT public.t_assert(public.t_rows($q$UPDATE public.ownership_verifications SET status='approved', approved_at=now(), human_reviewer_id='20000000-0000-0000-0000-0000000000d1', human_reviewed_at=now() WHERE id='50000000-0000-0000-0000-000000000001'$q$) = 1, 'admin: approves the claim');
SELECT public.t_assert((SELECT count(*) FROM public.vehicle_user_permissions
    WHERE vehicle_id='10000000-0000-0000-0000-000000000001' AND user_id='20000000-0000-0000-0000-0000000000c1'
      AND role='owner' AND is_active) = 1, 'admin: the trigger granted the claimant owner on approval');
RESET ROLE;

-- 5. A signed-in stranger cannot file a claim as someone else.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f9';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, title_document_url, drivers_license_url)
  VALUES ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000002', 'pending', 'https://x/t.jpg', 'https://x/d.jpg')$q$),
  'stranger: cannot file a claim for another user');
RESET ROLE;

-- 6. The service role still writes freely (it approves through the edge path).
SET ROLE service_role;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, title_document_url, drivers_license_url)
    VALUES ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000003', 'approved', 'https://x/t.jpg', 'https://x/d.jpg')$q$) = 1, 'service role: inserts an approved verification');
RESET ROLE;

SELECT 'ownership verifications arrive pending contract: all checks passed' AS result;
