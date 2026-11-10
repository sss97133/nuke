-- Capture ledger copy-of-held (20261115180000): an unfiled byte-identical copy of a
-- held, private, or pulled original counts as duplicate; a missing original does not.
-- The pre-patch parent only counted a filed original. No row writes. PR title is conventional and at most 72 characters.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_ledger_copy_of_held%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_ledger_copy_of_held* database';
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

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/sql/helpers/capture_ledger_live_parent_20261115180000.sql

-- Parent md5s must match the live bodies this migration is written against.
SELECT pg_temp.assert_true(md5(p.prosrc) = '1424c98e6bda7bec9c4d9a51118052b7', 'parent states md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) = '374ba13933f1b2b4dce2614ea78a2fb5', 'parent frames md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';

-- Synthetic owner: originals in each terminal class, plus copies, plus a missing original and an unsorted original.
INSERT INTO vehicles VALUES
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', 1973, 'Pontiac', 'Firebird');
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, source, vision_gate_status, image_url, file_name, is_duplicate, duplicate_of) VALUES
 -- originals
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-01 18:00+00', 'iphoto', 'approved', 'i1', 'orig_filed.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:01+00', 'iphoto', 'pending', 'i2', 'orig_held.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:02+00', 'iphoto', 'rejected_personal', 'i3', 'orig_private.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:03+00', 'iphoto', 'rejected_misattributed', 'i4', 'orig_pulled.jpg', false, NULL),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:04+00', 'iphoto', 'pending', 'i5', 'orig_unsorted.jpg', false, NULL),
 -- copies (unfiled)
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

SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'duplicate'
  AND (SELECT reason FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'copy_of_filed',
  'pre: copy of filed is already duplicate');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'unsorted',
  'pre: copy of held is still unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000013') = 'unsorted',
  'pre: copy of private is still unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000014') = 'unsorted',
  'pre: copy of pulled is still unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000015') = 'unsorted',
  'pre: copy of unsorted stays unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000016') = 'unsorted',
  'pre: copy of a missing original stays unsorted');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000002') = 'held',
  'pre: the held original is held');
SELECT pg_temp.assert_true((SELECT state FROM pre_states WHERE image_id='00000000-0000-4000-8000-000000000003') = 'private',
  'pre: the private original is private');

\i supabase/migrations/20261115180000_capture_ledger_copy_of_held.sql

CREATE TEMP TABLE post_states AS
SELECT image_id, state, reason FROM public.capture_ledger_states(
  '00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01');
CREATE TEMP TABLE post_frames AS
SELECT image_id, state, reason FROM public.capture_ledger_frames(
  '00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01');

SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000011') = 'copy_of_filed',
  'post: copy of filed stays duplicate / copy_of_filed');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000012') = 'copy_of_held',
  'post: copy of held becomes duplicate / copy_of_held');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000013') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000013') = 'copy_of_private',
  'post: copy of private becomes duplicate / copy_of_private');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000014') = 'duplicate'
  AND (SELECT reason FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000014') = 'copy_of_pulled',
  'post: copy of pulled becomes duplicate / copy_of_pulled');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000015') = 'unsorted',
  'post: copy of an unsorted original still does not count');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000016') = 'unsorted',
  'post: copy of a missing original still does not count');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000001') = 'on_vehicle',
  'post: filed original unchanged');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000002') = 'held',
  'post: held original unchanged');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000003') = 'private',
  'post: private original unchanged');
SELECT pg_temp.assert_true((SELECT state FROM post_states WHERE image_id='00000000-0000-4000-8000-000000000004') = 'pulled',
  'post: pulled original unchanged');
SELECT pg_temp.assert_true((SELECT count(*) FROM post_states s JOIN post_frames f USING (image_id) WHERE s.state IS DISTINCT FROM f.state OR s.reason IS DISTINCT FROM f.reason) = 0,
  'post: frames agrees with states on state and reason');

-- revert restores the parent bodies; no row contents to restore
\i supabase/sql/revert_20261115180000_capture_ledger_copy_of_held.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = '1424c98e6bda7bec9c4d9a51118052b7', 'revert states md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) = '374ba13933f1b2b4dce2614ea78a2fb5', 'revert frames md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';
SELECT pg_temp.assert_true(
  (SELECT state FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01')
    WHERE image_id='00000000-0000-4000-8000-000000000012') = 'unsorted',
  'after revert, copy of held is unsorted again');

-- re-apply so a second pass still works
\i supabase/migrations/20261115180000_capture_ledger_copy_of_held.sql
SELECT pg_temp.assert_true(
  (SELECT state||':'||reason FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'UTC', '2026-03-01', '2026-03-01')
    WHERE image_id='00000000-0000-4000-8000-000000000012') = 'duplicate:copy_of_held',
  're-apply: copy of held is duplicate again');

\echo 'capture_ledger_copy_of_held contract: ok'
