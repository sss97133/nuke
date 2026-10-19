-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_day_depth -f this-file.sql
-- Proves the get_vehicle_day_depth migration (20261014051000) does two things and nothing else.
-- 1. Speed, same answer: it swaps a join to a per-observation aggregate (re-run once per image by the planner) for two EXISTS
--    probes per image and pulls the byok_deep_analysis key out of ai_scan_metadata once. For a vehicle the caller may see, the
--    rows, counts and depth are exactly what the live function returns, with the same return shape, still SECURITY DEFINER
--    with search_path public, still executable by anon. External, duplicate and superseded frames, inactive observations and
--    observations of another vehicle never count.
-- 2. Visibility: the live function answered for any vehicle id, private ones included. Now it returns no rows unless the caller
--    may see the vehicle: it is public and not deleted, or the caller is its user, owner or uploader, or the live
--    vehicle_user_has_access holds, or the caller is the service role. Anon and another signed-in user get nothing for a
--    private vehicle; its user, owner, uploader and a granted user get its days; a deleted public vehicle and one that is not
--    public reach only their own people; a vehicle that does not exist reaches nobody.
-- A re-run is a no-op, a missing dependency or a drifted function stops the migration and is left as found.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
-- auth.uid() and auth.role() exactly as Supabase defines them: the request's JWT claims, which PostgREST sets per request.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- The shapes the reader touches (pgvector is not in the CI image: the embedding column is text, only IS NOT NULL is read).
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, is_external boolean NOT NULL DEFAULT false,
  is_duplicate boolean, is_superseded boolean, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  stale boolean, vision_gate_status public.vision_gate_status, ai_scan_metadata jsonb);
CREATE INDEX vehicle_images_vehicle_id_idx ON public.vehicle_images (vehicle_id);
CREATE TABLE public.image_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid, is_active boolean, embedding_clip_vitb32 text);
CREATE INDEX idx_image_obs_image ON public.image_observations (image_id);
CREATE TABLE public.work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, session_date date, owner_confirmed_at timestamptz);
-- The vehicle and the one table of grants the live vehicle_user_has_access consults here (it reads the others only where they exist).
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, user_id uuid, owner_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid, user_id uuid, is_active boolean DEFAULT true, role text);

-- The functions as production has them on 2026-10-14.
\ir helpers/get_vehicle_day_depth_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.get_vehicle_day_depth(uuid) TO anon, authenticated, service_role;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
SELECT public.t_assert(md5(pg_get_functiondef('public.get_vehicle_day_depth(uuid)'::regprocedure)) = 'e8347b640d968eeee98af6511f8ca657'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.nuke_image_depth_score(boolean,boolean,jsonb,boolean,boolean,boolean,boolean,boolean)'::regprocedure)) = '2bd969542e4b21c3061ab34f71c61b2c'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.vehicle_user_has_access(uuid,uuid)'::regprocedure)) = '0f13ceda2c2575ba9783c24bf84ab5bf',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'the fixture is the live source');

-- Vehicles. A (the one under test), B (another public vehicle whose rows must not leak in), C (public, no images).
-- Private: P1 owned through user_id by U1, P2 through owner_id by U2, P3 through uploaded_by by U3, P4 shared with U4 by a
-- permission row. D is public but deleted (its owner is U2). E has is_public NULL. N has images and no vehicles row at all.
-- S is a signed-in stranger with no tie to any vehicle.
\set va '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set vb '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set vc '''cccccccc-0000-0000-0000-00000000000c'''
\set p1 '''0a000000-0000-0000-0000-000000000001'''
\set p2 '''0a000000-0000-0000-0000-000000000002'''
\set p3 '''0a000000-0000-0000-0000-000000000003'''
\set p4 '''0a000000-0000-0000-0000-000000000004'''
\set vd '''0d000000-0000-0000-0000-00000000000d'''
\set ve '''0e000000-0000-0000-0000-00000000000e'''
\set vn '''0f000000-0000-0000-0000-00000000000f'''
\set u1 '''91000000-0000-0000-0000-000000000001'''
\set u2 '''92000000-0000-0000-0000-000000000002'''
\set u3 '''93000000-0000-0000-0000-000000000003'''
\set u4 '''94000000-0000-0000-0000-000000000004'''
\set us '''95000000-0000-0000-0000-000000000005'''

-- ALLOW_RAW_TESTIMONY_WRITE (disposable test database)
INSERT INTO public.vehicles (id, is_public, deleted_at, user_id, owner_id, uploaded_by) VALUES
 (:va, true,  NULL, NULL, NULL, NULL), (:vb, true, NULL, NULL, NULL, NULL), (:vc, true, NULL, NULL, NULL, NULL),
 (:p1, false, NULL, :u1,  NULL, NULL), (:p2, false, NULL, NULL, :u2,  NULL), (:p3, false, NULL, NULL, NULL, :u3), (:p4, false, NULL, NULL, NULL, NULL),
 (:vd, true,  '2026-02-01', NULL, :u2, NULL),
 (:ve, NULL,  NULL, NULL, NULL, NULL);
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, is_active, role) VALUES
 (:p4, :u4, true, 'mechanic'),
 (:p1, :us, false, 'mechanic'),    -- an inactive grant is no grant
 (:p1, :us, true,  'spectator');   -- a role outside the list is no grant
INSERT INTO public.vehicle_images (id, vehicle_id, is_external, is_duplicate, is_superseded, taken_at, created_at, stale, vision_gate_status, ai_scan_metadata) VALUES
 -- 2026-03-01: i1 deep and complete, placed with a clip, on a confirmed day; i2 plain; i3 external, i4 duplicate, i5 superseded (all three excluded)
 ('10000000-0000-0000-0000-000000000001', :va, false, false, false, '2026-03-01 10:00+00', now(), false, 'approved',
   '{"byok_deep_analysis": {"context_complete": true, "intent_confidence": 0.9, "components_seen": ["door"]}}'),
 ('10000000-0000-0000-0000-000000000002', :va, false, NULL, NULL, '2026-03-01 11:00+00', now(), NULL, 'approved', NULL),
 ('10000000-0000-0000-0000-000000000003', :va, true,  false, false, '2026-03-01 12:00+00', now(), false, 'approved', NULL),
 ('10000000-0000-0000-0000-000000000004', :va, false, true,  false, '2026-03-01 13:00+00', now(), false, 'approved', NULL),
 ('10000000-0000-0000-0000-000000000005', :va, false, false, true,  '2026-03-01 14:00+00', now(), false, 'approved', NULL),
 -- 2026-03-02: i6 deep but thin, stale, placed without a clip; i7 dated by created_at, observed only inactively and on another vehicle
 ('10000000-0000-0000-0000-000000000006', :va, false, false, false, '2026-03-02 09:00+00', now(), true, 'pending',
   '{"byok_deep_analysis": {"context_complete": false, "intent_confidence": 0.5, "components_seen": []}}'),
 ('10000000-0000-0000-0000-000000000007', :va, false, false, false, NULL, '2026-03-02 15:00+00', false, NULL, NULL),
 -- 2026-03-04: i8 key present with a JSON null, i9 other keys only, i10 observed with is_active NULL
 ('10000000-0000-0000-0000-000000000008', :va, false, false, false, '2026-03-04 08:00+00', now(), false, 'approved', '{"byok_deep_analysis": null}'),
 ('10000000-0000-0000-0000-000000000009', :va, false, false, false, '2026-03-04 09:00+00', now(), false, NULL, '{"other": 1}'),
 ('10000000-0000-0000-0000-000000000010', :va, false, false, false, '2026-03-04 10:00+00', now(), false, 'approved', NULL),
 -- no date at all: excluded
 ('10000000-0000-0000-0000-000000000011', :va, false, false, false, NULL, NULL, false, 'approved', NULL),
 -- vehicle B
 ('20000000-0000-0000-0000-000000000001', :vb, false, false, false, '2026-03-01 10:00+00', now(), false, 'approved',
   '{"byok_deep_analysis": {"context_complete": true, "intent_confidence": 0.9, "components_seen": ["hood"]}}'),
 -- one frame each on the private, deleted, unknown-visibility and unknown vehicles
 ('30000000-0000-0000-0000-000000000001', :p1, false, false, false, '2026-03-05 10:00+00', now(), false, 'approved', NULL),
 ('30000000-0000-0000-0000-000000000002', :p2, false, false, false, '2026-03-05 10:00+00', now(), false, 'approved', NULL),
 ('30000000-0000-0000-0000-000000000003', :p3, false, false, false, '2026-03-05 10:00+00', now(), false, 'approved', NULL),
 ('30000000-0000-0000-0000-000000000004', :p4, false, false, false, '2026-03-05 10:00+00', now(), false, 'approved', NULL),
 ('30000000-0000-0000-0000-00000000000d', :vd, false, false, false, '2026-03-05 10:00+00', now(), false, 'approved', NULL),
 ('30000000-0000-0000-0000-00000000000e', :ve, false, false, false, '2026-03-05 10:00+00', now(), false, 'approved', NULL),
 ('30000000-0000-0000-0000-00000000000f', :vn, false, false, false, '2026-03-05 10:00+00', now(), false, 'approved', NULL);
INSERT INTO public.image_observations (image_id, vehicle_id, is_active, embedding_clip_vitb32) VALUES
 ('10000000-0000-0000-0000-000000000001', :va, true,  'e'),
 ('10000000-0000-0000-0000-000000000001', :va, true,  NULL),     -- a second row for the same image changes nothing
 ('10000000-0000-0000-0000-000000000006', :va, true,  NULL),     -- placed, no clip
 ('10000000-0000-0000-0000-000000000007', :va, false, 'e'),      -- inactive: not placed
 ('10000000-0000-0000-0000-000000000007', :vb, true,  'e'),      -- another vehicle's observation of this image: not placed for A
 ('10000000-0000-0000-0000-000000000010', :va, NULL,  NULL),     -- is_active NULL counts as active
 ('20000000-0000-0000-0000-000000000001', :vb, true,  'e');
INSERT INTO public.work_sessions (vehicle_id, session_date, owner_confirmed_at) VALUES
 (:va, '2026-03-01', '2026-03-05 00:00+00'),   -- owner-confirmed day
 (:va, '2026-03-02', NULL),                    -- not confirmed
 (:vb, '2026-03-02', '2026-03-05 00:00+00');   -- another vehicle's confirmation

-- The callers, as the request would carry them, and the vehicles each is asked about.
CREATE TABLE public.t_ids (who text PRIMARY KEY, db_role text, uid uuid);
INSERT INTO public.t_ids VALUES
 ('anon', 'anon', NULL), ('stranger', 'authenticated', :us), ('u1', 'authenticated', :u1), ('u2', 'authenticated', :u2),
 ('u3', 'authenticated', :u3), ('u4', 'authenticated', :u4), ('service', 'service_role', NULL);
CREATE TABLE public.t_vids (vid uuid PRIMARY KEY, label text);
INSERT INTO public.t_vids VALUES (:va, 'A'), (:vb, 'B'), (:vc, 'C'), (:p1, 'P1'), (:p2, 'P2'), (:p3, 'P3'), (:p4, 'P4'), (:vd, 'D'), (:ve, 'E'), (:vn, 'N');
CREATE TABLE public.t_rows (phase text, who text, vid uuid, day date, photos integer, seen integer, placed integer, depth numeric);
GRANT SELECT ON public.t_ids, public.t_vids TO anon, authenticated, service_role;
GRANT INSERT, SELECT ON public.t_rows TO anon, authenticated, service_role;
CREATE PROCEDURE public.t_capture(p_phase text) LANGUAGE plpgsql AS $$
DECLARE i record;
BEGIN
  FOR i IN SELECT * FROM public.t_ids ORDER BY who LOOP
    EXECUTE format('SET LOCAL ROLE %I', i.db_role);
    PERFORM set_config('request.jwt.claim.role', i.db_role, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(i.uid::text, ''), true);
    INSERT INTO public.t_rows
      SELECT p_phase, i.who, v.vid, f.day, f.photos, f.seen, f.placed, f.depth
        FROM public.t_vids v CROSS JOIN LATERAL public.get_vehicle_day_depth(v.vid) f;
    RESET ROLE;
  END LOOP;
END $$;
CREATE FUNCTION public.t_days(p_phase text, p_who text, p_label text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.t_rows r JOIN public.t_vids v USING (vid) WHERE r.phase = p_phase AND r.who = p_who AND v.label = p_label $$;

-- 1. Before: what the live function answers, to every caller, for every vehicle.
BEGIN; CALL public.t_capture('before'); COMMIT;
SELECT public.t_assert(public.t_days('before', 'anon', 'A') = 3 AND public.t_days('before', 'anon', 'B') = 1 AND public.t_days('before', 'anon', 'C') = 0,
  'before: 3 days for A, 1 for B, none for C');
SELECT public.t_assert(public.t_days('before', 'anon', 'P1') = 1 AND public.t_days('before', 'anon', 'P4') = 1 AND public.t_days('before', 'anon', 'N') = 1
  AND public.t_days('before', 'stranger', 'P2') = 1 AND public.t_days('before', 'anon', 'D') = 1,
  'before: anon and a stranger read the days of private, deleted and unknown vehicles (the hole)');
CREATE TABLE public.t_props_before AS
  SELECT p.prosecdef, p.provolatile, p.proconfig::text AS cfg, pg_get_function_result(p.oid) AS result,
         has_function_privilege('anon', p.oid, 'execute') AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') AS auth_exec,
         has_function_privilege('service_role', p.oid, 'execute') AS service_exec
  FROM pg_proc p WHERE p.oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure;

-- 2. The migration.
\ir ../migrations/20261014051000_get_vehicle_day_depth_index_probes.sql

-- 3. After: for a vehicle everyone may see, the same rows to the digit, whoever asks.
BEGIN; CALL public.t_capture('after'); COMMIT;
SELECT public.t_assert(NOT EXISTS (
    SELECT who, vid, day, photos, seen, placed, depth FROM public.t_rows WHERE phase = 'before' AND vid IN (:va, :vb, :vc)
    EXCEPT SELECT who, vid, day, photos, seen, placed, depth FROM public.t_rows WHERE phase = 'after' AND vid IN (:va, :vb, :vc))
  AND NOT EXISTS (
    SELECT who, vid, day, photos, seen, placed, depth FROM public.t_rows WHERE phase = 'after' AND vid IN (:va, :vb, :vc)
    EXCEPT SELECT who, vid, day, photos, seen, placed, depth FROM public.t_rows WHERE phase = 'before' AND vid IN (:va, :vb, :vc))
  AND (SELECT count(*) FROM public.t_rows WHERE phase = 'after' AND vid IN (:va, :vb, :vc)) = 7 * 4,
  'after: public vehicles A, B and C give every caller identical rows (7 callers x 4 days)');

-- ...and the rows are the ones worked out by hand from the score formula (so old == new is not two wrongs):
--   03-01: i1 .12+.30+.08+.08+.07+.13+.07+.07 = .92, i2 .12+.07 = .19   -> avg .5550, 2 photos, 1 seen, 1 placed
--   03-02: i6 .30+.13-.05 = .38, i7 0                                    -> avg .1900, 2 photos, 1 seen, 1 placed
--   03-04: i8 .12+.30 = .42, i9 0, i10 .12+.13 = .25                     -> avg .2233, 3 photos, 1 seen, 1 placed
SELECT public.t_assert((SELECT array_agg(ARRAY[day::text, photos::text, seen::text, placed::text, depth::text] ORDER BY day)
    FROM public.t_rows WHERE phase = 'after' AND who = 'anon' AND vid = :va)
  = ARRAY[ARRAY['2026-03-01', '2', '1', '1', '0.5550'], ARRAY['2026-03-02', '2', '1', '1', '0.1900'], ARRAY['2026-03-04', '3', '1', '1', '0.2233']],
  'after: the hand-computed days');
SELECT public.t_assert((SELECT depth FROM public.t_rows WHERE phase = 'after' AND who = 'anon' AND vid = :vb) = 0.8500
  AND (SELECT photos FROM public.t_rows WHERE phase = 'after' AND who = 'anon' AND vid = :vb) = 1,
  'after: B answers from its own rows only (.12+.30+.08+.08+.07+.13+.07 = .85; A''s confirmed day 03-01 does not reach B)');

-- 4. Visibility. Nothing for a vehicle the caller cannot see.
SELECT public.t_assert(public.t_days('after', 'anon', 'P1') = 0 AND public.t_days('after', 'anon', 'P2') = 0 AND public.t_days('after', 'anon', 'P3') = 0
  AND public.t_days('after', 'anon', 'P4') = 0 AND public.t_days('after', 'anon', 'D') = 0 AND public.t_days('after', 'anon', 'E') = 0
  AND public.t_days('after', 'anon', 'N') = 0, 'after: anon gets no days for a private, deleted, unknown-visibility or unknown vehicle');
SELECT public.t_assert(public.t_days('after', 'stranger', 'P1') = 0 AND public.t_days('after', 'stranger', 'P2') = 0 AND public.t_days('after', 'stranger', 'P3') = 0
  AND public.t_days('after', 'stranger', 'P4') = 0 AND public.t_days('after', 'stranger', 'D') = 0 AND public.t_days('after', 'stranger', 'E') = 0
  AND public.t_days('after', 'stranger', 'N') = 0 AND public.t_days('after', 'stranger', 'A') = 3,
  'after: another signed-in user gets nothing for those either (an inactive grant or a role outside the list is no grant), and still gets public A');
-- Its own people, each by their own tie.
SELECT public.t_assert(public.t_days('after', 'u1', 'P1') = 1 AND public.t_days('after', 'u1', 'P2') = 0 AND public.t_days('after', 'u1', 'P3') = 0
  AND public.t_days('after', 'u1', 'P4') = 0 AND public.t_days('after', 'u1', 'D') = 0, 'after: U1 reads P1 (user_id) and nothing of the others');
SELECT public.t_assert(public.t_days('after', 'u2', 'P2') = 1 AND public.t_days('after', 'u2', 'P1') = 0 AND public.t_days('after', 'u2', 'D') = 1,
  'after: U2 reads P2 (owner_id) and its own deleted vehicle D, as under the vehicles policies');
SELECT public.t_assert(public.t_days('after', 'u3', 'P3') = 1 AND public.t_days('after', 'u3', 'P1') = 0, 'after: U3 reads P3 (uploaded_by)');
SELECT public.t_assert(public.t_days('after', 'u4', 'P4') = 1 AND public.t_days('after', 'u4', 'P1') = 0 AND public.t_days('after', 'u4', 'P3') = 0,
  'after: U4 reads P4 through vehicle_user_has_access');
SELECT public.t_assert(public.t_days('after', 'service', 'P1') = 1 AND public.t_days('after', 'service', 'P4') = 1 AND public.t_days('after', 'service', 'D') = 1
  AND public.t_days('after', 'service', 'E') = 1 AND public.t_days('after', 'service', 'N') = 0,
  'after: the service role reads every vehicle that exists, and still nothing for one that does not');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.t_rows r JOIN public.t_vids v USING (vid)
    WHERE r.phase = 'after' AND v.label IN ('P1', 'P2', 'P3', 'P4', 'D', 'E', 'N') AND r.who IN ('anon', 'stranger')),
  'after: no row at all for those vehicles, for either kind of stranger');

-- 5. Shape and rights are as they were.
SELECT public.t_assert((SELECT (prosecdef, provolatile, cfg, result, anon_exec, auth_exec, service_exec) FROM public.t_props_before)
  = (SELECT (p.prosecdef, p.provolatile, p.proconfig::text, pg_get_function_result(p.oid), has_function_privilege('anon', p.oid, 'execute'),
             has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('service_role', p.oid, 'execute'))
       FROM pg_proc p WHERE p.oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure),
  'after: security definer, volatility, search_path, result type and EXECUTE for anon, authenticated and service_role unchanged');
SELECT public.t_assert((SELECT prosecdef AND provolatile = 's' AND proconfig::text LIKE '%search_path=public%' FROM pg_proc
  WHERE oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure), 'after: still a stable security definer with search_path public');
-- The caller is resolved once and the image scan sits behind the gate, so a stranger's call reads no image rows: the plan has a
-- one-time filter on the gate in front of the vehicle_images scan.
SELECT public.t_assert(pg_get_functiondef('public.get_vehicle_day_depth(uuid)'::regprocedure) LIKE '%materialized (%select auth.uid() as uid, auth.role() as role%'
  AND pg_get_functiondef('public.get_vehicle_day_depth(uuid)'::regprocedure) LIKE '%exists (select 1 from gate)%',
  'after: the caller is resolved once in a materialized CTE and the image scan waits on the gate');

-- 6. A second run is a no-op that passes the guard.
\ir ../migrations/20261014051000_get_vehicle_day_depth_index_probes.sql
CREATE TABLE public.t_rerun AS SELECT 'rerun'::text AS phase, 'anon'::text AS who, :va::uuid AS vid, f.* FROM public.get_vehicle_day_depth(:va) f;
SELECT public.t_assert((SELECT count(*) FROM public.t_rerun) = 3
  AND NOT EXISTS (SELECT day, photos, seen, placed, depth FROM public.t_rerun
                  EXCEPT SELECT day, photos, seen, placed, depth FROM public.t_rows WHERE phase = 'after' AND who = 'service' AND vid = :va),
  'a re-run leaves the answers alone');

-- 7. A missing dependency stops the migration and leaves the function as found.
ALTER FUNCTION public.vehicle_user_has_access(uuid, uuid) RENAME TO vehicle_user_has_access_away;
CREATE OR REPLACE FUNCTION public.get_vehicle_day_depth(p_vehicle_id uuid)
 RETURNS TABLE(day date, photos integer, seen integer, placed integer, depth numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
 AS $f$ SELECT NULL::date, NULL::int, NULL::int, NULL::int, NULL::numeric WHERE false $f$;
\echo 'Expected: the missing-dependency ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014051000_get_vehicle_day_depth_index_probes.sql
\set ON_ERROR_STOP on
ALTER FUNCTION public.vehicle_user_has_access_away(uuid, uuid) RENAME TO vehicle_user_has_access;
SELECT public.t_assert((SELECT prosrc FROM pg_proc WHERE oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure) LIKE '%WHERE false%',
  'without vehicle_user_has_access the function is not replaced');

-- 8. A drifted source stops the migration and is left as found (the stand-in above is already not the 2026-10-14 definition).
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014051000_get_vehicle_day_depth_index_probes.sql
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT prosrc FROM pg_proc WHERE oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure) LIKE '%WHERE false%',
  'a drifted function is not replaced');
SELECT 'get_vehicle_day_depth perf and visibility contract: PASS' AS result;
