-- vision pool library sources: the carrier backfill writes one carrier per admitted-source frame with no observation
-- row, through ingest_image_observation only; the text-read batch lists one user's unread frames; both are service-role
-- only; the revert unschedules and drops them.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_vision_pool_library_sources%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_vision_pool_library_sources* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- Stand-ins for the live shapes the migration reads and the writers it calls.
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, source text, image_url text,
  file_hash text, taken_at timestamptz, is_duplicate boolean, is_superseded boolean);
CREATE TABLE public.image_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL, vehicle_id uuid,
  role text, confidence numeric, observed_by text, agent_version text, confidence_basis jsonb, is_active boolean DEFAULT true);
CREATE TABLE public.image_text_reads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL, revoked_at timestamptz);
CREATE TABLE public.capture_upload_status(user_id uuid);
CREATE TABLE public.contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contributor_type text, agent_key text UNIQUE,
  agent_version text, status text);
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['capture_relay_ios', 'iphoto', 'iphoto_60d', 'photo_auto_sync', 'library_recovery'] $$;
-- The sanctioned observation writer, reduced to what the carrier needs; counts its calls.
CREATE TABLE public.writer_calls(image_id uuid, vehicle_id uuid, role text, observed_by text, basis jsonb);
CREATE FUNCTION public.ingest_image_observation(p_image_id uuid, p_vehicle_id uuid, p_role text, p_confidence numeric,
  p_observed_by text, p_agent_version text, p_confidence_basis jsonb DEFAULT '{}', p_is_high_confidence_subject boolean DEFAULT NULL,
  p_layer_version jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  IF p_image_id = '00000000-0000-4000-8000-000000000009' THEN RAISE EXCEPTION 'synthetic writer refusal'; END IF;
  INSERT INTO writer_calls VALUES (p_image_id, p_vehicle_id, p_role, p_observed_by, p_confidence_basis);
  INSERT INTO image_observations(image_id, vehicle_id, role, confidence, observed_by, agent_version, confidence_basis)
  VALUES (p_image_id, p_vehicle_id, p_role, p_confidence, p_observed_by, p_agent_version, p_confidence_basis) RETURNING id INTO v;
  RETURN v;
END $$;
-- pg_cron stand-in.
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_id RETURNING true $$;

-- Fixture: one relay user with library frames in every state; another user's frame; a frame the writer refuses.
-- Fixture rows on stand-in tables in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO capture_upload_status VALUES ('00000000-0000-4000-8000-0000000000f0');
INSERT INTO vehicle_images(id, user_id, vehicle_id, source, image_url, file_hash, taken_at, is_duplicate, is_superseded) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f0', NULL, 'iphoto', 'https://x/1.heic', 'h1', now() - interval '10 days', false, false),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000f0', NULL, 'photo_auto_sync', 'https://x/2.heic', 'h2', now() - interval '20 days', false, false),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000f0', NULL, 'library_recovery', 'https://x/3.jpg', NULL, now() - interval '30 days', false, false),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000f0', NULL, 'iphoto', 'https://x/4.heic', 'h4', now() - interval '40 days', true, false),   -- duplicate
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000f0', NULL, 'iphoto', '', 'h5', now() - interval '50 days', false, false),                  -- no bytes
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000f0', NULL, 'user_upload', 'https://x/6.jpg', 'h6', now() - interval '60 days', false, false), -- not an admitted source
  ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000f0', NULL, 'iphoto', 'https://x/7.heic', 'h7', now() - interval '3 years', false, false),  -- too old
  ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000f1', NULL, 'iphoto', 'https://x/8.heic', 'h8', now() - interval '5 days', false, false),   -- not a relay user
  ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000f0', NULL, 'iphoto', 'https://x/9.heic', 'h9', now() - interval '70 days', false, false),  -- writer refuses
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000f0', NULL, 'iphoto', 'https://x/a.heic', 'ha', now() - interval '80 days', false, false);  -- already has a row
INSERT INTO image_observations(image_id, role, observed_by) VALUES ('00000000-0000-4000-8000-00000000000a', 'subject', 'human:owner');
INSERT INTO image_text_reads(image_id, revoked_at) VALUES
  ('00000000-0000-4000-8000-000000000001', NULL),                 -- read
  ('00000000-0000-4000-8000-000000000002', now());                -- read revoked: needs a new one

\ir ../migrations/20261111110000_vision_pool_library_sources.sql

CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

-- 1. The backfill: carriers for 1, 2, 3 only (newest first), through the writer, no vehicle claim; 9 is skipped and reported.
CREATE TEMP TABLE before_images AS SELECT * FROM vehicle_images;
CREATE TEMP TABLE res AS SELECT public.clip_carrier_backfill(300) r;
SELECT pg_temp.assert_true((SELECT (r->>'carriers')::int = 3 AND (r->>'skipped')::int = 1 AND (r->>'users')::int = 1 FROM res),
  'three carriers written, the refused frame reported as skipped, one relay user');
SELECT pg_temp.assert_true((SELECT array_agg(image_id::text ORDER BY image_id) FROM writer_calls WHERE observed_by = 'clip_embed_carrier_v1')
  = ARRAY['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'],
  'carriers go to the admitted-source frames with bytes and no observation row; duplicate, empty url, other source, too old, other user and already-observed frames are left alone');
SELECT pg_temp.assert_true((SELECT bool_and(vehicle_id IS NULL AND role = 'incidental' AND basis #>> '{clip_embed_carrier_v1,origin}' = 'library_backfill') FROM writer_calls),
  'a carrier claims no vehicle');
SELECT pg_temp.assert_true((SELECT count(*) FROM image_observations WHERE observed_by = 'clip_embed_carrier_v1') = 3, 'carrier rows exist');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT * FROM vehicle_images EXCEPT SELECT * FROM before_images)
  AND NOT EXISTS (SELECT * FROM before_images EXCEPT SELECT * FROM vehicle_images), 'vehicle_images is never written');
-- 1b. Idempotent: a second pass finds nothing new (the refused frame is retried and refused again).
SELECT pg_temp.assert_true((SELECT (r->>'carriers')::int = 0 AND (r->>'skipped')::int = 1 FROM (SELECT public.clip_carrier_backfill(300) r) x),
  'second pass writes nothing');
-- 1c. The cap holds: a one-carrier run on a fresh frame.
DELETE FROM image_observations WHERE observed_by = 'clip_embed_carrier_v1';
CREATE TEMP TABLE res_one AS SELECT public.clip_carrier_backfill(1) r;
SELECT pg_temp.assert_true((SELECT (r->>'carriers')::int = 1 FROM res_one)
  AND (SELECT image_id FROM image_observations WHERE observed_by = 'clip_embed_carrier_v1') = '00000000-0000-4000-8000-000000000001',
  'the cap holds and the newest frame goes first');

-- 2. The text-read batch: the user's admitted-source frames without an unrevoked read, newest first.
SELECT pg_temp.assert_true((SELECT array_agg(image_id::text ORDER BY taken_at DESC) FROM public.image_text_read_batch('00000000-0000-4000-8000-0000000000f0', 200))
  = ARRAY['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-00000000000a'],
  'unread frames listed: a revoked read counts as unread, a live read does not; duplicate, empty url, other source, too old and other user excluded');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.image_text_read_batch('00000000-0000-4000-8000-0000000000f0', 1)) = 1, 'batch cap holds');
SELECT pg_temp.assert_true((SELECT source = 'photo_auto_sync' AND file_hash = 'h2' FROM public.image_text_read_batch('00000000-0000-4000-8000-0000000000f0', 1)),
  'the batch carries the bytes hash the read cites');

-- 3. Access and registration.
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.clip_carrier_backfill(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.clip_carrier_backfill(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.image_text_read_batch(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.image_text_read_batch(uuid,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.clip_carrier_backfill(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.image_text_read_batch(uuid,integer)', 'EXECUTE'), 'writers are service-role only');
SELECT pg_temp.assert_true((SELECT count(*) FROM contributors WHERE agent_key = 'agent:claude-box' AND status = 'probation' AND contributor_type = 'agent') = 1,
  'the box-side pass is registered on probation');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job WHERE jobname = 'clip-carrier-backfill' AND schedule = '*/10 * * * *') = 1, 'carrier backfill scheduled');
-- 3b. Re-running the migration keeps one contributor and one job.
\ir ../migrations/20261111110000_vision_pool_library_sources.sql
SELECT pg_temp.assert_true((SELECT count(*) FROM contributors WHERE agent_key = 'agent:claude-box') = 1
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'clip-carrier-backfill') = 1, 'migration is idempotent');

-- 4. Revert.
\ir revert_20261111110000_vision_pool_library_sources.sql
SELECT pg_temp.assert_true(to_regprocedure('public.clip_carrier_backfill(integer)') IS NULL
  AND to_regprocedure('public.image_text_read_batch(uuid,integer)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clip-carrier-backfill')
  AND to_regprocedure('public.trg_vehicle_images_clip_carrier()') IS NOT NULL
  AND (SELECT count(*) FROM image_observations WHERE observed_by = 'clip_embed_carrier_v1') = 1, 'revert drops the writers and the job, keeps the trigger function and the evidence');
\echo 'PASS test_vision_pool_library_sources'
