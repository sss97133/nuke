-- Capture ledger dup-chain + copy_of_non_vehicle (20261115220000): an unfiled
-- byte-identical copy of a filed, held, private, pulled, or non_vehicle original
-- counts as duplicate, including when the path walks through other unfiled copies.
-- A missing original, a cycle, or an unresolved chain does not. No row writes.
-- The pre-patch parent is the live #3302 ledger (md5 379d2ec7 / 5d801d4f).
-- PR title is conventional and at most 72 characters.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_ledger_dup_chain%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_ledger_dup_chain* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;

CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, year integer, make text, model text);
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
CREATE TABLE public.capture_non_vehicle_log(
  run_id uuid, image_id uuid, user_id uuid, granted_by uuid, typ text, verdict text, reason text, day date,
  signature text, applied_at timestamptz DEFAULT now(), reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id));

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/sql/helpers/capture_ledger_live_parent_20261115220000.sql

-- Parent md5s must match the live #3302 bodies this migration is written against.
SELECT pg_temp.assert_true(md5(p.prosrc) = '379d2ec73bdd7acc4332550be0bc18e0', 'parent states md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) = '5d801d4ff02d23e260bd17465a67bb56', 'parent frames md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';

INSERT INTO vehicles VALUES
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', 1973, 'Pontiac', 'Firebird');
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, source, vision_gate_status, image_url, file_name, is_duplicate, duplicate_of) VALUES
 -- originals
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-01 18:00+00', 'iphoto', 'approved', 'i1', 'orig_filed.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:01+00', 'iphoto', 'pending', 'i2', 'orig_held.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:02+00', 'iphoto', 'rejected_personal', 'i3', 'orig_private.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:03+00', 'iphoto', 'rejected_misattributed', 'i4', 'orig_pulled.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:04+00', 'iphoto', 'pending', 'i5', 'orig_unsorted.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:05+00', 'iphoto', 'pending', 'i6', 'orig_non_vehicle.jpg', false, NULL),
 -- mid-chain unfiled copies (immediate original is the resolved root)
 ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:20+00', 'iphoto', 'pending', 'm1', 'mid_filed.jpg', true, '00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:21+00', 'iphoto', 'pending', 'm2', 'mid_held.jpg', true, '00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000026', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:22+00', 'iphoto', 'pending', 'm6', 'mid_non_vehicle.jpg', true, '00000000-0000-4000-8000-000000000006'),
 -- immediate copies
 ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:10+00', 'iphoto', 'pending', 'c1', 'copy_filed.jpg', true, '00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:11+00', 'iphoto', 'pending', 'c2', 'copy_held.jpg', true, '00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:12+00', 'iphoto', 'pending', 'c3', 'copy_private.jpg', true, '00000000-0000-4000-8000-000000000003'),
 ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:13+00', 'iphoto', 'pending', 'c4', 'copy_pulled.jpg', true, '00000000-0000-4000-8000-000000000004'),
 ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:14+00', 'iphoto', 'pending', 'c5', 'copy_unsorted.jpg', true, '00000000-0000-4000-8000-000000000005'),
 ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:15+00', 'iphoto', 'pending', 'c6', 'copy_missing.jpg', true, '00000000-0000-4000-8000-000000000099'),
 ('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:16+00', 'iphoto', 'pending', 'c7', 'copy_non_vehicle.jpg', true, '00000000-0000-4000-8000-000000000006'),
 -- second-hop copies (point at the mid-chain copy, not the resolved root)
 ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:30+00', 'iphoto', 'pending', 'h1', 'hop_filed.jpg', true, '00000000-0000-4000-8000-000000000021'),
 ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:31+00', 'iphoto', 'pending', 'h2', 'hop_held.jpg', true, '00000000-0000-4000-8000-000000000022'),
 ('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:32+00', 'iphoto', 'pending', 'h6', 'hop_non_vehicle.jpg', true, '00000000-0000-4000-8000-000000000026'),
 -- cycle of two unfiled copies, no resolved root
 ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:40+00', 'iphoto', 'pending', 'y1', 'cycle_a.jpg', true, '00000000-0000-4000-8000-000000000042'),
 ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:41+00', 'iphoto', 'pending', 'y2', 'cycle_b.jpg', true, '00000000-0000-4000-8000-000000000041');
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, status) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:H', '{00000000-0000-4000-8000-000000000002}', 'score_below_threshold', 'open');
INSERT INTO capture_non_vehicle_log(run_id, image_id, user_id, granted_by, typ, verdict, reason, day, signature) VALUES
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000aa', 'other', 'non_vehicle', 'workshop scene', '2026-03-01', 'test');

CREATE TEMP TABLE pre_states AS
SELECT image_id, state, reason FROM public.capture_ledger_states(
  '00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01');

SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'duplicate'
  AND (SELECT reason FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'copy_of_filed',
  'pre: immediate copy of filed is already duplicate');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'duplicate'
  AND (SELECT reason FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'copy_of_held',
  'pre: immediate copy of held is already duplicate');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000013') = 'duplicate'
  AND (SELECT reason FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000013') = 'copy_of_private',
  'pre: immediate copy of private is already duplicate');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000014') = 'duplicate'
  AND (SELECT reason FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000014') = 'copy_of_pulled',
  'pre: immediate copy of pulled is already duplicate');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000015') = 'unsorted',
  'pre: copy of unsorted stays unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000016') = 'unsorted',
  'pre: copy of a missing original stays unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000017') = 'unsorted',
  'pre: immediate copy of non_vehicle is still unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000021') = 'duplicate',
  'pre: mid-chain copy of filed is already duplicate');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000031') = 'unsorted',
  'pre: second-hop copy of filed is still unsorted (immediate original is an unfiled copy)');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000032') = 'unsorted',
  'pre: second-hop copy of held is still unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000036') = 'unsorted',
  'pre: second-hop copy of non_vehicle is still unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000041') = 'unsorted'
  AND (SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000042') = 'unsorted',
  'pre: cycle stays unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000006') = 'non_vehicle',
  'pre: non_vehicle original is non_vehicle');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000001') = 'on_vehicle',
  'pre: filed original is on_vehicle');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000002') = 'held',
  'pre: held original is held');

\i supabase/migrations/20261115220000_capture_ledger_dup_chain.sql

CREATE TEMP TABLE post_states AS
SELECT image_id, state, reason FROM public.capture_ledger_states(
  '00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01');
CREATE TEMP TABLE post_frames AS
SELECT image_id, state, reason FROM public.capture_ledger_frames(
  '00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01');

SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'copy_of_filed',
  'post: immediate copy of filed stays duplicate / copy_of_filed');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'copy_of_held',
  'post: immediate copy of held stays duplicate / copy_of_held');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000013') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000013') = 'copy_of_private',
  'post: immediate copy of private stays duplicate / copy_of_private');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000014') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000014') = 'copy_of_pulled',
  'post: immediate copy of pulled stays duplicate / copy_of_pulled');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000017') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000017') = 'copy_of_non_vehicle',
  'post: immediate copy of non_vehicle becomes duplicate / copy_of_non_vehicle');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000015') = 'unsorted',
  'post: copy of an unsorted original still does not count');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000016') = 'unsorted',
  'post: copy of a missing original still does not count');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000031') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000031') = 'copy_of_filed',
  'post: second-hop copy of filed becomes duplicate / copy_of_filed');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000032') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000032') = 'copy_of_held',
  'post: second-hop copy of held becomes duplicate / copy_of_held');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000036') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000036') = 'copy_of_non_vehicle',
  'post: second-hop copy of non_vehicle becomes duplicate / copy_of_non_vehicle');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000041') = 'unsorted'
  AND (SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000042') = 'unsorted',
  'post: cycle still does not count');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000001') = 'on_vehicle',
  'post: filed original unchanged');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000002') = 'held',
  'post: held original unchanged');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000006') = 'non_vehicle',
  'post: non_vehicle original unchanged');
SELECT pg_temp.assert_true((SELECT state FROM post_frames WHERE image_id='00000000-0000-4000-8000-000000000031') = 'duplicate'
  AND (SELECT reason FROM post_frames WHERE image_id='00000000-0000-4000-8000-000000000031') = 'copy_of_filed',
  'post frames: second-hop copy of filed is duplicate');
SELECT pg_temp.assert_true((SELECT state FROM post_frames WHERE image_id='00000000-0000-4000-8000-000000000017') = 'duplicate'
  AND (SELECT reason FROM post_frames WHERE image_id='00000000-0000-4000-8000-000000000017') = 'copy_of_non_vehicle',
  'post frames: immediate copy of non_vehicle is duplicate');
SELECT pg_temp.assert_true((SELECT count(*) FROM post_states) = (SELECT count(*) FROM pre_states)
  AND (SELECT count(*) FROM post_frames) = (SELECT count(*) FROM post_states),
  'post: states and frames still cover the same rows');
SELECT pg_temp.assert_true(
  (SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='capture_ledger_states')::text
   LIKE '%force_custom_plan%',
  'timeout fix plan_cache_mode is intact on states');
SELECT pg_temp.assert_true(
  (SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='capture_ledger_frames')::text
   LIKE '%force_custom_plan%',
  'timeout fix plan_cache_mode is intact on frames');
