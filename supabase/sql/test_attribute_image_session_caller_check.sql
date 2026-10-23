-- Disposable PG17 only. Random ids, synthetic rows, production's function chain on live's shapes: live's
-- attribute_image_session, user_can_edit_vehicle and attribute_testimony (md5s read 2026-10-20).
-- Proves 20261021150000_attribute_image_session_caller_check.sql. Before it, a signed-in account files its own unfiled
-- photo onto a vehicle it cannot edit and confirms its work session there. After it, that account, a contributor
-- without can_edit, an editor naming another p_owner, a null vehicle, a JWT without a user and anon get 42501 and no
-- row changes; the owner and a contributor with can_edit file as before (gate approved, one audit row, a duplicate
-- marked, the owner's session that day confirmed); service_role and a session without a JWT are unchanged; only the
-- check was added; SECURITY DEFINER, search_path, volatility and the EXECUTE grants are live's; re-applying is a
-- no-op; the guard refuses a body it has not reviewed.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- auth.uid() and auth.role() as live defines them.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Live shapes read 2026-10-20: both enums with their labels, and the columns the three functions read and set.
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','rejected_personal','rejected_misattributed','review_needed');
CREATE TYPE public.content_approval_status AS ENUM ('pending','auto_approved','approved','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, uploaded_by uuid, user_id uuid, owner_id uuid);
CREATE TABLE public.vehicle_contributors(vehicle_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL,
  status text DEFAULT 'active', can_edit boolean DEFAULT true);
CREATE TABLE public.vehicle_contributor_roles(vehicle_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL,
  end_date date);
CREATE TABLE public.organization_vehicles(organization_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  status text DEFAULT 'active');
CREATE TABLE public.organization_contributors(organization_id uuid NOT NULL, user_id uuid, role text NOT NULL,
  status text DEFAULT 'active');
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz,
  file_hash text, is_primary boolean DEFAULT false, is_document boolean DEFAULT false, is_duplicate boolean DEFAULT false,
  is_sensitive boolean NOT NULL DEFAULT false, vision_gate_status public.vision_gate_status DEFAULT 'pending',
  is_approved boolean DEFAULT true, approval_status public.content_approval_status NOT NULL DEFAULT 'pending',
  updated_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.reattribution_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_type text NOT NULL,
  old_observation_id uuid NOT NULL, old_vehicle_id uuid, new_observation_id uuid NOT NULL, new_vehicle_id uuid,
  reason text NOT NULL, actor_user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY, user_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  session_date date NOT NULL, owner_confirmed_at timestamptz, owner_confirmed_by uuid,
  updated_at timestamptz DEFAULT now());
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_sqlstate(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_sqlstate(text) TO anon, authenticated, service_role;
-- Every row the filer can write, as one fingerprint.
CREATE FUNCTION public.t_rows() RETURNS text LANGUAGE sql AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(i::text, ',' ORDER BY i.id) FROM public.vehicle_images i),
    (SELECT string_agg(w::text, ',' ORDER BY w.id) FROM public.work_sessions w),
    (SELECT string_agg(a::text, ',' ORDER BY a.id) FROM public.reattribution_audit a))) $$;

-- user_can_edit_vehicle: 20251201000002 holds live's body; live's search_path and grants on top.
\ir ../migrations/20251201000002_fix_user_can_edit_vehicle_function.sql
ALTER FUNCTION public.user_can_edit_vehicle(uuid, uuid) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.user_can_edit_vehicle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_edit_vehicle(uuid, uuid) TO authenticated, service_role;
SELECT t_assert((SELECT md5(prosrc) = '73bef5009e56d9ad7337db1fee9c1ab5' -- gitleaks:allow (function-definition fingerprint, not a secret)
    AND prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public, pg_temp']
  FROM pg_proc WHERE oid = 'public.user_can_edit_vehicle(uuid,uuid)'::regprocedure),
  'user_can_edit_vehicle is production''s (md5 and settings read 2026-10-20)');

-- attribute_testimony as production runs it: the body recorded in 20261018201500, then #2381's cast fix. That file also
-- defines seven functions over tables this fixture lacks, so bodies are not checked while it loads (as in a restore).
SET check_function_bodies = off;
\ir ../migrations/20261018201500_org_chronology_session_confirm_functions.sql
RESET check_function_bodies;
\ir ../migrations/20261021140000_fix_attribute_testimony_gate_cast.sql
SELECT t_assert((SELECT md5(prosrc) FROM pg_proc
    WHERE oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure)
  = '7492c54c97880e31123dcd49d56b0f9c', 'attribute_testimony is production''s (md5 read 2026-10-20)'); -- gitleaks:allow (function-definition fingerprint, not a secret)

-- attribute_image_session as live defines it (pg_get_functiondef and proacl, 2026-10-20); no migration holds it.
CREATE FUNCTION public.attribute_image_session(p_image_ids uuid[], p_vehicle_id uuid, p_owner uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'owner_session_confirm'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid := COALESCE(auth.uid(), p_owner);
  r record;
  res jsonb;
  n int := 0;
BEGIN
  FOR r IN
    SELECT id, (taken_at)::date AS sday
    FROM vehicle_images
    WHERE id = ANY(p_image_ids)
      AND user_id = v_owner
      AND vehicle_id IS NULL
  LOOP
    res := attribute_testimony('image', r.id, p_vehicle_id, p_reason, v_owner, 1.0, 'owner_session_confirm');
    IF (res->>'success')::boolean THEN
      n := n + 1;
    ELSIF res->>'error' = 'file_hash_exists_on_target' THEN
      UPDATE vehicle_images SET is_duplicate = true, updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;

  -- Also auto-confirm any matching work_sessions rows for the dates covered by these images
  IF p_vehicle_id IS NOT NULL AND n > 0 THEN
    UPDATE public.work_sessions ws
       SET owner_confirmed_at = COALESCE(ws.owner_confirmed_at, now()),
           owner_confirmed_by = COALESCE(ws.owner_confirmed_by, v_owner),
           updated_at = now()
     WHERE ws.user_id = v_owner
       AND ws.vehicle_id = p_vehicle_id
       AND ws.owner_confirmed_at IS NULL
       AND ws.session_date IN (
         SELECT DISTINCT (vi.taken_at)::date
         FROM public.vehicle_images vi
         WHERE vi.id = ANY(p_image_ids)
           AND vi.taken_at IS NOT NULL
       );
  END IF;

  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.attribute_image_session(uuid[], uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attribute_image_session(uuid[], uuid, uuid, text) TO authenticated, service_role;
SELECT md5(prosrc) AS before_md5, prosrc AS before_src, proacl::text AS before_acl FROM pg_proc
 WHERE oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure \gset
SELECT t_assert(:'before_md5' = '4dcd5577fb9166c75084f7a6525bc1d9', 'the body is production''s (md5 read 2026-10-20)'); -- gitleaks:allow (function-definition fingerprint, not a secret)
SELECT t_assert(:'before_acl' = format('{%1$s=X/%1$s,authenticated=X/%1$s,service_role=X/%1$s}', current_user),
  'the ACL is production''s: owner, authenticated and service_role');

-- An owner, a contributor with can_edit, one without (a photographer) and a stranger; one vehicle the owner holds
-- with one photo on it; each account's unfiled photos from one day; work sessions on that vehicle.
SELECT gen_random_uuid() AS owner, gen_random_uuid() AS editor, gen_random_uuid() AS photographer,
       gen_random_uuid() AS stranger, gen_random_uuid() AS vehicle \gset
SELECT gen_random_uuid() AS kept, gen_random_uuid() AS o1, gen_random_uuid() AS o2, gen_random_uuid() AS e1,
       gen_random_uuid() AS p1, gen_random_uuid() AS s1, gen_random_uuid() AS s2 \gset
SELECT gen_random_uuid() AS ws_owner_d1, gen_random_uuid() AS ws_owner_d2, gen_random_uuid() AS ws_stranger_d1 \gset
INSERT INTO vehicles(id, user_id) VALUES (:'vehicle', :'owner');
INSERT INTO vehicle_contributors(vehicle_id, user_id, role, status, can_edit) VALUES
  (:'vehicle', :'editor', 'contributor', 'active', true),
  (:'vehicle', :'photographer', 'photographer', 'active', false);
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, file_hash) VALUES
  (:'kept', :'owner', :'vehicle', '2026-10-01 15:00Z', 'hash-kept'),
  (:'o1', :'owner', NULL, '2026-10-01 16:00Z', 'hash-o1'),
  (:'o2', :'owner', NULL, '2026-10-01 16:05Z', 'hash-kept'),
  (:'e1', :'editor', NULL, '2026-10-01 17:00Z', 'hash-e1'),
  (:'p1', :'photographer', NULL, '2026-10-01 17:30Z', 'hash-p1'),
  (:'s1', :'stranger', NULL, '2026-10-01 18:00Z', 'hash-s1'),
  (:'s2', :'stranger', NULL, '2026-10-01 18:05Z', 'hash-s2');
INSERT INTO work_sessions(id, user_id, vehicle_id, session_date) VALUES
  (:'ws_owner_d1', :'owner', :'vehicle', '2026-10-01'),
  (:'ws_owner_d2', :'owner', :'vehicle', '2026-10-02'),
  (:'ws_stranger_d1', :'stranger', :'vehicle', '2026-10-01');
SELECT json_build_object('sub', :'owner', 'role', 'authenticated') AS owner_jwt,
       json_build_object('sub', :'editor', 'role', 'authenticated') AS editor_jwt,
       json_build_object('sub', :'photographer', 'role', 'authenticated') AS photographer_jwt,
       json_build_object('sub', :'stranger', 'role', 'authenticated') AS stranger_jwt \gset
SELECT t_assert(user_can_edit_vehicle(:'vehicle', :'owner') AND user_can_edit_vehicle(:'vehicle', :'editor')
  AND NOT user_can_edit_vehicle(:'vehicle', :'photographer') AND NOT user_can_edit_vehicle(:'vehicle', :'stranger'),
  'the owner and the editor can edit the vehicle; the photographer and the stranger cannot');

-- 1. Before: the stranger files its own photo onto the vehicle, approved, and confirms its own session there.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = :'stranger_jwt';
SELECT public.attribute_image_session(ARRAY[:'s1']::uuid[], :'vehicle') AS before_n \gset
RESET ROLE;
SELECT (SELECT vehicle_id = :'vehicle' AND vision_gate_status = 'approved' FROM vehicle_images WHERE id = :'s1')
   AND (SELECT owner_confirmed_by = :'stranger' FROM work_sessions WHERE id = :'ws_stranger_d1') AS before_open \gset
ROLLBACK;
SELECT t_assert(:before_n = 1 AND :'before_open'::boolean,
  'before: an account that cannot edit the vehicle files its photo there and confirms its session');
SELECT t_rows() AS rows_clean \gset

-- 2. The migration.
\ir ../migrations/20261021150000_attribute_image_session_caller_check.sql
SELECT prosrc AS after_src FROM pg_proc
 WHERE oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure \gset

-- 3. After: refused with 42501, and no row changes.
SELECT format('SELECT public.attribute_image_session(ARRAY[%L]::uuid[], %L)', :'s1', :'vehicle') AS stranger_q,
       format('SELECT public.attribute_image_session(ARRAY[%L]::uuid[], %L)', :'p1', :'vehicle') AS photographer_q,
       format('SELECT public.attribute_image_session(ARRAY[%L]::uuid[], %L, %L)', :'o1', :'vehicle', :'stranger')
         AS other_owner_q,
       format('SELECT public.attribute_image_session(ARRAY[%L]::uuid[], NULL)', :'o1') AS null_vehicle_q,
       format('SELECT public.attribute_image_session(ARRAY[%L]::uuid[], %L)', :'o1', :'vehicle') AS owner_q \gset
SET ROLE authenticated;
SET request.jwt.claims = :'stranger_jwt';
SELECT t_sqlstate(:'stranger_q') AS stranger_state \gset
SET request.jwt.claims = :'photographer_jwt';
SELECT t_sqlstate(:'photographer_q') AS photographer_state \gset
SET request.jwt.claims = :'owner_jwt';
SELECT t_sqlstate(:'other_owner_q') AS other_owner_state, t_sqlstate(:'null_vehicle_q') AS null_vehicle_state \gset
SET request.jwt.claims = '{"role": "authenticated"}';
SELECT t_sqlstate(:'owner_q') AS no_user_state \gset
SET ROLE anon;
SET request.jwt.claims = '{"role": "anon"}';
SELECT t_sqlstate(:'owner_q') AS anon_state \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT t_assert(:'stranger_state' = '42501', 'after: an account that cannot edit the vehicle is refused with 42501');
SELECT t_assert(:'photographer_state' = '42501', 'after: a contributor without can_edit is refused');
SELECT t_assert(:'other_owner_state' = '42501', 'after: an editor naming another account as p_owner is refused');
SELECT t_assert(:'null_vehicle_state' = '42501', 'after: a null vehicle is refused');
SELECT t_assert(:'no_user_state' = '42501', 'after: a JWT without a user is refused');
SELECT t_assert(:'anon_state' = '42501', 'after: anon still cannot execute it');
SELECT t_assert(t_rows() = :'rows_clean', 'after: the refused calls changed no row');

-- 4. The owner and a contributor with can_edit file as before.
SET ROLE authenticated;
SET request.jwt.claims = :'owner_jwt';
SELECT public.attribute_image_session(ARRAY[:'o1', :'o2']::uuid[], :'vehicle') AS owner_n \gset
SET request.jwt.claims = :'editor_jwt';
SELECT public.attribute_image_session(ARRAY[:'e1']::uuid[], :'vehicle') AS editor_n \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT t_assert(:owner_n = 1 AND (SELECT (vehicle_id, vision_gate_status, is_approved, approval_status)
    = (:'vehicle'::uuid, 'approved'::public.vision_gate_status, true, 'approved'::public.content_approval_status)
  FROM vehicle_images WHERE id = :'o1'), 'the owner files its photo and the gate is approved');
SELECT t_assert((SELECT vehicle_id IS NULL AND is_duplicate FROM vehicle_images WHERE id = :'o2')
  AND NOT EXISTS (SELECT FROM reattribution_audit WHERE old_observation_id = :'o2'),
  'a photo whose content is already on the vehicle is marked duplicate, not filed');
SELECT t_assert((SELECT count(*) FROM reattribution_audit WHERE old_observation_id = :'o1' AND old_vehicle_id IS NULL
    AND new_vehicle_id = :'vehicle' AND actor_user_id = :'owner'
    AND reason = 'first_attribution: owner_session_confirm; confidence=1.0; signal=owner_session_confirm') = 1,
  'the filing writes one first_attribution audit row as the owner');
SELECT t_assert((SELECT owner_confirmed_at IS NOT NULL AND owner_confirmed_by = :'owner' FROM work_sessions
    WHERE id = :'ws_owner_d1')
  AND (SELECT owner_confirmed_at IS NULL FROM work_sessions WHERE id = :'ws_owner_d2')
  AND (SELECT owner_confirmed_at IS NULL FROM work_sessions WHERE id = :'ws_stranger_d1'),
  'the owner''s session that day is confirmed; another day and another account''s session are not');
SELECT t_assert(:editor_n = 1 AND (SELECT vehicle_id = :'vehicle' FROM vehicle_images WHERE id = :'e1'),
  'a contributor with can_edit files its photo');

-- 5. service_role and a session without a JWT are unchanged: they file p_owner's photos.
SET ROLE service_role;
SET request.jwt.claims = '{"role": "service_role"}';
SELECT public.attribute_image_session(ARRAY[:'s1']::uuid[], :'vehicle', :'stranger') AS service_n \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT public.attribute_image_session(ARRAY[:'s2']::uuid[], :'vehicle', :'stranger') AS no_jwt_n \gset
SELECT t_assert(:service_n = 1 AND :no_jwt_n = 1
  AND (SELECT count(*) = 2 FROM vehicle_images WHERE id IN (:'s1', :'s2') AND vehicle_id = :'vehicle'),
  'service_role and a session without a JWT file p_owner''s photos as before');

-- 6. Only the check was added, ahead of the loop; SECURITY DEFINER, search_path, volatility and the grants are live's.
SELECT t_assert(md5(:'after_src') = '71fcd7a07d7660b71ec654544dd6f970' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND overlay(:'after_src' PLACING '' FROM position('  -- Caller check' IN :'after_src')
              FOR position('  FOR r IN' IN :'after_src') - position('  -- Caller check' IN :'after_src')) = :'before_src',
  'the body is live''s with only the caller check inserted ahead of the loop');
SELECT t_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public'] AND p.provolatile = 'v'
    AND l.lanname = 'plpgsql' AND p.proacl::text = :'before_acl'
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure),
  'still SECURITY DEFINER, search_path public, VOLATILE plpgsql, with live''s ACL');
SELECT t_assert(NOT has_function_privilege('anon', 'public.attribute_image_session(uuid[],uuid,uuid,text)', 'EXECUTE')
  AND NOT EXISTS (SELECT FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure AND a.grantee = 0),
  'neither anon nor PUBLIC can execute it');

-- 7. Re-applying is a no-op; a body the guard has not reviewed is refused and left as it is.
\ir ../migrations/20261021150000_attribute_image_session_caller_check.sql
SELECT t_assert((SELECT prosrc FROM pg_proc
    WHERE oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure) = :'after_src',
  're-applying the migration is a no-op');
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure),
                  'RETURN n;', 'RETURN n + 0;');
END $$;
\echo 'Expected next: the guard refuses a drifted body (its ERROR, then the aborted transaction''s).'
\set ON_ERROR_STOP off
\ir ../migrations/20261021150000_attribute_image_session_caller_check.sql
\set ON_ERROR_STOP on
SELECT t_assert((SELECT prosrc LIKE '%RETURN n + 0;%' FROM pg_proc
    WHERE oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure),
  'the guard refuses a body it has not reviewed and leaves it as it is');
SELECT 'attribute_image_session caller check contract: PASS' AS result;
