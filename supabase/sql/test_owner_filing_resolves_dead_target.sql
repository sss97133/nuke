-- Contract: 20261122004500. attribute_image_session (the owner's "these photos are this car" writer) files onto the
-- record that stands, as vehicle_merge_terminal resolves it: a target merged into another record files onto the end of
-- its merge chain (up to nine hops), and a target that is missing or removed, whose status says deleted or merged,
-- whose chain loops or runs longer, or whose merge is held for an un-merge, is refused with 42501 and writes nothing.
-- Every later step (the caller check, attribute_testimony and its audit row, the work-session rule) uses the standing
-- record. A standing target and a null target behave exactly as before.
-- Disposable PG17 only, synthetic rows only (every account and car is made up; the one held-merge record takes its id
-- from the installed resolver's own hold list, read at run time). attribute_image_session is installed as production's
-- body of 2026-11-21 by the revert file (a function that is absent is created); attribute_testimony and
-- user_can_edit_vehicle are production's, loaded as the caller-check contract loads them; vehicle_merge_terminal is
-- production's, read out of its migration.
-- Checked: the same calls on standing targets give the same rows, audit rows, work sessions, return values and errors
-- under the earlier body and the new one (each run in a transaction that is rolled back); the merge cases; each refusal
-- writes nothing (row counts before and after); owner, grants, security, volatility and SET clause do not move; a
-- replay is a no-op; a moved body is refused by the migration and by the revert; the revert restores the earlier body
-- and its behaviour; a re-apply from the reverted state.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- auth.uid() and auth.role() as live defines them (the caller-check contract's copies).
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ===== fixture tables: live's enums and the columns the filer, attribute_testimony and user_can_edit_vehicle read and write
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','rejected_personal','rejected_misattributed','review_needed');
CREATE TYPE public.content_approval_status AS ENUM ('pending','auto_approved','approved','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, owner_id uuid, user_id uuid, uploaded_by uuid, deleted_at timestamptz,
  merged_into_vehicle_id uuid, status text DEFAULT 'active');
CREATE TABLE public.vehicle_contributors(vehicle_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL,
  status text DEFAULT 'active', can_edit boolean DEFAULT true);
CREATE TABLE public.vehicle_contributor_roles(vehicle_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, end_date date);
CREATE TABLE public.organization_vehicles(organization_id uuid NOT NULL, vehicle_id uuid NOT NULL, status text DEFAULT 'active');
CREATE TABLE public.organization_contributors(organization_id uuid NOT NULL, user_id uuid, role text NOT NULL, status text DEFAULT 'active');
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz,
  is_document boolean DEFAULT false, is_duplicate boolean DEFAULT false, is_superseded boolean,
  is_sensitive boolean NOT NULL DEFAULT false, vision_gate_status public.vision_gate_status DEFAULT 'pending',
  file_hash text, is_primary boolean DEFAULT false, is_approved boolean DEFAULT true,
  approval_status public.content_approval_status NOT NULL DEFAULT 'pending', updated_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.reattribution_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_type text NOT NULL,
  old_observation_id uuid NOT NULL, old_vehicle_id uuid, new_observation_id uuid NOT NULL, new_vehicle_id uuid,
  reason text NOT NULL, actor_user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  session_date date, owner_confirmed_at timestamptz, owner_confirmed_by uuid, updated_at timestamptz DEFAULT now());

-- user_can_edit_vehicle and attribute_testimony exactly as the caller-check contract installs them (production's md5s).
\ir ../migrations/20251201000002_fix_user_can_edit_vehicle_function.sql
ALTER FUNCTION public.user_can_edit_vehicle(uuid, uuid) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.user_can_edit_vehicle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_edit_vehicle(uuid, uuid) TO authenticated, service_role;
SET check_function_bodies = off;
\ir ../migrations/20261018201500_org_chronology_session_confirm_functions.sql
RESET check_function_bodies;
\ir ../migrations/20261021140000_fix_attribute_testimony_gate_cast.sql
SELECT public.t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.user_can_edit_vehicle(uuid,uuid)'::regprocedure)
    = '73bef5009e56d9ad7337db1fee9c1ab5' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure)
    = '7492c54c97880e31123dcd49d56b0f9c', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'fixture: user_can_edit_vehicle and attribute_testimony are production''s bodies');
-- vehicle_merge_terminal exactly as 20261017021000 defines it, with production's grants (proacl read 2026-11-21)
\set merge_terminal `sed -n '/^CREATE OR REPLACE FUNCTION public.vehicle_merge_terminal(/,/^\$function\$;/p' supabase/migrations/20261017021000_device_evidence_files_photos_and_profiles.sql`
SELECT :'merge_terminal' \gexec
REVOKE ALL ON FUNCTION public.vehicle_merge_terminal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_merge_terminal(uuid) TO service_role;
SELECT public.t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_merge_terminal(uuid)'::regprocedure)
    = 'ea951b178e03e6c1e032503f7c3a9526', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'fixture: vehicle_merge_terminal is production''s body');
SELECT substring(prosrc FROM 'c_held_merges CONSTANT uuid\[\] := ARRAY\[''([0-9a-f-]{36})''') AS held
  FROM pg_proc WHERE oid = 'public.vehicle_merge_terminal(uuid)'::regprocedure \gset
SELECT public.t_assert(:'held' ~ '^[0-9a-f-]{36}$', 'fixture: the resolver''s held merge is read from its body');

-- ===== production's body of the filer, installed by the revert file, then production's grants (proacl read 2026-11-21)
\ir revert_20261122004500_owner_filing_resolves_dead_target.sql
REVOKE ALL ON FUNCTION public.attribute_image_session(uuid[], uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attribute_image_session(uuid[], uuid, uuid, text) TO authenticated, service_role;
CREATE FUNCTION public.t_md5() RETURNS text LANGUAGE sql AS $$
  SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.attribute_image_session(uuid[],uuid,uuid,text)') $$;
-- Everything about the function except its body: the migration and the revert must leave all of it as it is.
CREATE FUNCTION public.t_attrs() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|', p.oid::regprocedure::text, pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, p.proconfig,
           p.proacl, p.proretset, p.prolang, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.attribute_image_session(uuid[],uuid,uuid,text)') $$;
CREATE TABLE public.t_pins AS SELECT public.t_attrs() AS attrs;
\set was '734210d4b21dda0e02768d8fd4c680d7'
\set becomes '2fd530986f2291a6afd239aa1d55e5d8'
SELECT public.t_assert(public.t_md5() = :'was', 'fixture: the filer is production''s body of 2026-11-21');
SELECT public.t_assert((SELECT prosecdef FROM pg_proc WHERE oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure)
  AND has_function_privilege('authenticated', 'public.attribute_image_session(uuid[],uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.attribute_image_session(uuid[],uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.attribute_image_session(uuid[],uuid,uuid,text)', 'EXECUTE'),
  'fixture: SECURITY DEFINER with production''s grants');

-- ===== rows. The owner U, a stranger S. Car t_car(nn), photo t_img(nn) (the owner's, unfiled unless said).
CREATE FUNCTION public.t_car(nn text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('c0000000-0000-4000-8000-0000000000' || nn)::uuid $$;
CREATE FUNCTION public.t_img(nn text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a0000000-0000-4000-8000-0000000000' || nn)::uuid $$;
\set U '''00000000-0000-4000-8000-0000000000aa'''
\set S '''00000000-0000-4000-8000-0000000000bb'''
-- car(nn, owner, removed, merged into)
CREATE FUNCTION public.t_mkcar(nn text, p_owner uuid, p_removed boolean, p_into text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicles(id, owner_id, user_id, uploaded_by, deleted_at, merged_into_vehicle_id, status)
  VALUES (public.t_car(nn), p_owner, p_owner, p_owner, CASE WHEN p_removed THEN '2026-06-01 00:00+00'::timestamptz END,
          CASE WHEN p_into IS NOT NULL THEN public.t_car(p_into) END, CASE WHEN p_into IS NOT NULL THEN 'merged' ELSE 'active' END) $$;
-- photo(nn, taken on day d of November, file hash, on car)
CREATE FUNCTION public.t_mkimg(nn text, d int, p_hash text, p_on text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images(id, user_id, vehicle_id, taken_at, file_hash, vision_gate_status)
  VALUES (public.t_img(nn), '00000000-0000-4000-8000-0000000000aa', CASE WHEN p_on IS NOT NULL THEN public.t_car(p_on) END,
          make_timestamptz(2026, 11, d, 20, 0, 0, 'UTC'), p_hash, CASE WHEN p_on IS NOT NULL THEN 'approved' ELSE 'pending' END::public.vision_gate_status) $$;
-- an unconfirmed work session of the owner on car nn, on the local day of November d
CREATE FUNCTION public.t_mkws(nn text, d int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.work_sessions(user_id, vehicle_id, session_date) VALUES ('00000000-0000-4000-8000-0000000000aa', public.t_car(nn), make_date(2026, 11, d)) $$;

-- standing targets (the cases that must not change): 01, 02, 03 the owner's, 04 the stranger's
SELECT public.t_mkcar('01', :U, false, NULL), public.t_mkcar('02', :U, false, NULL), public.t_mkcar('03', :U, false, NULL),
       public.t_mkcar('04', :S, false, NULL);
SELECT public.t_mkimg('01', 1, NULL, NULL),  -- signed-in, session confirm onto 01 (signs 01's session of the 1st)
       public.t_mkimg('02', 2, NULL, NULL),  -- signed-in, ledger answer onto 02 (02's session of the 2nd stays unsigned)
       public.t_mkimg('03', 3, NULL, NULL),  -- service role naming the owner onto 02 (signs 02's session of the 3rd)
       public.t_mkimg('04', 4, 'h04', NULL), -- signed-in onto 03 where the same content already sits: marked duplicate
       public.t_mkimg('0e', 4, 'h04', '03'),
       public.t_mkimg('05', 5, NULL, NULL),  -- signed-in onto the stranger's 04: refused
       public.t_mkimg('06', 6, NULL, NULL),  -- signed-in with no target: refused
       public.t_mkimg('07', 7, NULL, NULL),  -- service role with no target: attribute_testimony's error
       public.t_mkimg('08', 8, NULL, NULL),  -- no JWT naming the owner onto 01
       public.t_mkimg('09', 9, NULL, NULL);  -- the stranger onto 01: refused
SELECT public.t_mkws('01', 1), public.t_mkws('02', 2), public.t_mkws('02', 3);

-- records that no longer stand
SELECT public.t_mkcar('11', :U, false, NULL), public.t_mkcar('10', :U, true, '11');          -- 10 merged into 11
SELECT public.t_mkcar('14', :U, false, NULL), public.t_mkcar('13', :U, true, '14'), public.t_mkcar('12', :U, true, '13');  -- 12 -> 13 -> 14
SELECT public.t_mkcar(to_hex(32 + i), :U, i < 8, CASE WHEN i < 8 THEN to_hex(33 + i) END) FROM generate_series(0, 8) i;    -- 20 -> ... -> 28 (8 hops)
SELECT public.t_mkcar(to_hex(48 + i), :U, i < 9, CASE WHEN i < 9 THEN to_hex(49 + i) END) FROM generate_series(0, 9) i;    -- 30 -> ... -> 39 (9 hops)
SELECT public.t_mkcar('40', :U, true, '41'), public.t_mkcar('41', :U, true, '40');         -- a loop
SELECT public.t_mkcar('42', :U, true, '42');                                               -- a record merged into itself
SELECT public.t_mkcar('50', :U, true, NULL);                                               -- removed
SELECT public.t_mkcar('52', :U, true, NULL), public.t_mkcar('51', :U, true, '52');         -- merged into a removed record
SELECT public.t_mkcar('54', :S, false, NULL), public.t_mkcar('53', :U, true, '54');        -- merged into the stranger's record
SELECT public.t_mkcar('56', :U, false, NULL), public.t_mkcar('55', :U, false, '56');       -- merged, deleted_at never set
SELECT public.t_mkcar(to_hex(96 + i), :U, i < 10, CASE WHEN i < 10 THEN to_hex(97 + i) END) FROM generate_series(0, 10) i; -- 60 -> ... -> 6a (10 hops)
SELECT public.t_mkcar('57', :U, false, NULL);                                              -- a standing car the held merge points at
INSERT INTO public.vehicles(id, owner_id, user_id, uploaded_by, deleted_at, merged_into_vehicle_id, status)
  VALUES (:'held', :U, :U, :U, '2026-06-01 00:00+00', public.t_car('57'), 'merged');       -- a merge held for an un-merge
SELECT public.t_mkcar('58', :U, false, NULL), public.t_mkcar('59', :U, false, NULL);
UPDATE public.vehicles SET status = CASE id WHEN public.t_car('58') THEN 'merged' ELSE 'deleted' END
 WHERE id IN (public.t_car('58'), public.t_car('59'));                                     -- status says merged / deleted, no other mark
-- 4f has no row
SELECT public.t_mkimg(nn, 10, NULL, NULL)
  FROM unnest(ARRAY['10','11','12','13','14','15','16','17','18','19','1a','1b','1c','1d','1e','20','21','22','23','24']) nn;
SELECT public.t_mkimg('1f', 11, NULL, NULL);
SELECT public.t_mkws('10', 10), public.t_mkws('11', 10), public.t_mkws('11', 11);

-- One call to the filer as an account: U or S signed in, 'service' (service role naming p_owner), 'none' (no JWT).
-- Returns n=<photos filed> or err=<sqlstate>:<message>. Role and claims are set for the call and reset after it.
CREATE FUNCTION public.t_call(p_as text, p_img text, p_car text, p_owner uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v int; v_car uuid := CASE WHEN p_car IS NOT NULL THEN public.t_car(p_car) END; v_out text;
BEGIN
  IF p_as IN ('U', 'S') THEN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
      CASE p_as WHEN 'U' THEN '00000000-0000-4000-8000-0000000000aa' ELSE '00000000-0000-4000-8000-0000000000bb' END)::text, true);
  ELSIF p_as = 'service' THEN
    PERFORM set_config('role', 'service_role', true);
    PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  END IF;
  BEGIN
    IF p_reason IS NULL THEN v := public.attribute_image_session(ARRAY[public.t_img(p_img)], v_car, p_owner);
    ELSE v := public.attribute_image_session(ARRAY[public.t_img(p_img)], v_car, p_owner, p_reason); END IF;
    v_out := 'n=' || v;
  EXCEPTION WHEN OTHERS THEN v_out := 'err=' || SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_out;
END $$;
-- What the filer wrote: photos, audit rows and work sessions, timestamps reduced to set / not set.
CREATE FUNCTION public.t_snap() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(E'\n',
    (SELECT string_agg(concat_ws('/', id, coalesce(vehicle_id::text, '-'), is_primary, vision_gate_status, is_approved, approval_status, is_duplicate), ',' ORDER BY id)
       FROM public.vehicle_images),
    (SELECT string_agg(concat_ws('/', observation_type, old_observation_id, coalesce(old_vehicle_id::text, '-'), new_observation_id,
              new_vehicle_id, reason, actor_user_id), ',' ORDER BY new_observation_id, reason) FROM public.reattribution_audit),
    (SELECT string_agg(concat_ws('/', vehicle_id, session_date, owner_confirmed_at IS NOT NULL, coalesce(owner_confirmed_by::text, '-')), ','
              ORDER BY vehicle_id, session_date) FROM public.work_sessions)) $$;
-- Row counts the refusals must leave alone.
CREATE FUNCTION public.t_counts() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(',', (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id IS NOT NULL),
    (SELECT count(*) FROM public.vehicle_images WHERE is_duplicate), (SELECT count(*) FROM public.reattribution_audit),
    (SELECT count(*) FROM public.work_sessions WHERE owner_confirmed_at IS NOT NULL)) $$;
-- The standing cases, each call's answer, then what was written.
CREATE FUNCTION public.t_standing() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(E'\n',
    public.t_call('U', '01', '01'),
    public.t_call('U', '02', '02', NULL, 'owner_ledger_answer'),
    public.t_call('service', '03', '02', '00000000-0000-4000-8000-0000000000aa'),
    public.t_call('U', '04', '03'),
    public.t_call('U', '05', '04'),
    public.t_call('U', '06', NULL),
    public.t_call('service', '07', NULL, '00000000-0000-4000-8000-0000000000aa'),
    public.t_call('none', '08', '01', '00000000-0000-4000-8000-0000000000aa'),
    public.t_call('S', '09', '01'),
    public.t_snap()) $$;
CREATE FUNCTION public.t_on(nn text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(right(vehicle_id::text, 2), '-') FROM public.vehicle_images WHERE id = public.t_img(nn) $$;
CREATE FUNCTION public.t_audit(nn text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(concat_ws('|', right(new_vehicle_id::text, 2), reason, right(actor_user_id::text, 2)), ';')
    FROM public.reattribution_audit WHERE new_observation_id = public.t_img(nn) $$;
CREATE FUNCTION public.t_signed(nn text, d int) RETURNS boolean LANGUAGE sql AS $$
  SELECT owner_confirmed_at IS NOT NULL AND owner_confirmed_by = '00000000-0000-4000-8000-0000000000aa'
    FROM public.work_sessions WHERE vehicle_id = public.t_car(nn) AND session_date = make_date(2026, 11, d) $$;
\set refused_prefix 'err=42501:vehicle '
\set refused_suffix ' no longer stands; photos cannot be filed onto it'
\set perm 'err=42501:attribute_image_session: you can only file your own photos onto a vehicle you can edit'

-- ===== before: the earlier body (each run rolled back)
BEGIN;
SELECT public.t_standing() AS snap_was \gset
ROLLBACK;
SELECT public.t_assert(split_part(:'snap_was', E'\n', 1) = 'n=1' AND split_part(:'snap_was', E'\n', 2) = 'n=1'
  AND split_part(:'snap_was', E'\n', 3) = 'n=1' AND split_part(:'snap_was', E'\n', 4) = 'n=0'
  AND split_part(:'snap_was', E'\n', 5) = :'perm' AND split_part(:'snap_was', E'\n', 6) = :'perm'
  AND split_part(:'snap_was', E'\n', 7) LIKE 'err=P0001:target vehicle % does not exist'
  AND split_part(:'snap_was', E'\n', 8) = 'n=1' AND split_part(:'snap_was', E'\n', 9) = :'perm',
  'before: the standing cases answer as production does (filed, ledger, service, duplicate, three refusals, a null target, no JWT)');
BEGIN;
SELECT public.t_call('U', '10', '10') AS gap_merged, public.t_call('U', '18', '50') AS gap_removed,
       public.t_on('10') AS gap_merged_on, public.t_on('18') AS gap_removed_on \gset
ROLLBACK;
SELECT public.t_assert(:'gap_merged' = 'n=1' AND :'gap_merged_on' = '10' AND :'gap_removed' = 'n=1' AND :'gap_removed_on' = '50',
  'before: the earlier body files onto the record named, merged or removed');

-- ===== the migration
\ir ../migrations/20261122004500_owner_filing_resolves_dead_target.sql
SELECT public.t_assert(public.t_md5() = :'becomes', 'the filer is the body the migration names');
SELECT public.t_assert(public.t_attrs() = (SELECT attrs FROM public.t_pins),
  'owner, grants, security setting, volatility, SET clause, arguments and return type are unchanged');

-- standing targets: the same answers and the same rows as the earlier body
BEGIN;
SELECT public.t_standing() AS snap_becomes \gset
ROLLBACK;
SELECT public.t_assert(:'snap_becomes' = :'snap_was',
  'after: on standing targets and a null target the same answers, photos, audit rows and work sessions as before');

-- a merged-away target files onto its survivor
SELECT public.t_call('U', '10', '10') AS c10, public.t_call('U', '11', '10', NULL, 'owner_ledger_answer') AS c11 \gset
SELECT public.t_assert(:'c10' = 'n=1' AND public.t_on('10') = '11'
  AND public.t_audit('10') = '11|first_attribution: owner_session_confirm; confidence=1.0; signal=owner_session_confirm|aa'
  AND public.t_signed('11', 10) AND NOT public.t_signed('10', 10),
  'merged: the photo lands on the survivor, the audit row names it, and the survivor''s work session of that day is signed');
SELECT public.t_assert(:'c11' = 'n=1' AND public.t_on('11') = '11'
  AND public.t_audit('11') = '11|first_attribution: owner_ledger_answer; confidence=1.0; signal=owner_session_confirm|aa'
  AND NOT public.t_signed('11', 11),
  'merged, ledger answer: lands on the survivor and signs no work session (the 20261121232000 rule)');
SELECT public.t_call('U', '12', '12') AS c12, public.t_call('U', '13', '20') AS c13, public.t_call('U', '1c', '55') AS c1c,
       public.t_call('service', '1b', '10', '00000000-0000-4000-8000-0000000000aa') AS c1b \gset
SELECT public.t_assert(:'c12' = 'n=1' AND public.t_on('12') = '14' AND public.t_audit('12') LIKE '14|%',
  'two hops: resolves to the last record');
SELECT public.t_assert(:'c13' = 'n=1' AND public.t_on('13') = '28', 'eight hops: resolves to the last record');
SELECT public.t_call('U', '20', '30') AS c20 \gset
SELECT public.t_assert(:'c20' = 'n=1' AND public.t_on('20') = '39', 'nine hops (the resolver''s limit): resolves to the last record');
SELECT public.t_assert(:'c1c' = 'n=1' AND public.t_on('1c') = '56',
  'a merged record whose deleted_at was never set still resolves to its survivor');
SELECT public.t_assert(:'c1b' = 'n=1' AND public.t_on('1b') = '11'
  AND public.t_audit('1b') = '11|first_attribution: owner_session_confirm; confidence=1.0; signal=service_session_confirm|aa',
  'service role naming the owner: resolves the same way, with the service signal');

-- refusals: 42501, the record named, nothing written
CREATE TABLE public.t_got AS SELECT public.t_counts() AS before_refusals;
SELECT public.t_call('U', '14', '60') AS r10, public.t_call('U', '15', '40') AS rloop, public.t_call('U', '16', '42') AS rself,
       public.t_call('U', '17', '4f') AS rmissing, public.t_call('service', '17', '4f', '00000000-0000-4000-8000-0000000000aa') AS rmissing_svc,
       public.t_call('U', '18', '50') AS rremoved, public.t_call('service', '18', '50', '00000000-0000-4000-8000-0000000000aa') AS rremoved_svc,
       public.t_call('none', '18', '50', '00000000-0000-4000-8000-0000000000aa') AS rremoved_none,
       public.t_call('U', '19', '51') AS rremoved_survivor, public.t_call('U', '1a', '53') AS rnot_editable,
       public.t_call('S', '1d', '10') AS rstranger,
       public.t_call('U', '22', '58') AS rstatus_merged, public.t_call('U', '23', '59') AS rstatus_deleted \gset
CREATE FUNCTION public.t_call_held(p_as text, p_img text, p_owner uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v int; v_out text; v_held uuid := substring((SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_merge_terminal(uuid)'::regprocedure)
  FROM 'c_held_merges CONSTANT uuid\[\] := ARRAY\[''([0-9a-f-]{36})''')::uuid;
BEGIN
  IF p_as = 'U' THEN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000aa"}', true);
  ELSE
    PERFORM set_config('role', 'service_role', true);
    PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  END IF;
  BEGIN v := public.attribute_image_session(ARRAY[public.t_img(p_img)], v_held, p_owner); v_out := 'n=' || v;
  EXCEPTION WHEN OTHERS THEN v_out := 'err=' || SQLSTATE || ':' || SQLERRM; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_out;
END $$;
SELECT public.t_call_held('U', '21') AS rheld, public.t_call_held('service', '24', '00000000-0000-4000-8000-0000000000aa') AS rheld_svc \gset
SELECT public.t_assert(:'r10' = :'refused_prefix' || public.t_car('60') || :'refused_suffix', 'ten hops: refused (42501)');
SELECT public.t_assert(:'rheld' = :'refused_prefix' || :'held' || :'refused_suffix' AND :'rheld_svc' = :'rheld',
  'a merge held for an un-merge: refused (42501), signed in or service role, though its survivor stands');
SELECT public.t_assert(:'rstatus_merged' = :'refused_prefix' || public.t_car('58') || :'refused_suffix'
  AND :'rstatus_deleted' = :'refused_prefix' || public.t_car('59') || :'refused_suffix',
  'a record whose status alone says merged or deleted: refused (42501)');
SELECT public.t_assert(:'rloop' = :'refused_prefix' || public.t_car('40') || :'refused_suffix'
  AND :'rself' = :'refused_prefix' || public.t_car('42') || :'refused_suffix', 'a loop and a self-merge: refused (42501)');
SELECT public.t_assert(:'rmissing' = :'refused_prefix' || public.t_car('4f') || :'refused_suffix'
  AND :'rmissing_svc' = :'rmissing', 'a missing record: refused (42501), signed in or service role');
SELECT public.t_assert(:'rremoved' = :'refused_prefix' || public.t_car('50') || :'refused_suffix'
  AND :'rremoved_svc' = :'rremoved' AND :'rremoved_none' = :'rremoved', 'a removed record: refused (42501) for every caller');
SELECT public.t_assert(:'rremoved_survivor' = :'refused_prefix' || public.t_car('51') || :'refused_suffix',
  'merged into a removed record: refused (42501)');
SELECT public.t_assert(:'rnot_editable' = :'perm' AND :'rstranger' = :'perm',
  'merged into a record the caller may not edit, or a stranger on a merged record: today''s caller refusal');
SELECT public.t_assert(public.t_counts() = (SELECT before_refusals FROM public.t_got)
  AND (SELECT bool_and(vehicle_id IS NULL) FROM public.vehicle_images WHERE id IN
       (public.t_img('14'), public.t_img('15'), public.t_img('16'), public.t_img('17'), public.t_img('18'), public.t_img('19'), public.t_img('1a'), public.t_img('1d'),
        public.t_img('21'), public.t_img('22'), public.t_img('23'), public.t_img('24')))
  AND NOT EXISTS (SELECT 1 FROM public.reattribution_audit WHERE new_observation_id IN
       (public.t_img('14'), public.t_img('15'), public.t_img('16'), public.t_img('17'), public.t_img('18'), public.t_img('19'), public.t_img('1a'), public.t_img('1d'),
        public.t_img('21'), public.t_img('22'), public.t_img('23'), public.t_img('24'))),
  'every refusal wrote nothing (photos filed, duplicates, audit rows, signed work sessions counted before and after)');

-- ===== replay: nothing moves
\ir ../migrations/20261122004500_owner_filing_resolves_dead_target.sql
SELECT public.t_assert(public.t_md5() = :'becomes' AND public.t_attrs() = (SELECT attrs FROM public.t_pins), 'replay: the body is left as it is');

-- ===== revert: production's earlier body and its behaviour
\ir revert_20261122004500_owner_filing_resolves_dead_target.sql
SELECT public.t_assert(public.t_md5() = :'was' AND public.t_attrs() = (SELECT attrs FROM public.t_pins), 'revert: the earlier body, attributes unchanged');
BEGIN;
SELECT public.t_call('U', '1e', '50') AS rev_removed, public.t_on('1e') AS rev_removed_on \gset
ROLLBACK;
SELECT public.t_assert(:'rev_removed' = 'n=1' AND :'rev_removed_on' = '50', 'revert: the earlier behaviour is back (a removed record is filed onto as named)');
\ir revert_20261122004500_owner_filing_resolves_dead_target.sql
SELECT public.t_assert(public.t_md5() = :'was', 'a second revert changes nothing');

-- ===== refused: a body that moved since the migration was written, and since the revert was written
CREATE TABLE public.t_def AS SELECT pg_get_functiondef('public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure) AS def;
DO $$ BEGIN EXECUTE replace((SELECT def FROM public.t_def), 'n int := 0;', 'n int := 0; '); END $$;
CREATE TABLE public.t_moved AS SELECT public.t_md5() AS m;
SELECT public.t_assert((SELECT m FROM public.t_moved) NOT IN (:'was', :'becomes'), 'fixture: the filer has moved');
\set ON_ERROR_STOP off
\ir ../migrations/20261122004500_owner_filing_resolves_dead_target.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.t_md5() = (SELECT m FROM public.t_moved), 'refused: the migration does not overwrite a moved body');
\set ON_ERROR_STOP off
\ir revert_20261122004500_owner_filing_resolves_dead_target.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.t_md5() = (SELECT m FROM public.t_moved), 'refused: the revert does not overwrite a moved body');
DO $$ BEGIN EXECUTE (SELECT def FROM public.t_def); END $$;
SELECT public.t_assert(public.t_md5() = :'was' AND public.t_attrs() = (SELECT attrs FROM public.t_pins), 'fixture: production''s body is back');

-- ===== applied again from the reverted state: the same body and the same answers
\ir ../migrations/20261122004500_owner_filing_resolves_dead_target.sql
BEGIN;
SELECT public.t_call('U', '1e', '50') AS again_removed, public.t_call('U', '1f', '10') AS again_merged, public.t_on('1f') AS again_merged_on \gset
ROLLBACK;
SELECT public.t_assert(public.t_md5() = :'becomes' AND public.t_attrs() = (SELECT attrs FROM public.t_pins)
  AND :'again_removed' = :'refused_prefix' || public.t_car('50') || :'refused_suffix'
  AND :'again_merged' = 'n=1' AND :'again_merged_on' = '11',
  'applied again from the reverted state: the same body and the same answers');
\echo 'owner filing resolves dead target contract passed'
