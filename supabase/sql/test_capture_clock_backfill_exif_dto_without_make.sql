-- Contract: 20261115121000 file-EXIF DateTimeOriginal without Make. Disposable DB only.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_clock%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, source text, exif_data jsonb, taken_at timestamptz, is_sensitive boolean);
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['iphoto'] $$;
CREATE OR REPLACE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND (p_source = ANY (ARRAY['user_upload', 'owner_upload', 'drop-folder']) OR p_source LIKE 'direct\_pull\_%')
          AND coalesce(p_exif ? 'DateTimeOriginal', false))
$function$;
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_set_photo_admits(text,uuid,jsonb)'::regprocedure)) = '38b290488dd2e685e2e925f79e85f296', '121000 fixture admits body');

INSERT INTO vehicle_images VALUES
 ('00000000-0000-4000-8000-000000000001', NULL, 'image_intake', '{}', '2024-06-25 08:46:10Z', false), -- the 4-row case: file DTO, no Make, taken_at already right
 ('00000000-0000-4000-8000-000000000002', NULL, 'user_upload', '{"w":1}', '2025-09-20 18:00Z', false),
 ('00000000-0000-4000-8000-000000000003', NULL, 'user_upload', '{}', '2025-09-20 18:00Z', true),
 ('00000000-0000-4000-8000-000000000004', gen_random_uuid(), 'image_intake', '{}', '2024-06-25 08:46:10Z', false),
 ('00000000-0000-4000-8000-000000000005', NULL, 'image_intake', '{"DateTimeOriginal":"2020:01:01 00:00:00"}', '2020-01-01 08:00Z', false);

\i supabase/migrations/20261113121000_capture_clock_backfill.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_clock_backfill_apply(uuid,uuid,timestamptz,jsonb,boolean)'::regprocedure)) = '2da16a0cec11a1731c93fd8a24fb8aa7', '121000 apply body matches live');

CREATE FUNCTION pg_temp.k(src text, run text, dto text, with_make boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS
$$ SELECT jsonb_strip_nulls(jsonb_build_object(
    'DateTimeOriginal', dto,
    'Make', CASE WHEN with_make THEN 'Apple' ELSE NULL END,
    'capture_clock', jsonb_build_object('source', src, 'run_id', run, 'producer', 't', 'prior_taken_at', null)
)) $$;

-- pre-migration: no-Make file_exif is rejected
DO $$ BEGIN
  PERFORM capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    '2024-06-25 08:46:10Z', pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', '2024:06:25 01:46:10', false), false);
  RAISE EXCEPTION 'no-make clock accepted before migration';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%before migration%' THEN RAISE; END IF; END $$;

\i supabase/migrations/20261115121000_capture_clock_backfill_exif_dto_without_make.sql

-- the 4-row case: file_exif DTO, no Make, taken_at already matches, do not change taken_at
SELECT pg_temp.assert_true(capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
  '2024-06-25 08:46:10Z', pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', '2024:06:25 01:46:10', false), false) ->> 'status' = 'written', 'no-make file_exif written');
SELECT pg_temp.assert_true((SELECT taken_at = '2024-06-25 08:46:10Z' AND exif_data ->> 'DateTimeOriginal' = '2024:06:25 01:46:10'
  AND exif_data -> 'capture_clock' ->> 'source' = 'file_exif' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001'), 'DTO stamped, taken_at kept');
SELECT pg_temp.assert_true(public.capture_set_photo_admits('image_intake', NULL, (SELECT exif_data FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001')), 'intake now admits after DTO stamp');

-- Make still works (unchanged path)
SELECT pg_temp.assert_true(capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
  '2021-05-07 21:30Z', pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', '2021:05:07 14:30:00', true), true) ->> 'status' = 'written', 'with-make still written');

-- still skip sensitive / filed / already-clocked
SELECT pg_temp.assert_true(capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-00000000000' || n)::uuid,
  '2024-06-25 08:46:10Z', pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', '2024:06:25 01:46:10', false), false) ->> 'status' = 'skipped_not_eligible',
  'sensitive / filed / already-clocked untouched: ' || n) FROM generate_series(3, 5) n;

-- XMP, guess, and missing DTO still rejected (no invented clocks)
DO $$ BEGIN
  PERFORM capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', now(),
    pg_temp.k('file_xmp', 'a0000000-0000-4000-8000-000000000001', 'x', false), false);
  RAISE EXCEPTION 'xmp clock accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%xmp clock%' THEN RAISE; END IF; END $$;
DO $$ BEGIN
  PERFORM capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', now(),
    pg_temp.k('guess', 'a0000000-0000-4000-8000-000000000001', 'x', false), false);
  RAISE EXCEPTION 'guess clock accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%guess clock%' THEN RAISE; END IF; END $$;
DO $$ BEGIN
  PERFORM capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', now(),
    (pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', 'x', false) - 'DateTimeOriginal'), false);
  RAISE EXCEPTION 'no-dto clock accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%no-dto%' THEN RAISE; END IF; END $$;

-- revert still restores the no-Make write
SELECT pg_temp.assert_true((capture_clock_backfill_revert('a0000000-0000-4000-8000-000000000001', false) ->> 'restorable')::int >= 1, 'revert restores');
SELECT pg_temp.assert_true((SELECT taken_at = '2024-06-25 08:46:10Z' AND exif_data = '{}' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001'), 'no-make row restored exactly');

\i supabase/sql/revert_20261115121000_capture_clock_backfill_exif_dto_without_make.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_clock_backfill_apply(uuid,uuid,timestamptz,jsonb,boolean)'::regprocedure)) = '2da16a0cec11a1731c93fd8a24fb8aa7', 'function revert restores 121000 body');
-- no-Make is rejected again after function revert
DO $$ BEGIN
  PERFORM capture_clock_backfill_apply('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    '2024-06-25 08:46:10Z', pg_temp.k('file_exif', 'b0000000-0000-4000-8000-000000000001', '2024:06:25 01:46:10', false), false);
  RAISE EXCEPTION 'no-make accepted after function revert';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%after function revert%' THEN RAISE; END IF; END $$;

SELECT 'capture clock exif dto without make contract: ok';
