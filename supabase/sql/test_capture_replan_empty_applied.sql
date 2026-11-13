-- Contract: 20261114120100 empty-applied re-arm. Requires empty disposable dm_refinement_capture_replan_empty* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_replan_empty%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, source text, exif_data jsonb, image_url text,
  taken_at timestamptz, created_at timestamptz DEFAULT now(), is_duplicate boolean, is_superseded boolean,
  is_sensitive boolean, vision_gate_status text);
CREATE TABLE public.capture_set_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text, image_ids uuid[],
  to_vehicle_id uuid, status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, t_from timestamptz, t_to timestamptz,
  state text, dry boolean DEFAULT false, stats jsonb, run_id uuid DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE public.capture_set_rescore_queue (
  user_id uuid, day date, requested_at timestamptz, not_before date, reasons jsonb, done_at timestamptz, done_run_id uuid,
  PRIMARY KEY (user_id, day));
CREATE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO capture_set_rescore_queue AS q (user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE
    SET requested_at = now(), not_before = least(q.not_before, current_date), done_at = NULL, done_run_id = NULL,
        reasons = q.reasons || jsonb_build_array(p_reason)
$f$;
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['capture_relay_ios','iphoto','iphoto_60d','photo_auto_sync','library_recovery'] $$;
CREATE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS
$$ SELECT p_source = ANY (public.capture_set_photo_sources())
       OR (p_vehicle_id IS NULL AND (p_source IN ('user_upload','owner_upload','drop-folder') OR p_source LIKE 'direct\_pull\_%')
           AND coalesce(p_exif ? 'DateTimeOriginal', false)) $$;

\i supabase/migrations/20261114120100_capture_replan_empty_applied.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_sets_arm_empty_applied(uuid,integer,integer,boolean)', 'EXECUTE'), 'anon cannot arm');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_sets_arm_empty_applied(uuid,integer,integer,boolean)', 'EXECUTE'), 'authenticated cannot arm');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'public.capture_empty_applied_retry_epoch', 'SELECT'), 'epoch table private');

-- freeze the epoch so we can place chunks before/after it
UPDATE capture_empty_applied_retry_epoch SET epoch = '2026-11-09 18:00Z' WHERE id;

DO $$
DECLARE
  u uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  -- LA days: 2020-01-28 and 2020-01-29 (winter, UTC = LA+8)
  d1_from timestamptz := '2020-01-28 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d1_to   timestamptz := '2020-01-29 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d2_from timestamptz := '2020-01-29 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d2_to   timestamptz := '2020-01-30 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d3_from timestamptz := '2020-01-30 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d3_to   timestamptz := '2020-01-31 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d4_from timestamptz := '2020-01-31 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d4_to   timestamptz := '2020-02-01 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d5_from timestamptz := '2020-02-01 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
  d5_to   timestamptz := '2020-02-02 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
BEGIN
  -- day 1: empty applied (before epoch) + 2 eligible photo_auto_sync photos
  INSERT INTO capture_landing_chunks (id, user_id, t_from, t_to, state, dry, stats, created_at)
  VALUES ('10000000-0000-4000-8000-000000000001', u, d1_from, d1_to, 'applied', false,
          '{"sets":0,"clear_sets":0,"review_sets":0}', '2026-11-09 14:11Z');
  INSERT INTO vehicle_images (id, user_id, source, image_url, taken_at, is_sensitive, is_duplicate, is_superseded)
  VALUES ('20000000-0000-4000-8000-000000000001', u, 'photo_auto_sync', 'https://x/1.jpg', d1_from + interval '10 hours', false, false, false),
         ('20000000-0000-4000-8000-000000000002', u, 'photo_auto_sync', 'https://x/2.jpg', d1_from + interval '11 hours', false, false, false);

  -- day 2: empty applied + only an empty-url iOS hold — must not arm
  INSERT INTO capture_landing_chunks (id, user_id, t_from, t_to, state, dry, stats, created_at)
  VALUES ('10000000-0000-4000-8000-000000000002', u, d2_from, d2_to, 'applied', false,
          '{"sets":0,"clear_sets":0,"review_sets":0}', '2026-11-09 14:11Z');
  INSERT INTO vehicle_images (id, user_id, source, image_url, taken_at, is_sensitive)
  VALUES ('20000000-0000-4000-8000-000000000003', u, 'capture_relay_ios', '', d2_from + interval '10 hours', false);

  -- day 3: nonempty applied (sets=1) + eligible photo — must not arm
  INSERT INTO capture_landing_chunks (id, user_id, t_from, t_to, state, dry, stats, created_at)
  VALUES ('10000000-0000-4000-8000-000000000003', u, d3_from, d3_to, 'applied', false,
          '{"sets":1,"clear_sets":0,"review_sets":1}', '2026-11-09 14:11Z');
  INSERT INTO vehicle_images (id, user_id, source, image_url, taken_at)
  VALUES ('20000000-0000-4000-8000-000000000004', u, 'photo_auto_sync', 'https://x/4.jpg', d3_from + interval '10 hours');

  -- day 4: empty applied created AFTER the epoch — loop-proof, must not arm
  INSERT INTO capture_landing_chunks (id, user_id, t_from, t_to, state, dry, stats, created_at)
  VALUES ('10000000-0000-4000-8000-000000000004', u, d4_from, d4_to, 'applied', false,
          '{"sets":0,"clear_sets":0,"review_sets":0}', '2026-11-09 19:00Z');
  INSERT INTO vehicle_images (id, user_id, source, image_url, taken_at)
  VALUES ('20000000-0000-4000-8000-000000000005', u, 'photo_auto_sync', 'https://x/5.jpg', d4_from + interval '10 hours');

  -- day 5: empty applied + sensitive photo only — must not arm
  INSERT INTO capture_landing_chunks (id, user_id, t_from, t_to, state, dry, stats, created_at)
  VALUES ('10000000-0000-4000-8000-000000000005', u, d5_from, d5_to, 'applied', false,
          '{"sets":0,"clear_sets":0,"review_sets":0}', '2026-11-09 14:11Z');
  INSERT INTO vehicle_images (id, user_id, source, image_url, taken_at, is_sensitive)
  VALUES ('20000000-0000-4000-8000-000000000006', u, 'photo_auto_sync', 'https://x/6.jpg', d5_from + interval '10 hours', true);
END $$;

-- dry run lists only day 1 (2 photos)
SELECT pg_temp.assert_true(
  (capture_sets_arm_empty_applied('0b9f107a-d124-49de-9ded-94698f63c1c4', 20, 50, true) ->> 'photos')::int = 2
  AND (capture_sets_arm_empty_applied('0b9f107a-d124-49de-9ded-94698f63c1c4', 20, 50, true) ->> 'n_days')::int = 1
  AND (capture_sets_arm_empty_applied('0b9f107a-d124-49de-9ded-94698f63c1c4', 20, 50, true) -> 'days' -> 0 ->> 'day' = '2020-01-28'),
  'dry lists only the empty-applied day with eligible URL photos');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM capture_set_rescore_queue), 'dry writes nothing');

-- live enqueue
SELECT pg_temp.assert_true(
  (capture_sets_arm_empty_applied('0b9f107a-d124-49de-9ded-94698f63c1c4', 20, 50, false) ->> 'n_days')::int = 1,
  'live arms day 1');
SELECT pg_temp.assert_true(
  (SELECT reasons -> 0 ->> 'empty_applied_retry' = 'true' AND done_at IS NULL
     FROM capture_set_rescore_queue WHERE day = '2020-01-28'),
  'queue row signed empty_applied_retry and pending');

-- pending queue is not armed again
SELECT pg_temp.assert_true(
  (capture_sets_arm_empty_applied('0b9f107a-d124-49de-9ded-94698f63c1c4', 20, 50, true) ->> 'n_days')::int = 0,
  'pending day not re-listed');

-- after the pending row is marked done, a later empty applied plan (created after epoch) still is not armed
UPDATE capture_set_rescore_queue SET done_at = now(), done_run_id = gen_random_uuid() WHERE day = '2020-01-28';
INSERT INTO capture_landing_chunks (user_id, t_from, t_to, state, dry, stats, created_at)
VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4',
        '2020-01-28 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
        '2020-01-29 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
        'applied', false, '{"sets":0}', '2026-11-09 20:00Z');
SELECT pg_temp.assert_true(
  (capture_sets_arm_empty_applied('0b9f107a-d124-49de-9ded-94698f63c1c4', 20, 50, true) ->> 'n_days')::int = 0,
  'post-epoch empty plan is not retried');
