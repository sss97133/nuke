-- capture_ledger_states timeout fix (20261115190000): same states as the live
-- 20261115180000 body; held/waiting/failed are MATERIALIZED; custom plan is forced.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_ledger_states_timeout%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_ledger_states_timeout* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  source text, vision_gate_status public.vision_gate_status, is_document boolean DEFAULT false, exif_data jsonb,
  thumbnail_url text, image_url text, file_name text,
  is_duplicate boolean DEFAULT false, duplicate_of uuid);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], reason text, evidence jsonb DEFAULT '{}', status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, stage text, error_class text);

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/sql/helpers/capture_ledger_live_parent_20261115190000.sql

SELECT pg_temp.assert_true(md5(p.prosrc) = '1307e6cf833f75cd8258e94db811dfc2', 'parent states md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) = '4d1a11f924dbc4e22da93ee6aba02d44', 'parent frames md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';

INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa');
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, source, vision_gate_status, image_url, file_name, is_duplicate, duplicate_of) VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-01 18:00+00', 'iphoto', 'approved', 'i1', 'orig_filed.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:01+00', 'iphoto', 'pending', 'i2', 'orig_held.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:02+00', 'iphoto', 'rejected_personal', 'i3', 'orig_private.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:03+00', 'iphoto', 'rejected_misattributed', 'i4', 'orig_pulled.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:04+00', 'iphoto', 'pending', 'i5', 'orig_unsorted.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:10+00', 'iphoto', 'pending', 'c1', 'copy_filed.jpg', true, '00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:11+00', 'iphoto', 'pending', 'c2', 'copy_held.jpg', true, '00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:12+00', 'iphoto', 'pending', 'c3', 'copy_private.jpg', true, '00000000-0000-4000-8000-000000000003'),
 ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:13+00', 'iphoto', 'pending', 'c4', 'copy_pulled.jpg', true, '00000000-0000-4000-8000-000000000004'),
 ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:14+00', 'iphoto', 'pending', 'c5', 'copy_unsorted.jpg', true, '00000000-0000-4000-8000-000000000005'),
 ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:15+00', 'iphoto', 'pending', 'c6', 'copy_missing.jpg', true, '00000000-0000-4000-8000-000000000099');
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, status) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:H', '{00000000-0000-4000-8000-000000000002}', 'score_below_threshold', 'open');

CREATE TEMP TABLE pre_states AS
SELECT image_id, state, reason FROM public.capture_ledger_states(
  '00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01');

\i supabase/migrations/20261115190000_capture_ledger_states_timeout.sql

SELECT pg_temp.assert_true(p.prosrc LIKE '%held AS MATERIALIZED%', 'states held materialized')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(
  (SELECT unnest(p.proconfig) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='capture_ledger_states' AND p.proconfig IS NOT NULL LIMIT 1)
  LIKE 'plan_cache_mode=force_custom_plan'
  OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
    WHERE n.nspname='public' AND p.proname='capture_ledger_states' AND cfg = 'plan_cache_mode=force_custom_plan'),
  'states force_custom_plan');
SELECT pg_temp.assert_true(to_regclass('public.idx_capture_set_review_open_user') IS NOT NULL, 'open-review index exists');

CREATE TEMP TABLE post_states AS
SELECT image_id, state, reason FROM public.capture_ledger_states(
  '00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01');

SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM pre_states p FULL OUTER JOIN post_states n USING (image_id)
  WHERE p.state IS DISTINCT FROM n.state OR p.reason IS DISTINCT FROM n.reason
), 'states and reasons unchanged');

SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'duplicate', 'copy of filed');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'copy_of_held', 'copy of held');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000015') = 'unsorted', 'copy of unsorted original stays unsorted');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000016') = 'unsorted', 'copy of missing original stays unsorted');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000002') = 'held', 'held original');
