-- Admit unfiled uploads (20261113120700): an unfiled user_upload / owner_upload / drop-folder / direct_pull_* frame with an EXIF
-- DateTimeOriginal becomes a capture-set member; a filed upload never does; a frame with no camera clock and image_intake stay
-- out; a machine-filed upload loses the hand-filed shortcut in the anchor rule and in capture_filing_trust; the patch is
-- idempotent and the revert restores the saved bodies.
-- Requires empty disposable dm_refinement_capture_admit_unfiled_uploads* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_admit_unfiled_uploads%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_admit_unfiled_uploads* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, source text, taken_at timestamptz,
  image_url text, exif_data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_set_links (run_id uuid, image_id uuid, vehicle_id uuid, reverted_at timestamptz);
CREATE TABLE public.auto_filing_audit_queue (image_id uuid, vehicle_id uuid, run_id text, status text);
CREATE TABLE public.image_observations (image_id uuid, vehicle_id uuid, is_active boolean, observed_by text);

-- 20261111100000 as live
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT ARRAY['capture_relay_ios', 'iphoto', 'iphoto_60d', 'photo_auto_sync', 'library_recovery']
$$;
-- stand-ins carrying the live member anchors verbatim (one each)
CREATE FUNCTION public.capture_landing_unfiled_exists(p_user uuid, p_from timestamptz, p_to timestamptz) RETURNS boolean
 LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  select exists (select 1 from vehicle_images vi where vi.user_id = p_user and vi.source = ANY (public.capture_set_photo_sources())
    and vi.taken_at >= p_from and vi.taken_at < p_to and nullif(vi.image_url,'') is not null
    and (vi.vehicle_id is null or vi.vehicle_id = '14447ecd-293e-4203-9045-90102559c904'::uuid))
$function$;
CREATE FUNCTION public.capture_landing_tick() RETURNS int LANGUAGE sql AS $function$
  select count(*)::int from vehicle_images vi where vi.source = ANY (public.capture_set_photo_sources()) and vi.vehicle_id is null $function$;
CREATE FUNCTION public.capture_sets_arm_new_photos() RETURNS int LANGUAGE sql AS $function$
  select count(*)::int from vehicle_images v where v.vehicle_id IS NULL AND v.source = ANY (public.capture_set_photo_sources()) $function$;
CREATE FUNCTION public.capture_sets_arm_on_text_read() RETURNS int LANGUAGE sql AS $function$
  select count(*)::int from vehicle_images vi where vi.source = ANY (public.capture_set_photo_sources()) AND vi.vehicle_id IS NULL $function$;
-- build / score: members are every admitted frame of the owner (filed or not), as live
CREATE FUNCTION public.capture_sets_build(p_user uuid) RETURNS SETOF uuid LANGUAGE sql AS $function$
  select vi.id from vehicle_images vi WHERE vi.user_id = p_user AND vi.source = ANY (public.capture_set_photo_sources()) AND vi.taken_at IS NOT NULL $function$;
CREATE FUNCTION public.capture_sets_score(p_user uuid, p_kind text) RETURNS SETOF uuid LANGUAGE sql AS $function$
  select vi.id from vehicle_images vi where p_kind = 'member' and vi.user_id = p_user and vi.source = ANY (public.capture_set_photo_sources()) and vi.taken_at is not null
  union all
  select a.id from vehicle_images a where p_kind = 'anchor' and a.user_id = p_user and a.vehicle_id is not null
      and (a.source in ('user_upload','owner_upload')
           or (a.source = ANY (public.capture_set_photo_sources())
               and not exists (select 1 from capture_set_links l where l.image_id = a.id and l.reverted_at is null)))
$function$;
-- capture_filing_trust: the live body read 2026-11-09, verbatim
CREATE OR REPLACE FUNCTION public.capture_filing_trust(p_image uuid, p_vehicle uuid, p_source text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- How much a *filed* photo may vouch for its neighbours (session / continuity / recency priors).
  -- 0    : visually audited wrong
  -- 1.0  : visually audited correct, user's own upload, iOS photo with no machine provenance (filed by hand),
  --        or machine filing from a run whose visual gate passed (>=1 correct, <=5% wrong audit rows)
  -- 0.25 : any other machine filing (never visually verified)
  select case
    when exists (select 1 from auto_filing_audit_queue q where q.image_id = p_image and q.vehicle_id = p_vehicle and q.status = 'wrong') then 0
    when exists (select 1 from auto_filing_audit_queue q where q.image_id = p_image and q.vehicle_id = p_vehicle and q.status = 'correct') then 1.0
    when p_source in ('user_upload','owner_upload') then 1.0
    when exists (select 1 from capture_set_links l where l.image_id = p_image and l.vehicle_id = p_vehicle and l.reverted_at is null) then
      case when exists (select 1 from capture_set_links l
                         cross join lateral (select count(*) filter (where q.status='correct') c, count(*) filter (where q.status='wrong') w
                                               from auto_filing_audit_queue q where q.run_id = l.run_id::text) a
                         where l.image_id = p_image and l.vehicle_id = p_vehicle and l.reverted_at is null and a.c >= 1 and a.w <= 0.05 * (a.c + a.w))
           then 1.0 else 0.25 end
    when exists (select 1 from image_observations o where o.image_id = p_image and o.is_active and o.vehicle_id = p_vehicle and o.observed_by not like 'human:%') then 0.25
    else 1.0 end
$function$;

CREATE TEMP TABLE before_md5 AS SELECT p.proname, md5(pg_get_functiondef(p.oid)) m FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('capture_landing_tick','capture_landing_unfiled_exists','capture_sets_arm_new_photos',
    'capture_sets_arm_on_text_read','capture_sets_build','capture_sets_score','capture_filing_trust');

-- fixtures (owner U, vehicle V)
INSERT INTO vehicle_images(id, user_id, vehicle_id, source, taken_at, image_url, exif_data) VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000aa',NULL,'user_upload','2019-06-01 10:00Z','u','{"DateTimeOriginal":"2019:06:01 10:00:00"}'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-0000000000aa',NULL,'user_upload','2019-06-01 10:00Z','u','{"dateTaken":"x"}'),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-0000000000aa','00000000-0000-4000-8000-0000000000f1','user_upload','2019-06-01 10:00Z','u','{"DateTimeOriginal":"2019:06:01 10:00:00"}'),
 ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-0000000000aa',NULL,'image_intake','2019-06-01 10:00Z','u',NULL),
 ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-0000000000aa','00000000-0000-4000-8000-0000000000f1','iphoto','2019-06-01 10:00Z','u','{}'),
 ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-0000000000aa',NULL,'drop-folder','2019-06-01 10:00Z','u','{"DateTimeOriginal":"2019:06:01 10:00:00"}'),
 ('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-0000000000aa',NULL,'direct_pull_2026_05_23','2019-06-01 10:00Z','u','{"DateTimeOriginal":"2019:06:01 10:00:00"}'),
 -- a machine-filed upload (landed by a run whose gate has no audit rows)
 ('00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-0000000000aa','00000000-0000-4000-8000-0000000000f1','user_upload','2019-06-01 10:00Z','u','{"DateTimeOriginal":"2019:06:01 10:00:00"}'),
 ('00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-0000000000aa',NULL,'capture_relay_ios','2019-06-01 10:00Z','u','{}');
INSERT INTO capture_set_links VALUES ('00000000-0000-4000-8000-00000000e001','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-0000000000f1',NULL);

CREATE FUNCTION pg_temp.ids(k text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(right(x::text, 1), '' ORDER BY x) FROM public.capture_sets_score('00000000-0000-4000-8000-0000000000aa', k) x $$;
CREATE FUNCTION pg_temp.trust(i text, s text) RETURNS numeric LANGUAGE sql AS $$
  SELECT public.capture_filing_trust(('00000000-0000-4000-8000-00000000000' || i)::uuid, '00000000-0000-4000-8000-0000000000f1', s) $$;

-- before: only library frames are members; every filed upload anchors and is fully trusted
SELECT pg_temp.assert_true(pg_temp.ids('member') = '59', 'before: members are library frames only');
SELECT pg_temp.assert_true(pg_temp.ids('anchor') = '358', 'before: hand- and machine-filed uploads both anchor');
SELECT pg_temp.assert_true(pg_temp.trust('8', 'user_upload') = 1.0, 'before: a machine-filed upload is trusted as hand-filed');

\i supabase/migrations/20261113120700_capture_admit_unfiled_uploads.sql

SELECT pg_temp.assert_true(pg_temp.ids('member') = '15679', 'after: unfiled uploads / drop-folder / direct pull with a camera clock join; filed and clockless uploads and image_intake do not');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.capture_sets_build('00000000-0000-4000-8000-0000000000aa')) = 5, 'build admits the same five');
SELECT pg_temp.assert_true(public.capture_landing_tick() = 4 AND public.capture_sets_arm_new_photos() = 4 AND public.capture_sets_arm_on_text_read() = 4,
  'tick and both arms see the unfiled admitted frames');
SELECT pg_temp.assert_true(public.capture_landing_unfiled_exists('00000000-0000-4000-8000-0000000000aa', '2019-06-01', '2019-06-02'), 'unfiled probe sees them');
SELECT pg_temp.assert_true(pg_temp.ids('anchor') = '35', 'after: a machine-filed upload no longer anchors as hand-filed');
SELECT pg_temp.assert_true(pg_temp.trust('3', 'user_upload') = 1.0, 'after: a hand-filed upload is still fully trusted');
SELECT pg_temp.assert_true(pg_temp.trust('8', 'user_upload') = 0.25, 'after: a machine-filed upload from an unverified run vouches at 0.25');
INSERT INTO auto_filing_audit_queue VALUES (NULL, NULL, '00000000-0000-4000-8000-00000000e001', 'correct');
SELECT pg_temp.assert_true(pg_temp.trust('8', 'user_upload') = 1.0, 'after: ... and at 1.0 once its run passes the visual gate');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_set_photo_admits(text, uuid, jsonb)', 'EXECUTE'), 'anon cannot call the predicate');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_admit_uploads_prev_defs) = 7, 'seven prior bodies saved');

-- idempotent
\i supabase/migrations/20261113120700_capture_admit_unfiled_uploads.sql
SELECT pg_temp.assert_true(pg_temp.ids('member') = '15679', 'second apply changes nothing');

\i supabase/sql/revert_20261113120700_capture_admit_unfiled_uploads.sql
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM before_md5 b JOIN pg_proc p ON p.proname = b.proname AND p.pronamespace = 'public'::regnamespace
                                        WHERE md5(pg_get_functiondef(p.oid)) <> b.m), 'revert restores every body');
SELECT pg_temp.assert_true(to_regprocedure('public.capture_set_photo_admits(text, uuid, jsonb)') IS NULL, 'revert drops the predicate');
SELECT pg_temp.assert_true(pg_temp.ids('member') = '59', 'after revert: library frames only again');
SELECT 'capture admit unfiled uploads contract: ok' AS result;
