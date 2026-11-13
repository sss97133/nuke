-- capture_replan_vehicle_leftovers_v1: enqueue leftover vehicle-typed days; do not file.
-- Also covers the 20261115200000 idempotent follow-up: skip unreverted log rows and
-- days refused_no_new_evidence until capture_day_replan_state reports new evidence.
-- Also covers 20261115210000: a no-clock leftover (taken_at null, day from created_at)
-- is not enqueued, because the live scorer cannot use it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_replan_vehicle_leftovers%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_replan_vehicle_leftovers* database';
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
  is_sensitive boolean DEFAULT false, image_url text, file_name text, exif_data jsonb, ai_scan_metadata jsonb);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], reason text, status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text, dry boolean, t_from timestamptz, t_to timestamptz);
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
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
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['photo_auto_sync']::text[] $$;
CREATE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p_source = ANY (public.capture_set_photo_sources()) OR (p_exif ? 'DateTimeOriginal') $$;

-- Stub of the live drain helper: the producer must call this, not reimplement evidence.
CREATE TABLE public._test_replan_reasons(day date PRIMARY KEY, reason text NOT NULL);
INSERT INTO public._test_replan_reasons(day, reason) VALUES ('2026-05-01', 'refused_no_new_evidence');
CREATE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date)
 RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'blocked', coalesce((SELECT r.reason = 'refused_no_new_evidence' FROM public._test_replan_reasons r WHERE r.day = p_day), false),
    'reason', coalesce((SELECT r.reason FROM public._test_replan_reasons r WHERE r.day = p_day), 'last_plan_applied'));
$$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261115193000_capture_replan_vehicle_leftovers.sql
\i supabase/migrations/20261115200000_capture_replan_vehicle_leftovers_idempotent.sql
\i supabase/migrations/20261115210000_capture_replan_vehicle_leftovers_require_clock.sql

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, source, is_sensitive, image_url, file_name, exif_data, ai_scan_metadata) VALUES
 -- leftover exterior on a previously planned day (LA 2026-03-01)
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 20:00+00', 'photo_auto_sync', false, 'https://example.invalid/a1', 'a1.jpg', '{"DateTimeOriginal":"2026:03:01 12:00:00"}', '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 21:00+00', 'photo_auto_sync', false, 'https://example.invalid/a2', 'a2.jpg', '{"DateTimeOriginal":"2026:03:01 13:00:00"}', '{"classification":{"image_type":"engine_bay"}}'),
 -- typ=other must not be picked
 ('00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 22:00+00', 'photo_auto_sync', false, 'https://example.invalid/o1', 'o1.jpg', '{"DateTimeOriginal":"2026:03:01 14:00:00"}', '{"classification":{"image_type":"other"}}'),
 -- already held
 ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 23:00+00', 'photo_auto_sync', false, 'https://example.invalid/h1', 'h1.jpg', '{"DateTimeOriginal":"2026:03:01 15:00:00"}', '{"classification":{"image_type":"vehicle_interior"}}'),
 -- no prior plan day
 ('00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-04-01 20:00+00', 'photo_auto_sync', false, 'https://example.invalid/n1', 'n1.jpg', '{"DateTimeOriginal":"2026:04:01 12:00:00"}', '{"classification":{"image_type":"vehicle_exterior"}}'),
 -- leftover on a gate-failed day the helper still reports as refused_no_new_evidence
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-05-01 20:00+00', 'photo_auto_sync', false, 'https://example.invalid/b1', 'b1.jpg', '{"DateTimeOriginal":"2026:05:01 12:00:00"}', '{"classification":{"image_type":"vehicle_exterior"}}');
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, created_at, source, is_sensitive, image_url, file_name, exif_data, ai_scan_metadata) VALUES
 -- no-clock leftover on the already-planned day: created_at falls on 2026-03-01 LA, taken_at is null
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, '2026-03-01 20:30+00', 'photo_auto_sync', false, 'https://example.invalid/nclock', 'nclock.jpg', '{}', '{"classification":{"image_type":"vehicle_exterior"}}');


INSERT INTO capture_landing_chunks(id, user_id, state, dry, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'applied', false, '2026-03-01 08:00+00', '2026-03-02 08:00+00'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'gate_failed', false, '2026-05-01 07:00+00', '2026-05-02 07:00+00');
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, status)
VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:H', '{00000000-0000-4000-8000-0000000000f4}', 'no_clear_lead', 'open');

SELECT public.capture_replan_vehicle_leftovers_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS dry \gset
SELECT pg_temp.assert_true((:'dry')::jsonb->>'taken' = '2', 'dry takes two leftover vehicle typ frames');
SELECT pg_temp.assert_true((:'dry')::jsonb->>'days' = '1', 'one day');
SELECT pg_temp.assert_true(NOT ((:'dry')::jsonb->'items' @> '[{"image_id":"00000000-0000-4000-8000-0000000000b1"}]'::jsonb),
  'dry skips the refused_no_new_evidence day');
SELECT pg_temp.assert_true(NOT ((:'dry')::jsonb->'items' @> '[{"image_id":"00000000-0000-4000-8000-0000000000e1"}]'::jsonb),
  'dry skips the no-clock leftover the scorer cannot use');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM capture_set_rescore_queue), 'dry does not enqueue');

SELECT public.capture_replan_vehicle_leftovers_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS ap \gset
SELECT pg_temp.assert_true((:'ap')::jsonb->>'taken' = '2', 'apply takes 2');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM capture_replan_vehicle_log WHERE image_id = '00000000-0000-4000-8000-0000000000e1'),
  'apply does not log the no-clock leftover');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 1, 'one day enqueued');
SELECT pg_temp.assert_true((SELECT day FROM capture_set_rescore_queue) = '2026-03-01', 'LA day 2026-03-01');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id IS NOT NULL), 'did not file');
SELECT requested_at AS q_at FROM capture_set_rescore_queue \gset

SELECT public.capture_replan_vehicle_leftovers_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS ap2 \gset
SELECT pg_temp.assert_true((:'ap2')::jsonb->>'taken' = '0', 'second apply skips already-logged unreverted ids and the refused day');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 1, 'second apply does not enqueue another day');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_replan_vehicle_log WHERE run_id = '00000000-0000-4000-8000-000000000103') = 0,
  'second apply writes no log rows');
SELECT pg_temp.assert_true((SELECT requested_at FROM capture_set_rescore_queue) = :'q_at'::timestamptz,
  'second apply does not reset requested_at');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue WHERE reasons @> jsonb_build_array(jsonb_build_object('replan_vehicle_leftovers', '00000000-0000-4000-8000-000000000103'::uuid))) = 0,
  'second apply does not re-arm the queued day');

SELECT public.capture_replan_vehicle_leftovers_revert_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000102') AS rv \gset
SELECT pg_temp.assert_true((:'rv')::jsonb->>'queue_cleared' = '1', 'pending queue row cleared');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 'queue empty after revert');

UPDATE public._test_replan_reasons SET reason = 'new_evidence_since_refusal' WHERE day = '2026-05-01';

SELECT public.capture_replan_vehicle_leftovers_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS ap3 \gset
SELECT pg_temp.assert_true((:'ap3')::jsonb->>'taken' = '3', 'after revert and new evidence, takes the original two plus the unblocked leftover');
SELECT pg_temp.assert_true(NOT ((:'ap3')::jsonb->'items' @> '[{"image_id":"00000000-0000-4000-8000-0000000000e1"}]'::jsonb),
  'no-clock leftover still skipped after new evidence on the refused day');
SELECT pg_temp.assert_true((:'ap3')::jsonb->>'days' = '2', 'both days enqueued once evidence arrives');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 2, 'two days in the queue');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue WHERE day IN ('2026-03-01','2026-05-01')) = 2, '2026-03-01 and 2026-05-01');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id IS NOT NULL), 'still did not file');

SELECT public.capture_replan_vehicle_leftovers_revert_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000104') AS rv2 \gset
SELECT pg_temp.assert_true((:'rv2')::jsonb->>'queue_cleared' = '2', 'both pending queue rows cleared');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 'queue empty after second revert');
