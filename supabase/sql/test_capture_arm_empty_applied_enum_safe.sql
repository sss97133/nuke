-- Contract: 20261115122000 arm enum-safe + scorer-aligned eligibility. Disposable DB only.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_arm%' THEN
    RAISE EXCEPTION 'refusing: not a disposable contract database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

-- 1) The defect: coalesce(enum, '') is 22P02 whenever the value is NULL.
CREATE TYPE public.vision_gate_status AS ENUM (
  'pending', 'rejected_personal', 'rejected_misattributed'
);
CREATE TABLE pg_temp.enum_probe (status public.vision_gate_status);
INSERT INTO pg_temp.enum_probe VALUES (NULL), ('pending');
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM pg_temp.enum_probe WHERE coalesce(status, '') NOT IN ('rejected_personal', 'rejected_misattributed');
  EXCEPTION WHEN invalid_text_representation THEN
    ok := (SQLSTATE = '22P02' AND SQLERRM LIKE '%""%');
  END;
  PERFORM pg_temp.assert_true(ok, 'coalesce(enum, '''') must raise 22P02');
END $$;
-- The replacement predicate accepts NULL and pending, and excludes rejected_personal.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM pg_temp.enum_probe
    WHERE status IS NULL OR status NOT IN ('rejected_personal', 'rejected_misattributed')) = 2,
  'enum-safe predicate accepts NULL and pending');

-- 2) Stub the objects the live arm body reads, then install the exact 20261114120100 body.
CREATE TABLE public.capture_empty_applied_retry_epoch (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  epoch timestamptz NOT NULL,
  note text
);
INSERT INTO public.capture_empty_applied_retry_epoch (id, epoch, note)
VALUES (true, '2026-11-10 05:55:17.781171+00', '20261114120100 initial empty-applied retry');

CREATE TABLE public.capture_landing_chunks (
  id uuid PRIMARY KEY,
  user_id uuid,
  t_from timestamptz,
  t_to timestamptz,
  dry boolean,
  state text,
  stats jsonb,
  created_at timestamptz
);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY,
  user_id uuid,
  vehicle_id uuid,
  taken_at timestamptz,
  image_url text,
  is_sensitive boolean,
  vision_gate_status public.vision_gate_status,
  is_duplicate boolean,
  is_superseded boolean,
  source text,
  exif_data jsonb,
  ai_scan_metadata jsonb
);
CREATE TABLE public.capture_set_review (
  user_id uuid, status text, image_ids uuid[]
);
CREATE TABLE public.capture_set_rescore_queue (
  user_id uuid, day date, done_at timestamptz
);
CREATE TABLE public.enqueue_log (user_id uuid, day date, reason jsonb);
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['capture_relay_ios', 'iphoto', 'iphoto_60d', 'photo_auto_sync', 'library_recovery']
$$;
CREATE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND p_source IN ('user_upload', 'owner_upload', 'drop-folder', 'image_intake')
          AND coalesce(p_exif ? 'DateTimeOriginal', false))
$$;
CREATE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.enqueue_log(user_id, day, reason) VALUES (p_user, p_day, p_reason)
$$;

\i supabase/sql/live_arm_20261114120100.sql
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.capture_sets_arm_empty_applied(uuid,integer,integer,boolean)'::regprocedure))
    = 'de588cd42d44c91b15a31b6b40e3ead1',
  'installed live 20261114120100 body matches recorded md5');

-- One owner, four days: typ-null library (should arm after the fix), typ=other library,
-- admitted user_upload (wagon), and a typ-null library on a post-epoch empty chunk.
INSERT INTO public.capture_landing_chunks VALUES
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa',
  '2010-06-01 07:00:00-07', '2010-06-02 07:00:00-07', false, 'applied', '{"sets":0}',
  '2026-11-10 05:50:00+00'), -- pre-epoch
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa',
  '2013-06-26 07:00:00-07', '2013-06-27 07:00:00-07', false, 'applied', '{"sets":0}',
  '2026-11-10 05:50:00+00'),
 ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000aa',
  '2011-03-12 07:00:00-08', '2011-03-13 07:00:00-08', false, 'applied', '{"sets":0}',
  '2026-11-10 05:50:00+00'),
 ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000aa',
  '2023-08-14 07:00:00-07', '2023-08-15 07:00:00-07', false, 'applied', '{"sets":0}',
  '2026-11-10 10:26:59+00'); -- after epoch

INSERT INTO public.vehicle_images VALUES
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2010-06-01 15:00:00-07', 'https://example/a.jpg', false, NULL, false, false,
  'photo_auto_sync', '{}', '{}'), -- typ none, library, pre-epoch: eligible after fix
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2013-06-26 15:00:00-07', 'https://example/b.jpg', false, NULL, false, false,
  'photo_auto_sync', '{}', '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2011-03-13 01:12:47+00', 'https://example/c.jpg', false, NULL, false, false,
  'user_upload', '{"DateTimeOriginal":"2011:03:12 18:12:47"}', '{}'),
 ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2023-08-14 15:00:00-07', 'https://example/d.jpg', false, NULL, false, false,
  'iphoto', '{}', '{}'); -- would be eligible but chunk is after epoch

-- 3) Live body cannot dry-run: NULL vision_gate_status trips 22P02.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.capture_sets_arm_empty_applied('00000000-0000-4000-8000-0000000000aa', 20, 50, true);
  EXCEPTION WHEN invalid_text_representation THEN
    ok := (SQLSTATE = '22P02');
  END;
  PERFORM pg_temp.assert_true(ok, 'live arm dry-run must raise 22P02');
END $$;

\i supabase/migrations/20261115122000_capture_arm_empty_applied_enum_safe.sql
SELECT pg_temp.assert_true(position('(20261115122000)' in
  pg_get_functiondef('public.capture_sets_arm_empty_applied(uuid,integer,integer,boolean)'::regprocedure)) > 0,
  'new body carries the version marker');

-- 4) Dry-run no longer throws. Only the typ-none library photo on a pre-epoch empty day is armed.
DO $$
DECLARE j jsonb;
BEGIN
  j := public.capture_sets_arm_empty_applied('00000000-0000-4000-8000-0000000000aa', 20, 50, true);
  PERFORM pg_temp.assert_true((j->>'dry')::boolean IS TRUE, 'dry flag');
  PERFORM pg_temp.assert_true((j->>'n_days')::int = 2, 'two pre-epoch typ-none days armed');
  PERFORM pg_temp.assert_true((j->>'photos')::int = 2, 'two typ-none photos');
  PERFORM pg_temp.assert_true(j->'days'->0->>'day' = '2010-06-01', 'first armed day is typ-none library');
  PERFORM pg_temp.assert_true(j->'days'->1->>'day' = '2011-03-12', 'second armed day is typ-none user_upload');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM enqueue_log) = 0, 'dry-run must not enqueue');
  PERFORM pg_temp.assert_true(
    (SELECT epoch FROM capture_empty_applied_retry_epoch WHERE id)
      = '2026-11-10 05:55:17.781171+00',
    'epoch is not bumped');
END $$;

-- 5) Revert restores the 20261114120100 body (and the 22P02 defect).
\i supabase/sql/revert_20261115122000_capture_arm_empty_applied_enum_safe.sql
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.capture_sets_arm_empty_applied(uuid,integer,integer,boolean)'::regprocedure))
    = 'de588cd42d44c91b15a31b6b40e3ead1',
  'revert restored the 20261114120100 md5');
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.capture_sets_arm_empty_applied('00000000-0000-4000-8000-0000000000aa', 20, 50, true);
  EXCEPTION WHEN invalid_text_representation THEN
    ok := (SQLSTATE = '22P02');
  END;
  PERFORM pg_temp.assert_true(ok, 'reverted arm dry-run raises 22P02 again');
END $$;
