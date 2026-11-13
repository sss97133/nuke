-- capture_junk_placeholder_v1 + junk ledger state + capture_activity_blocks_v1.
-- Placeholder / test URLs become terminal junk (kept, not deleted). empty_url
-- is never touched. Activity blocks expose only time, category and count.
-- Dry-default, cap 50, granted_by, revert-by-run. Ledger parent is #3316.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_junk_and_activity%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_junk_and_activity* database';
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
  is_sensitive boolean DEFAULT false, image_url text, thumbnail_url text, file_name text, exif_data jsonb,
  ai_scan_metadata jsonb, is_duplicate boolean DEFAULT false, duplicate_of uuid);
CREATE TABLE public.capture_set_review(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], reason text, evidence jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, stage text, error_class text);
CREATE TABLE public.capture_non_vehicle_log(
  run_id uuid NOT NULL, image_id uuid NOT NULL, user_id uuid, granted_by uuid,
  typ text, verdict text NOT NULL, reason text, day date, signature text,
  applied_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz,
  UNIQUE (run_id, image_id));
CREATE TABLE public.capture_privacy_promote_exclude(image_id uuid PRIMARY KEY, reason text, granted_by uuid);
CREATE TABLE public.capture_set_links(image_id uuid, reverted_at timestamptz);
CREATE TABLE public.capture_document_pages(image_id uuid, revoked_at timestamptz);

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

-- Parent md5s must match the live #3316 bodies this migration is written against.
\i supabase/sql/helpers/capture_ledger_live_parent_20261116242000.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = 'ba4646aeeab075f0d54f7f9f30db4d55', 'parent states md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) = '52d8f857b78e2f811c7671f9c1c621b6', 'parent frames md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';

\i supabase/migrations/20261116242000_capture_junk_and_activity.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_junk_placeholder_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'anon cannot mark junk');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_junk_placeholder_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'service_role can mark junk');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_activity_blocks_v1(uuid,text,date,date,integer)', 'EXECUTE'), 'anon cannot read activity');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_activity_blocks_v1(uuid,text,date,date,integer)', 'EXECUTE'), 'service_role can read activity');
SELECT pg_temp.assert_true(md5(p.prosrc) <> 'ba4646aeeab075f0d54f7f9f30db4d55', 'states md5 changed')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, image_url, is_sensitive, is_duplicate, duplicate_of, vision_gate_status, ai_scan_metadata) VALUES
 -- placeholder / test URLs (junk-eligible)
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-06-18 18:00+00', 'https://example.com/final_test.jpg', false, false, NULL, 'pending', '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-06-18 18:10+00', 'https://test.example.com/test.jpg', false, false, NULL, 'pending', '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, 'https://test-trigger-check.jpg', false, false, NULL, 'pending', '{"classification":{"image_type":"other"}}'),
 -- empty_url must not be marked junk (the 276 class)
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 17:00+00', NULL, false, false, NULL, 'pending', '{}'),
 -- real storage URL, typ other (non_work), typ exterior (work), typ empty (unknown)
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 16:00+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/w1.jpg', false, false, NULL, 'pending', '{"classification":{"image_type":"engine_bay"}}'),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 16:20+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/w2.jpg', false, false, NULL, 'pending', '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:00+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/n1.jpg', false, false, NULL, 'rejected_personal', '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:15+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/n2.jpg', false, false, NULL, 'pending', '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 19:30+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/u1.jpg', false, false, NULL, 'pending', '{}'),
 -- no-clock real file: never appears in activity blocks
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/z1.jpg', false, false, NULL, 'pending', '{"classification":{"image_type":"vehicle_exterior"}}'),
 -- filed work typ, and a copy of a junk original
 ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ff', '2026-03-02 16:00+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/f1.jpg', false, false, NULL, 'approved', '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', NULL, '2024-06-18 18:20+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/c1.jpg', false, true, '00000000-0000-4000-8000-0000000000a1', 'pending', '{}'),
 -- skips
 ('00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000aa', NULL, '2025-01-01 18:30+00', 'https://example.com/secret.jpg', true, false, NULL, 'pending', '{}'),
 ('00000000-0000-4000-8000-0000000000eb', '00000000-0000-4000-8000-0000000000aa', NULL, '2025-01-01 18:31+00', 'https://example.com/excluded.jpg', false, false, NULL, 'pending', '{}');

INSERT INTO capture_privacy_promote_exclude(image_id, reason, granted_by)
VALUES ('00000000-0000-4000-8000-0000000000eb', 'privacy_backup_union', '00000000-0000-4000-8000-0000000000cc');

-- granted_by required
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_junk_placeholder_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', NULL, true, 50);
    RAISE EXCEPTION 'expected granted_by required';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF;
  END;
END $$;

-- dry: 3 placeholders (a1,a2,a3); empty_url, real URLs, sensitive, exclude skipped; copy c1 is a real URL so not junk-eligible
SELECT public.capture_junk_placeholder_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS dry_all \gset
SELECT pg_temp.assert_true((:'dry_all'::jsonb->>'dry_run')::boolean, 'dry flag');
SELECT pg_temp.assert_true((:'dry_all'::jsonb->>'eligible')::int = 3, '3 placeholder URLs eligible');
SELECT pg_temp.assert_true((:'dry_all'::jsonb->>'would_mark')::int = 3, 'would mark 3');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_junk_placeholder_log) = 0, 'dry wrote no log');

-- cap 2 marks only 2
SELECT public.capture_junk_placeholder_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000cc', false, 2) AS apply1 \gset
SELECT pg_temp.assert_true((:'apply1'::jsonb->>'marked')::int = 2, 'cap 2 marked 2');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_junk_placeholder_log WHERE reverted_at IS NULL) = 1, 'one log row');

-- ledger: those 2 are junk; their copy follows once the original is junk; empty_url stays unsorted
SELECT pg_temp.assert_true((
  SELECT count(*) FILTER (WHERE state = 'junk') = 2
     AND count(*) FILTER (WHERE state = 'duplicate' AND reason = 'copy_of_junk') = 1
     AND bool_and(CASE WHEN image_id = '00000000-0000-4000-8000-0000000000e1' THEN state = 'unsorted' ELSE true END)
  FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
), 'junk state, copy_of_junk, empty_url untouched');

-- second apply takes the remaining placeholder
SELECT public.capture_junk_placeholder_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS apply2 \gset
SELECT pg_temp.assert_true((:'apply2'::jsonb->>'marked')::int = 1, 'remaining placeholder marked');
SELECT pg_temp.assert_true((
  SELECT count(*) FILTER (WHERE state = 'junk') = 3
  FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
), 'all 3 placeholders are junk');

-- idempotent
SELECT public.capture_junk_placeholder_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS again \gset
SELECT pg_temp.assert_true((:'again'::jsonb->>'marked')::int = 0, 'third apply marks 0');

-- activity blocks on 2026-03-01 (LA):
-- 16:00 and 16:20 work typ (same block, 20 min gap)
-- 18:00 private + 18:15 typ other = non_work block
-- 17:00 empty_url is clock_only (its own block; content-free)
-- 19:30 typ-empty real file = unknown
-- no-clock z1 and junk placeholders on other days / no clock excluded from this day
-- clocked junk a1/a2 are 2024-06-18
SELECT jsonb_agg(jsonb_build_object(
         'day', day, 'category', category, 'n', n_photos,
         'start', block_start, 'end', block_end)
       ORDER BY day, block_start) AS blocks
FROM public.capture_activity_blocks_v1(
  '00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles',
  '2026-03-01', '2026-03-01', 60) \gset
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.capture_activity_blocks_v1(
     '00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2026-03-01', '2026-03-01', 60)) = 4,
  'four blocks on 2026-03-01');
SELECT pg_temp.assert_true((
  SELECT bool_and(category IN ('work','non_work','clock_only','unknown'))
     AND sum(n_photos) FILTER (WHERE category = 'work') = 2
     AND sum(n_photos) FILTER (WHERE category = 'non_work') = 2
     AND sum(n_photos) FILTER (WHERE category = 'clock_only') = 1
     AND sum(n_photos) FILTER (WHERE category = 'unknown') = 1
  FROM public.capture_activity_blocks_v1(
    '00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2026-03-01', '2026-03-01', 60)
), 'work 2, non_work 2, clock_only 1, unknown 1');

-- a 10-minute gap still one work block; a 5-minute cap would split 16:00 / 16:20
SELECT pg_temp.assert_true((
  SELECT count(*) FILTER (WHERE category = 'work') = 2
  FROM public.capture_activity_blocks_v1(
    '00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2026-03-01', '2026-03-01', 5)
), 'gap of 5 minutes splits the two work photos');

-- no-clock rows never appear; function result has no image id or url
SELECT pg_temp.assert_true((
  SELECT NOT (to_jsonb(b) ? 'image_id') AND NOT (to_jsonb(b) ? 'image_url') AND NOT (to_jsonb(b) ? 'image_ids')
  FROM public.capture_activity_blocks_v1(
    '00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01', 60) b
  LIMIT 1
), 'activity projection has no image content');
SELECT pg_temp.assert_true((
  SELECT count(*) FILTER (WHERE day IS NULL) = 0
  FROM public.capture_activity_blocks_v1(
    '00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01', 60)
), 'every block has a clocked day');

-- clocked junk placeholders on 2024-06-18 form a non_work block (2 photos; a3 has no clock)
SELECT pg_temp.assert_true((
  SELECT count(*) = 1 AND bool_and(category = 'non_work' AND n_photos = 2)
  FROM public.capture_activity_blocks_v1(
    '00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2024-06-18', '2024-06-18', 60)
  WHERE category = 'non_work'
), 'clocked junk is non_work time evidence, not deleted');

-- revert f2 then f1; junk leaves the ledger; copy_of_junk disappears
SELECT public.capture_junk_placeholder_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2') AS rev2 \gset
SELECT public.capture_junk_placeholder_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1') AS rev1 \gset
SELECT pg_temp.assert_true((:'rev1'::jsonb->>'reverted_log')::int = 1, 'reverted f1 log');
SELECT pg_temp.assert_true((
  SELECT count(*) FILTER (WHERE state = 'junk') = 0
     AND count(*) FILTER (WHERE reason = 'copy_of_junk') = 0
  FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
), 'revert removes junk from the ledger; rows still exist');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images) = 14, 'no image row was deleted');

-- remake one junk row so the refuse-unreverted check can fire, then revert and drop
SELECT public.capture_junk_placeholder_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4',
  '00000000-0000-4000-8000-0000000000cc', false, 50);
DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.capture_junk_placeholder_log WHERE reverted_at IS NULL) THEN
      RAISE EXCEPTION 'capture_junk_placeholder: unreverted log rows; revert those runs first';
    END IF;
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%unreverted log rows%' THEN RAISE; END IF;
  END;
END $$;
SELECT public.capture_junk_placeholder_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4');
\i supabase/sql/revert_20261116242000_capture_junk_and_activity.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_junk_placeholder_v1(uuid,uuid,uuid,boolean,integer)') IS NULL, 'junk function dropped');
SELECT pg_temp.assert_true(to_regprocedure('public.capture_activity_blocks_v1(uuid,text,date,date,integer)') IS NULL, 'activity function dropped');
SELECT pg_temp.assert_true(to_regclass('public.capture_junk_placeholder_log') IS NULL, 'junk log dropped');
SELECT pg_temp.assert_true(md5(p.prosrc) = 'ba4646aeeab075f0d54f7f9f30db4d55', 'states restored to #3316')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) = '52d8f857b78e2f811c7671f9c1c621b6', 'frames restored to #3316')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';
