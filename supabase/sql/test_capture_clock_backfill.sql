-- Contract: 20261113121000 camera clock backfill. Requires empty disposable dm_refinement_capture_clock* database.
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
-- live body (20261113120700), verbatim
CREATE OR REPLACE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND (p_source = ANY (ARRAY['user_upload', 'owner_upload', 'drop-folder']) OR p_source LIKE 'direct\_pull\_%')
          AND coalesce(p_exif ? 'DateTimeOriginal', false))
$function$;
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_set_photo_admits(text,uuid,jsonb)'::regprocedure)) = '38b290488dd2e685e2e925f79e85f296', 'fixture matches live body');
INSERT INTO vehicle_images VALUES
 ('00000000-0000-4000-8000-000000000001', NULL, 'user_upload', '{"w":1}', '2025-09-20 18:00Z', false),   -- taken_at = upload time
 ('00000000-0000-4000-8000-000000000002', NULL, 'image_intake', '{}', '2019-06-01 17:00Z', false),        -- taken_at already right
 ('00000000-0000-4000-8000-000000000003', NULL, 'user_upload', '{}', '2025-09-20 18:00Z', true),          -- sensitive
 ('00000000-0000-4000-8000-000000000004', gen_random_uuid(), 'user_upload', '{}', '2025-09-20 18:00Z', false), -- filed
 ('00000000-0000-4000-8000-000000000005', NULL, 'user_upload', '{"DateTimeOriginal":"2020:01:01 00:00:00"}', '2020-01-01 08:00Z', false);
\i supabase/migrations/20261113121000_capture_clock_backfill.sql
SELECT pg_temp.assert_true(public.capture_set_photo_admits('image_intake', NULL, '{"DateTimeOriginal":"x"}'), 'image_intake with a clock admitted');
SELECT pg_temp.assert_true(NOT public.capture_set_photo_admits('image_intake', NULL, '{}'), 'image_intake without a clock not admitted');
SELECT pg_temp.assert_true(NOT public.capture_set_photo_admits('image_intake', gen_random_uuid(), '{"DateTimeOriginal":"x"}'), 'filed image_intake not admitted');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_clock_backfill_apply(uuid,uuid,timestamptz,jsonb,boolean)', 'EXECUTE'), 'anon cannot apply');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'public.capture_clock_backfill_log', 'SELECT'), 'log private');

CREATE FUNCTION pg_temp.k(src text, run text, dto text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT jsonb_build_object('DateTimeOriginal', dto, 'Make', 'Apple', 'capture_clock', jsonb_build_object('source', src, 'run_id', run, 'producer', 't', 'prior_taken_at', null)) $$;
SELECT pg_temp.assert_true(capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
  '2021-05-07 21:30Z', pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', '2021:05:07 14:30:00'), true) ->> 'status' = 'written', 'upload written');
SELECT pg_temp.assert_true(capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
  '2019-06-01 17:00Z', pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', '2019:06:01 10:00:00'), false) ->> 'status' = 'written', 'intake written');
SELECT pg_temp.assert_true(capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-00000000000' || n)::uuid,
  '2021-05-07 21:30Z', pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', '2021:05:07 14:30:00'), true) ->> 'status' = 'skipped_not_eligible',
  'sensitive / filed / already-clocked untouched: ' || n) FROM generate_series(3, 5) n;
DO $$ BEGIN
  PERFORM capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', now(),
    pg_temp.k('guess', 'a0000000-0000-4000-8000-000000000001', 'x'), true);
  RAISE EXCEPTION 'unsigned source accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%unsigned%' THEN RAISE; END IF; END $$;
DO $$ BEGIN
  PERFORM capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', now(),
    pg_temp.k('file_exif', 'a0000000-0000-4000-8000-000000000001', 'x') - 'Make', true);
  RAISE EXCEPTION 'no-camera clock accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%no-camera%' THEN RAISE; END IF; END $$;
DO $$ BEGIN
  PERFORM capture_clock_backfill_apply('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', now(),
    pg_temp.k('file_xmp', 'a0000000-0000-4000-8000-000000000001', 'x'), true);
  RAISE EXCEPTION 'xmp clock accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%xmp clock%' THEN RAISE; END IF; END $$;
SELECT pg_temp.assert_true((SELECT taken_at = '2021-05-07 21:30Z' AND exif_data ->> 'DateTimeOriginal' = '2021:05:07 14:30:00' AND exif_data ->> 'w' = '1'
  AND exif_data -> 'capture_clock' ? 'at' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001'), 'clock and taken_at written, other keys kept');
SELECT pg_temp.assert_true((SELECT taken_at = '2019-06-01 17:00Z' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000002'), 'taken_at kept when not asked');
SELECT pg_temp.assert_true((SELECT taken_at = '2025-09-20 18:00Z' AND exif_data = '{}' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000003'), 'sensitive untouched');
-- revert: dry reports, live restores; a row changed since is reported and left alone
UPDATE vehicle_images SET exif_data = exif_data || '{"capture_clock":{"run_id":"other"}}' WHERE id = '00000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_true((capture_clock_backfill_revert('a0000000-0000-4000-8000-000000000001') ->> 'restorable')::int = 1, 'dry revert counts');
SELECT pg_temp.assert_true((SELECT exif_data ? 'DateTimeOriginal' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001'), 'dry revert writes nothing');
SELECT pg_temp.assert_true((capture_clock_backfill_revert('a0000000-0000-4000-8000-000000000001', false) ->> 'changed_since_skipped')::int = 1, 'changed row reported');
SELECT pg_temp.assert_true((SELECT taken_at = '2025-09-20 18:00Z' AND exif_data = '{"w":1}' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001'), 'restored exactly');
SELECT pg_temp.assert_true((SELECT exif_data -> 'capture_clock' ->> 'run_id' = 'other' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000002'), 'later change kept');
-- migration revert refuses while a run is unreverted, then restores the predicate
DO $$ BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM capture_clock_backfill_log WHERE reverted_at IS NULL) THEN RAISE EXCEPTION 'unreverted'; END IF;
    RAISE EXCEPTION 'expected an unreverted row';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'unreverted' THEN RAISE; END IF; END;
END $$;
DELETE FROM capture_clock_backfill_log WHERE reverted_at IS NULL;
\i supabase/sql/revert_20261113121000_capture_clock_backfill.sql
SELECT pg_temp.assert_true(to_regclass('public.capture_clock_backfill_log') IS NULL, 'revert drops log');
SELECT pg_temp.assert_true(NOT public.capture_set_photo_admits('image_intake', NULL, '{"DateTimeOriginal":"x"}'), 'revert un-admits image_intake');
SELECT 'capture clock backfill contract: ok';
