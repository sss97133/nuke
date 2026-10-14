-- Empty disposable PG17 only. Run by scripts/ci/run-db-contracts.sh (db-contracts job) in dm_refinement_*.
-- Proves that after 20261014230000_vehicle_contributors_no_self_grant.sql a signed-in account can no longer grant
-- itself access to a vehicle it does not own by self-inserting a vehicle_contributors row: an active/privileged
-- self-insert is refused on a non-owned vehicle (allowed only as a non-granting 'pending' claim), the hardcoded-uuid
-- back door is gone, while a vehicle's owner still self-assigns active roles and the service role is unaffected.
-- Loads the live policies (helpers/vehicle_contributors_live_20261014.sql) and the live evidence trigger, and shows
-- the two-step self-grant (upload image, then insert) working before.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_contributors') IS NOT NULL THEN
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
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='vc_owner') THEN CREATE ROLE vc_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, vc_owner;
GRANT CREATE ON SCHEMA public TO vc_owner;

SET ROLE vc_owner;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, uploaded_by uuid, created_by_user_id uuid, is_public boolean DEFAULT true);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, documented_by_user_id uuid);
CREATE TABLE public.vehicle_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, user_id uuid, role text, start_date date DEFAULT CURRENT_DATE, end_date date, notes text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), status text DEFAULT 'active',
  can_edit boolean DEFAULT true, can_delete boolean DEFAULT false, can_approve boolean DEFAULT false,
  can_sell boolean DEFAULT false, organization_id uuid
);
ALTER TABLE public.vehicle_contributors ENABLE ROW LEVEL SECURITY;
\ir helpers/vehicle_contributors_live_20261014.sql
-- The live evidence trigger: a contributor row needs a vehicle_images row for (vehicle_id, user_id).
CREATE FUNCTION public.enforce_contributor_evidence() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.vehicle_id = NEW.vehicle_id
                 AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)) THEN
    RAISE EXCEPTION 'Cannot add contributor without photo evidence on this vehicle';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_enforce_contributor_evidence BEFORE INSERT ON public.vehicle_contributors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contributor_evidence();
-- vehicle_user_has_access, the contributor branch the money reader trusts (status active + an access role).
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id = p_vehicle AND vc.user_id = p_user
                 AND vc.status = 'active'
                 AND vc.role = ANY (ARRAY['owner','restorer','moderator','consigner','mechanic','appraiser','photographer','sales_agent'])) $fn$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles, public.vehicle_images, public.vehicle_contributors TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_user_has_access(uuid, uuid) TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text), public.t_rows(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_policy_hash() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(string_agg(
           p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
  FROM pg_policy p WHERE p.polrelid = 'public.vehicle_contributors'::regclass $$;

-- Seeds. Vehicle V1 owned by O1. Attacker X9. The hardcoded back-door account H. Attacker and H each have an image
-- on V1 (so the evidence trigger passes), as the open image-upload path allows.
INSERT INTO public.vehicles (id, owner_id) VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1');
INSERT INTO public.vehicle_images (vehicle_id, user_id) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9'),
 ('10000000-0000-0000-0000-000000000001', '0b9f107a-d124-49de-9ded-94698f63c1c4'),
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1'),
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b2');

-- 0. Fixture is the live policy set.
SELECT public.t_assert(public.t_policy_hash() = '2GGlz5/MpLrgQvC04ODQJg+PHrOS3bkWptq9dx20eNE=', 'fixture: policies as live');

-- 1. Before: the attacker self-inserts an active owner row on a vehicle it does not own and gains access; and any
--    caller can insert a row as the hardcoded account.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
BEGIN;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'owner', 'active')$q$) = 1, 'before: attacker self-inserts active owner');
SELECT public.t_assert(public.vehicle_user_has_access('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9'), 'before: attacker now has vehicle access');
ROLLBACK;
BEGIN;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status)
  VALUES ('10000000-0000-0000-0000-000000000001', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'owner', 'active')$q$) = 1, 'before: a caller inserts a row as the hardcoded account');
ROLLBACK;
RESET ROLE;

-- 2. Apply the migration as the table owner, twice.
SET test.auth_uid = '';
SET ROLE vc_owner;
\ir ../migrations/20261014230000_vehicle_contributors_no_self_grant.sql
\ir ../migrations/20261014230000_vehicle_contributors_no_self_grant.sql
RESET ROLE;

-- 3. After: the attacker cannot self-insert an active/privileged row on a non-owned vehicle; a 'pending' claim is
--    allowed but grants no access; the hardcoded back door is gone.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'owner', 'active')$q$), 'after: attacker active owner self-insert refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status, can_edit)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'photographer', 'pending', true)$q$), 'after: a pending row with can_edit refused');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status, can_edit)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'photographer', 'pending', false)$q$) = 1, 'after: a non-granting pending claim is allowed');
SELECT public.t_assert(NOT public.vehicle_user_has_access('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9'), 'after: the pending claim grants no access');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status)
  VALUES ('10000000-0000-0000-0000-000000000001', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'owner', 'active')$q$), 'after: the hardcoded-account back door is gone');
-- the attacker cannot raise their own pending claim to active either
SELECT public.t_assert(public.t_refused($q$UPDATE public.vehicle_contributors SET status='active', role='owner'
  WHERE vehicle_id='10000000-0000-0000-0000-000000000001' AND user_id='20000000-0000-0000-0000-0000000000e9'$q$), 'after: attacker cannot self-update the claim to active');
RESET ROLE;

-- 4. The vehicle's owner self-assigns an active role on their own vehicle (they already have access).
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', 'owner', 'active')$q$) = 1, 'owner: self-assigns an active role on their own vehicle');
SELECT public.t_assert(public.vehicle_user_has_access('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1'), 'owner: has access');
RESET ROLE;

-- 5. The service role still inserts freely.
SET ROLE service_role;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b2', 'mechanic', 'active')$q$) = 1, 'service role: inserts an active role');
RESET ROLE;

SELECT 'vehicle_contributors no self-grant contract: all checks passed' AS result;
