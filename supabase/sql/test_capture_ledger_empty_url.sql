-- 20261116246000: empty-url capture_relay_ios rows that are not already in
-- an earlier official CASE arm get terminal state no_file (reason
-- empty_url_relay). Definition only; no row writes. A later image_url
-- automatically returns the row to normal flow. Activity blocks stay
-- clock_only while the URL is empty.
-- Disposable DB only (dm_refinement_capture_ledger_empty_url%).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_ledger_empty_url%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_ledger_empty_url* database';
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
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid,
  taken_at timestamptz, created_at timestamptz DEFAULT now(),
  source text, vision_gate_status public.vision_gate_status DEFAULT 'pending',
  is_sensitive boolean DEFAULT false, image_url text, thumbnail_url text,
  file_name text, exif_data jsonb, ai_scan_metadata jsonb,
  is_duplicate boolean DEFAULT false, duplicate_of uuid);
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

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

-- Parent is the live #3439 body (installed by 20261116242000).
\i supabase/migrations/20261116242000_capture_junk_and_activity.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = 'c0c9ce009df4ba6eb6b991306008186b', 'parent states md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) = '1726cacaced4e3209b692b402178dd3d', 'parent frames md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';
SELECT pg_temp.assert_true(md5(p.prosrc) = 'a79add36d9d24ef96c6ccfcccfc88137', 'activity md5 unchanged at parent')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_activity_blocks_v1';

\i supabase/migrations/20261116246000_capture_ledger_empty_url_no_file.sql

SELECT pg_temp.assert_true(md5(p.prosrc) <> 'c0c9ce009df4ba6eb6b991306008186b', 'states md5 changed')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) <> '1726cacaced4e3209b692b402178dd3d', 'frames md5 changed')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';
SELECT pg_temp.assert_true(md5(p.prosrc) = 'a79add36d9d24ef96c6ccfcccfc88137', 'activity md5 not changed')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_activity_blocks_v1';

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, source, image_url, vision_gate_status, is_sensitive, is_duplicate, ai_scan_metadata) VALUES
 -- empty-url relay, unfiled: should become no_file
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-03-01 17:00+00', 'capture_relay_ios', NULL, 'pending', false, false, '{}'),
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-03-02 17:10+00', 'capture_relay_ios', '', 'pending', false, false, '{}'),
 -- empty-url relay already filed: stays on_vehicle
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000ff',
  '2026-03-01 17:20+00', 'capture_relay_ios', NULL, 'approved', false, false, '{}'),
 -- empty-url relay already private: stays private
 ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-03-01 17:30+00', 'capture_relay_ios', NULL, 'rejected_personal', false, false, '{}'),
 -- empty-url but not the relay class: stays unsorted
 ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-03-01 17:40+00', 'user_upload', NULL, 'pending', false, false, '{}'),
 -- empty-url relay in an open review: stays held (held precedes no_file)
 ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-03-01 17:50+00', 'capture_relay_ios', NULL, 'pending', false, false, '{}'),
 -- real URL relay: stays unsorted
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-03-01 18:00+00', 'capture_relay_ios',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/r1.jpg',
  'pending', false, false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 -- empty-url relay already non_vehicle
 ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-03-01 18:10+00', 'capture_relay_ios', NULL, 'pending', false, false, '{}');

INSERT INTO capture_set_review(user_id, set_key, image_ids, reason, status)
VALUES ('00000000-0000-4000-8000-0000000000aa', 'held-e6',
        ARRAY['00000000-0000-4000-8000-0000000000e6'::uuid], 'test_held', 'open');

INSERT INTO capture_non_vehicle_log(run_id, image_id, user_id, granted_by, typ, verdict, reason, day, signature)
VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e7',
        '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000aa',
        'other', 'non_vehicle', 'prior', '2026-03-01', 'prior');

-- Snapshot row counts: this migration must not write or delete rows.
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images) = 8, 'fixture row count');

SELECT pg_temp.assert_true((
  SELECT state = 'no_file' AND reason = 'empty_url_relay'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e1'
), 'null image_url relay is no_file');
SELECT pg_temp.assert_true((
  SELECT state = 'no_file' AND reason = 'empty_url_relay'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e2'
), 'blank image_url relay is no_file');
SELECT pg_temp.assert_true((
  SELECT state = 'on_vehicle'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e3'
), 'filed empty-url relay stays on_vehicle');
SELECT pg_temp.assert_true((
  SELECT state = 'private'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e4'
), 'private empty-url relay stays private');
SELECT pg_temp.assert_true((
  SELECT state = 'unsorted'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e5'
), 'empty-url non-relay stays unsorted');
SELECT pg_temp.assert_true((
  SELECT state = 'held'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e6'
), 'held empty-url relay stays held');
SELECT pg_temp.assert_true((
  SELECT state = 'unsorted'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000a1'
), 'real-url relay stays unsorted');
SELECT pg_temp.assert_true((
  SELECT state = 'non_vehicle'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e7'
), 'non_vehicle empty-url relay stays non_vehicle');
SELECT pg_temp.assert_true((
  SELECT state = 'no_file' AND reason = 'empty_url_relay'
  FROM capture_ledger_frames('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e1'
), 'frames agrees with states for no_file');

-- Activity: clocked empty URL is clock_only, including after the ledger change.
SELECT pg_temp.assert_true((
  SELECT category = 'clock_only' AND n_photos >= 1
  FROM capture_activity_blocks_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2026-03-01', '2026-03-01', 60)
  WHERE block_start = '2026-03-01 17:00+00'
), 'empty-url relay stays clock_only');

-- A later URL automatically leaves no_file and clock_only (normal flow).
-- This UPDATE is a fixture, not a live write.
UPDATE vehicle_images
   SET image_url = 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e1-arrived.jpg'
 WHERE id = '00000000-0000-4000-8000-0000000000e1';

SELECT pg_temp.assert_true((
  SELECT state = 'unsorted'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e1'
), 'row leaves no_file when a URL appears');
SELECT pg_temp.assert_true((
  SELECT category = 'unknown'
  FROM capture_activity_blocks_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2026-03-01', '2026-03-01', 60)
  WHERE block_start = '2026-03-01 17:00+00'
), 'row leaves clock_only when a URL appears');

-- Restore the fixture URL and confirm no_file returns; still 9 rows.
UPDATE vehicle_images SET image_url = NULL WHERE id = '00000000-0000-4000-8000-0000000000e1';
SELECT pg_temp.assert_true((
  SELECT state = 'no_file'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e1'
), 'no_file returns if the URL is empty again');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images) = 8, 'definition changed no row count');

\i supabase/sql/revert_20261116246000_capture_ledger_empty_url_no_file.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = 'c0c9ce009df4ba6eb6b991306008186b', 'states restored to #3439')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_states';
SELECT pg_temp.assert_true(md5(p.prosrc) = '1726cacaced4e3209b692b402178dd3d', 'frames restored to #3439')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_ledger_frames';
SELECT pg_temp.assert_true((
  SELECT state = 'unsorted'
  FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '1900-01-01', '2100-01-01')
  WHERE image_id = '00000000-0000-4000-8000-0000000000e1'
), 'after revert, empty-url relay is unsorted again');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images) = 8, 'revert deleted no rows');
