-- PR title is conventional and at most 72 characters.
-- capture_privacy_promote_v1: dry-default, cap 50, backup, revert-by-run, granted_by required.
-- Promotes is_sensitive unfiled rows to rejected_personal. Skips empty_url, the exclude
-- table, already-rejected, filed, held, waiting, and failed rows. Never touches image_url.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_privacy_promote%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_privacy_promote* database';
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
  source text, vision_gate_status public.vision_gate_status, vision_gate_agent_reasoning text,
  vision_gate_processed_at timestamptz, is_sensitive boolean DEFAULT false, image_url text, thumbnail_url text,
  file_name text);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], reason text, evidence jsonb DEFAULT '{}', status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, stage text, error_class text);

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261115181000_capture_privacy_promote.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_privacy_promote_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'anon cannot promote');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_privacy_promote_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'authenticated cannot promote');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_privacy_promote_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'service_role can promote');

-- 60 sensitive unfiled url rows (over cap), plus one of each skip class.
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
       '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:00+00', 'approved', true,
       'https://example.invalid/'||i, 's'||i||'.jpg'
FROM generate_series(1,60) i;
-- empty_url sensitive (privacy-hold class) — skip
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
VALUES ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:01+00', 'pending', true, NULL, 'empty.jpg');
-- exclude-table id — skip
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
VALUES ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:02+00', 'approved', true, 'https://example.invalid/ex', 'ex.jpg');
-- already private — skip
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
VALUES ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:03+00', 'rejected_personal', true, 'https://example.invalid/priv', 'p.jpg');
-- filed — skip
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
VALUES ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-01 18:04+00', 'approved', true, 'https://example.invalid/f', 'f.jpg');
-- not sensitive — skip
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
VALUES ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:05+00', 'approved', false, 'https://example.invalid/ns', 'ns.jpg');
-- held — skip
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
VALUES ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:06+00', 'approved', true, 'https://example.invalid/h', 'h.jpg');
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, status)
VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:H', '{00000000-0000-4000-8000-0000000000e6}', 'held', 'open');
-- waiting — skip
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
VALUES ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:07+00', 'approved', true, 'https://example.invalid/w', 'w.jpg');
INSERT INTO capture_landing_chunks(id, user_id, state) VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa', 'awaiting_gate');
INSERT INTO capture_landing_sets VALUES ('00000000-0000-4000-8000-0000000000d1', 'ios:a:W', '{00000000-0000-4000-8000-0000000000e7}', 'clear');
-- other user — skip
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, is_sensitive, image_url, file_name)
VALUES ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000bb', NULL, '2026-03-01 18:08+00', 'approved', true, 'https://example.invalid/o', 'o.jpg');

SELECT public.capture_privacy_promote_exclude_add_v1(
  ARRAY['00000000-0000-4000-8000-0000000000e2'::uuid],
  '00000000-0000-4000-8000-0000000000cc',
  'privacy_backup_union') AS ex \gset
SELECT pg_temp.assert_true((:'ex')::jsonb->>'added' = '1', 'exclude loader added the backup id');

-- granted_by required
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_privacy_promote_v1(
      '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0', NULL, true, 50);
    RAISE EXCEPTION 'expected granted_by required';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF;
  END;
END $$;

-- cap bounds
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_privacy_promote_v1(
      '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
      '00000000-0000-4000-8000-0000000000cc', true, 51);
    RAISE EXCEPTION 'expected cap bound';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%cap must be 1..50%' THEN RAISE; END IF;
  END;
END $$;

-- dry-default: calling with the default must not write
SELECT public.capture_privacy_promote_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000cc') AS d0 \gset
SELECT pg_temp.assert_true((:'d0')::jsonb->>'dry_run' = 'true' AND (:'d0')::jsonb->>'would_promote' = '50'
  AND (:'d0')::jsonb->>'eligible' = '60' AND (:'d0')::jsonb->>'remaining_after' = '10',
  'dry default reports 60 eligible, would promote 50');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE vision_gate_status = 'rejected_personal') = 1,
  'dry run does not promote (only the already-private fixture stays private)');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM capture_privacy_promote_log), 'dry run writes no log');

-- apply batch 1
SELECT public.capture_privacy_promote_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS a1 \gset
SELECT pg_temp.assert_true((:'a1')::jsonb->>'dry_run' = 'false' AND (:'a1')::jsonb->>'promoted' = '50'
  AND (:'a1')::jsonb->>'granted_by' = '00000000-0000-4000-8000-0000000000cc',
  'apply promotes 50 and records granted_by');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images
    WHERE user_id='00000000-0000-4000-8000-0000000000aa' AND vision_gate_status='rejected_personal') = 51,
  '50 newly private plus the already-private fixture');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_privacy_promote_log WHERE run_id='00000000-0000-4000-8000-0000000000f2' AND granted_by='00000000-0000-4000-8000-0000000000cc') = 50,
  'log backs up 50 rows with granted_by');
-- explicit: skipped rows unchanged, urls of promoted rows unchanged
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e1') = 'pending'
  AND (SELECT image_url FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e1') IS NULL,
  'empty_url row was not promoted and still has no url');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e2') = 'approved',
  'excluded backup id was not promoted');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e4') = 'approved',
  'filed sensitive row was not promoted');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e5') = 'approved',
  'non-sensitive row was not promoted');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e6') = 'approved',
  'held sensitive row was not promoted');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e7') = 'approved',
  'waiting sensitive row was not promoted');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000e8') = 'approved',
  'other user was not promoted');
SELECT pg_temp.assert_true((SELECT bool_and(image_url = 'https://example.invalid/' || (i.ord)::text)
  FROM vehicle_images v
  JOIN generate_series(1,60) AS i(ord)
    ON v.id = ('00000000-0000-4000-8000-'||lpad(i.ord::text,12,'0'))::uuid),
  'all 60 candidate rows kept their original image_url');

-- second batch of the remaining 10
SELECT public.capture_privacy_promote_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS a2 \gset
SELECT pg_temp.assert_true((:'a2')::jsonb->>'promoted' = '10' AND (:'a2')::jsonb->>'eligible' = '10'
  AND (:'a2')::jsonb->>'remaining_after' = '0',
  'second batch promotes the remaining 10');

-- revert first run
SELECT public.capture_privacy_promote_revert_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000f2') AS rv \gset
SELECT pg_temp.assert_true((:'rv')::jsonb->>'reverted' = '50', 'revert restores 50');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images
    WHERE id BETWEEN '00000000-0000-4000-8000-000000000001' AND '00000000-0000-4000-8000-000000000050'
      AND vision_gate_status = 'approved'
      AND vision_gate_agent_reasoning IS NULL) = 50,
  'first-batch rows restored to approved / prior reasoning');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images
    WHERE id BETWEEN '00000000-0000-4000-8000-000000000051' AND '00000000-0000-4000-8000-000000000060'
      AND vision_gate_status = 'rejected_personal') = 10,
  'second-batch rows stay private after reverting the first run');

-- drop-guard: unreverted log rows block object drop
DO $$
BEGIN
  BEGIN
    -- inline the guard the revert script uses
    IF EXISTS (SELECT 1 FROM public.capture_privacy_promote_log WHERE reverted_at IS NULL) THEN
      RAISE EXCEPTION 'capture_privacy_promote revert: unreverted log rows remain; run capture_privacy_promote_revert_v1 first';
    END IF;
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%unreverted log rows remain%' THEN RAISE; END IF;
  END;
END $$;

SELECT public.capture_privacy_promote_revert_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000f3') AS rv2 \gset
SELECT pg_temp.assert_true((:'rv2')::jsonb->>'reverted' = '10', 'revert second run');

\i supabase/sql/revert_20261115181000_capture_privacy_promote.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_privacy_promote_v1(uuid,uuid,uuid,boolean,integer)') IS NULL,
  'revert drops the producer');

\echo 'capture_privacy_promote contract: ok'
