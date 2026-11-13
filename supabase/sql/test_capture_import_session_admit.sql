-- capture_import_session_admit_v1: admit user_upload by import session without writing DTO or taken_at.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_import_session_admit%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_import_session_admit* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  source text, vision_gate_status public.vision_gate_status DEFAULT 'pending',
  is_sensitive boolean DEFAULT false, image_url text, file_name text, exif_data jsonb);
CREATE TABLE public.capture_set_rescore_queue(
  user_id uuid, day date, requested_at timestamptz, not_before date, done_at timestamptz, done_run_id uuid, reasons jsonb DEFAULT '[]',
  PRIMARY KEY (user_id, day));
CREATE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb)
 RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.capture_set_rescore_queue(user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE SET requested_at = now(), done_at = NULL, done_run_id = NULL,
    reasons = capture_set_rescore_queue.reasons || jsonb_build_array(p_reason);
END $$;
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['photo_auto_sync','iphoto']::text[] $$;
CREATE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND (p_source = ANY (ARRAY['user_upload', 'owner_upload', 'drop-folder', 'image_intake']) OR p_source LIKE 'direct\_pull_%' ESCAPE '\')
          AND coalesce(p_exif ? 'DateTimeOriginal', false))
$function$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261115192000_capture_import_session_admit.sql

-- Parent admits (before migration already replaced): after migration, session flag admits, DTO still admits, no invent.
SELECT pg_temp.assert_true(public.capture_set_photo_admits('user_upload', NULL, '{"DateTimeOriginal":"2024:01:01 00:00:00"}'::jsonb), 'DTO still admits');
SELECT pg_temp.assert_true(NOT public.capture_set_photo_admits('user_upload', NULL, '{}'::jsonb), 'no flag, no DTO, not admitted');
SELECT pg_temp.assert_true(public.capture_set_photo_admits('user_upload', NULL, '{"import_session_admit":true}'::jsonb), 'session flag admits');
SELECT pg_temp.assert_true(public.capture_set_photo_admits('photo_auto_sync', NULL, '{}'::jsonb), 'library source still admits');

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, created_at, source, is_sensitive, image_url, file_name, exif_data) VALUES
 -- 3 no-clock user_uploads in a Dec-7-like wave, plus a clocked neighbour
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-06-22 18:00+00', '2025-12-07 16:40+00', 'user_upload', false, 'https://example.invalid/b1', 'b1.jpg', '{}'),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-06-22 18:01+00', '2025-12-07 16:41+00', 'user_upload', false, 'https://example.invalid/b2', 'b2.jpg', '{}'),
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-06-22 10:00+00', '2025-12-07 16:42+00', 'user_upload', false, 'https://example.invalid/c1', 'c1.jpg', '{"DateTimeOriginal":"2024:06:22 10:00:00"}'),
 -- filed neighbour wave (no DTO on the neighbour, but filed) like Nov 7
 ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-01-01 00:00+00', '2025-11-07 14:27+00', 'user_upload', false, 'https://example.invalid/b3', 'b3.jpg', '{}'),
 ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ee', '2024-01-01 00:01+00', '2025-11-07 14:28+00', 'iphoto', false, 'https://example.invalid/f1', 'f1.jpg', '{}'),
 -- isolated, no neighbour
 ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-02-01 00:00+00', '2025-08-01 12:00+00', 'user_upload', false, 'https://example.invalid/z1', 'z1.jpg', '{}'),
 -- empty url
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-06-22 18:00+00', '2025-12-07 16:40:30+00', 'user_upload', false, NULL, 'e1.jpg', '{}'),
 -- already has DTO
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-06-22 18:00+00', '2025-12-07 16:43+00', 'user_upload', false, 'https://example.invalid/d1', 'd1.jpg', '{"DateTimeOriginal":"2024:06:22 18:00:00"}');

-- dry
SELECT public.capture_import_session_admit_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS dry \gset
SELECT pg_temp.assert_true((:'dry')::jsonb->>'taken' = '3', 'dry takes b1,b2 (clocked neighbour) and b3 (filed neighbour)');
SELECT pg_temp.assert_true((:'dry')::jsonb->>'eligible' = '3', 'eligible is 3');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM vehicle_images WHERE exif_data ? 'import_session_admit'), 'dry writes no flag');

-- apply cap 2 first
SELECT public.capture_import_session_admit_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-0000000000cc', false, 2) AS a1 \gset
SELECT pg_temp.assert_true((:'a1')::jsonb->>'taken' = '2', 'cap 2');
SELECT pg_temp.assert_true((SELECT taken_at FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000b1') = '2024-06-22 18:00+00', 'taken_at unchanged');
SELECT pg_temp.assert_true(NOT (SELECT exif_data ? 'DateTimeOriginal' FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000b1'), 'no DTO invented');
SELECT pg_temp.assert_true((SELECT (exif_data->>'import_session_admit')::boolean FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000b1'), 'flag set on b1');
SELECT pg_temp.assert_true(public.capture_set_photo_admits('user_upload', NULL, (SELECT exif_data FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000b1')), 'b1 now admits');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) >= 1, 'days enqueued');
-- clocked neighbour DTO unchanged
SELECT pg_temp.assert_true((SELECT exif_data->>'DateTimeOriginal' FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000c1') = '2024:06:22 10:00:00', 'neighbour clock untouched');

-- second run gets the remainder
SELECT public.capture_import_session_admit_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS a2 \gset
SELECT pg_temp.assert_true((:'a2')::jsonb->>'taken' = '1', 'remainder is 1');

-- isolated row never admitted
SELECT pg_temp.assert_true(NOT coalesce((SELECT (exif_data->>'import_session_admit')::boolean FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000a9'), false), 'isolated not admitted');
SELECT pg_temp.assert_true(NOT coalesce((SELECT (exif_data->>'import_session_admit')::boolean FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e1'), false), 'empty_url not admitted');

-- revert first run
SELECT public.capture_import_session_admit_revert_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000102') AS rv \gset
SELECT pg_temp.assert_true(NOT coalesce((SELECT (exif_data->>'import_session_admit')::boolean FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000b1'), false), 'revert cleared flag');
SELECT pg_temp.assert_true((SELECT taken_at FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000b1') = '2024-06-22 18:00+00', 'taken_at still unchanged after revert');
SELECT pg_temp.assert_true((SELECT exif_data->>'DateTimeOriginal' FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000c1') = '2024:06:22 10:00:00', 'neighbour clock still untouched');
