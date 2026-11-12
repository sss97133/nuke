-- Contract: 20261114120000 naive-UTC drop-folder clock correction.
-- Requires empty disposable dm_refinement_capture_clock_naive* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
SET TIME ZONE 'America/Los_Angeles';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_clock_naive%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, vehicle_id uuid, source text, exif_data jsonb, taken_at timestamptz,
  is_sensitive boolean, vision_gate_status text);
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['iphoto'] $$;
-- live body (20261113120700), verbatim, so 121000's md5 guard passes
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
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_set_photo_admits(text,uuid,jsonb)'::regprocedure)) = '38b290488dd2e685e2e925f79e85f296', 'fixture matches live 120700 body');

-- 1: naive UTC, unfiled, the bug. DTO 08:47:06 stored 08:47Z; should become 15:47Z (PDT).
-- 2: already-correct (taken_at already LA).
-- 3: sensitive.
-- 4: filed AND naive UTC — must be writable (this path allows filed rows).
-- 5: rejected_personal.
-- 6: user_upload naive UTC — wrong source, skip.
-- 7: no DateTimeOriginal.
INSERT INTO vehicle_images VALUES
 ('00000000-0000-4000-8000-000000000001', NULL, 'drop-folder',
    '{"DateTimeOriginal":"2026:03:12 08:47:06"}', '2026-03-12 08:47:06Z', false, NULL),
 ('00000000-0000-4000-8000-000000000002', NULL, 'drop-folder',
    '{"DateTimeOriginal":"2026:03:12 08:47:06","OffsetTimeOriginal":"-07:00"}', '2026-03-12 15:47:06Z', false, NULL),
 ('00000000-0000-4000-8000-000000000003', NULL, 'drop-folder',
    '{"DateTimeOriginal":"2026:03:12 08:47:06"}', '2026-03-12 08:47:06Z', true, NULL),
 ('00000000-0000-4000-8000-000000000004', gen_random_uuid(), 'drop-folder',
    '{"DateTimeOriginal":"2026:03:12 08:47:06"}', '2026-03-12 08:47:06Z', false, NULL),
 ('00000000-0000-4000-8000-000000000005', NULL, 'drop-folder',
    '{"DateTimeOriginal":"2026:03:12 08:47:06"}', '2026-03-12 08:47:06Z', false, 'rejected_personal'),
 ('00000000-0000-4000-8000-000000000006', NULL, 'user_upload',
    '{"DateTimeOriginal":"2026:03:12 08:47:06"}', '2026-03-12 08:47:06Z', false, NULL),
 ('00000000-0000-4000-8000-000000000007', NULL, 'drop-folder',
    '{}', '2026-03-12 08:47:06Z', false, NULL);

\i supabase/migrations/20261113121000_capture_clock_backfill.sql
\i supabase/migrations/20261114120000_capture_clock_naive_utc.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_clock_naive_utc_apply(uuid,uuid,timestamptz,jsonb)', 'EXECUTE'), 'anon cannot apply');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_clock_naive_utc_apply(uuid,uuid,timestamptz,jsonb)', 'EXECUTE'), 'authenticated cannot apply');

CREATE FUNCTION pg_temp.k(src text, run text, dto text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT jsonb_build_object('DateTimeOriginal', dto, 'capture_clock', jsonb_build_object('source', src, 'run_id', run, 'producer', 't', 'prior_taken_at', null)) $$;

-- session TZ is America/Los_Angeles: eligibility must still see 08:47Z as naive-UTC
SELECT pg_temp.assert_true(capture_clock_naive_utc_apply('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
  '2026-03-12 15:47:06Z', pg_temp.k('zone_fallback_la', 'b0000000-0000-4000-8000-000000000001', '2026:03:12 08:47:06')) ->> 'status' = 'written', 'unfiled naive UTC written');
SELECT pg_temp.assert_true(capture_clock_naive_utc_apply('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004',
  '2026-03-12 15:47:06Z', pg_temp.k('file_exif', 'b0000000-0000-4000-8000-000000000001', '2026:03:12 08:47:06')) ->> 'status' = 'written', 'filed naive UTC written');

SELECT pg_temp.assert_true(capture_clock_naive_utc_apply('b0000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-00000000000' || n)::uuid,
  '2026-03-12 15:47:06Z', pg_temp.k('zone_fallback_la', 'b0000000-0000-4000-8000-000000000001', '2026:03:12 08:47:06')) ->> 'status' = 'skipped_not_eligible',
  'ineligible untouched: ' || n) FROM generate_series(2, 3) n;
SELECT pg_temp.assert_true(capture_clock_naive_utc_apply('b0000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-00000000000' || n)::uuid,
  '2026-03-12 15:47:06Z', pg_temp.k('zone_fallback_la', 'b0000000-0000-4000-8000-000000000001', '2026:03:12 08:47:06')) ->> 'status' = 'skipped_not_eligible',
  'ineligible untouched: ' || n) FROM generate_series(5, 7) n;

DO $$ BEGIN
  PERFORM capture_clock_naive_utc_apply('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', now(),
    pg_temp.k('guess', 'b0000000-0000-4000-8000-000000000001', 'x'));
  RAISE EXCEPTION 'unsigned source accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%unsigned%' THEN RAISE; END IF; END $$;

SELECT pg_temp.assert_true((SELECT taken_at = '2026-03-12 15:47:06Z' AND exif_data ->> 'DateTimeOriginal' = '2026:03:12 08:47:06'
  AND exif_data -> 'capture_clock' ->> 'run_id' = 'b0000000-0000-4000-8000-000000000001'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001'), 'unfiled clock corrected, DTO kept');
SELECT pg_temp.assert_true((SELECT taken_at = '2026-03-12 15:47:06Z' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000004'), 'filed clock corrected');
SELECT pg_temp.assert_true((SELECT taken_at = '2026-03-12 15:47:06Z' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000002'), 'already-correct untouched');
SELECT pg_temp.assert_true((SELECT taken_at = '2026-03-12 08:47:06Z' AND is_sensitive FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000003'), 'sensitive untouched');
SELECT pg_temp.assert_true((SELECT taken_at = '2026-03-12 08:47:06Z' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000005'), 'rejected_personal untouched');

-- second apply of the same corrected row is refused (taken_at is no longer naive UTC)
SELECT pg_temp.assert_true(capture_clock_naive_utc_apply('b0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
  '2026-03-12 16:47:06Z', pg_temp.k('zone_fallback_la', 'b0000000-0000-4000-8000-000000000002', '2026:03:12 08:47:06')) ->> 'status' = 'skipped_not_eligible',
  'already-corrected row not rewritten');

-- revert restores
SELECT pg_temp.assert_true((capture_clock_naive_utc_revert('b0000000-0000-4000-8000-000000000001') ->> 'restorable')::int = 2, 'dry revert counts both writes');
SELECT pg_temp.assert_true((SELECT taken_at = '2026-03-12 15:47:06Z' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001'), 'dry revert writes nothing');
SELECT pg_temp.assert_true((capture_clock_naive_utc_revert('b0000000-0000-4000-8000-000000000001', false) ->> 'restorable')::int = 2, 'live revert');
SELECT pg_temp.assert_true((SELECT taken_at = '2026-03-12 08:47:06Z' AND NOT (exif_data ? 'capture_clock')
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000001'), 'unfiled restored exactly');
SELECT pg_temp.assert_true((SELECT taken_at = '2026-03-12 08:47:06Z' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000004'), 'filed restored');

-- migration revert refuses while a run is unreverted: re-apply one row, then the revert SQL should raise
SELECT pg_temp.assert_true(capture_clock_naive_utc_apply('b0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
  '2026-03-12 15:47:06Z', pg_temp.k('zone_fallback_la', 'b0000000-0000-4000-8000-000000000003', '2026:03:12 08:47:06')) ->> 'status' = 'written', 're-apply for revert guard');
DO $$ BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM capture_clock_backfill_log WHERE reverted_at IS NULL) THEN RAISE EXCEPTION 'unreverted'; END IF;
    RAISE EXCEPTION 'expected an unreverted row';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'unreverted' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_true((capture_clock_naive_utc_revert('b0000000-0000-4000-8000-000000000003', false) ->> 'restorable')::int = 1, 'cleanup revert');
