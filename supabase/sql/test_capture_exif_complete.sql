-- Contract: 20261122210000_capture_exif_complete. capture_exif_complete_v1 adds the camera fields and the handset session
-- read from a photo's own file to its existing exif_data, never overwrites a key, never writes a clock or GPS, skips
-- other owners' rows, rows without a stored picture, privacy-excluded, sensitive and personal rows, marks every row it
-- examines once, and capture_exif_complete_revert_v1 removes exactly what a run added.
-- Disposable PG17 only, synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, image_url text, taken_at timestamptz,
  exif_data jsonb, is_sensitive boolean DEFAULT false, vision_gate_status public.vision_gate_status DEFAULT 'pending');
CREATE TABLE public.capture_privacy_promote_exclude(image_id uuid PRIMARY KEY, reason text);

\set u '''00000000-0000-4000-8000-000000000001'''
\set g '''00000000-0000-4000-8000-000000000002'''
INSERT INTO vehicle_images (id, user_id, image_url, taken_at, exif_data, is_sensitive, vision_gate_status) VALUES
  ('a0000000-0000-4000-8000-000000000001', :u, 'https://x/1.heic', '2019-04-28 00:01:00Z', '{"uuid": "A1", "camera_make": "Apple"}', false, 'pending'),
  ('a0000000-0000-4000-8000-000000000002', :u, 'https://x/2.jpg', '2019-04-28 00:02:00Z', '{"Make": "Apple", "Model": "iPhone X"}', false, 'approved'),
  ('a0000000-0000-4000-8000-000000000003', :u, '', NULL, '{"uuid": "A3"}', false, 'pending'),
  ('a0000000-0000-4000-8000-000000000004', :u, 'https://x/4.jpg', NULL, NULL, true, 'pending'),
  ('a0000000-0000-4000-8000-000000000005', :u, 'https://x/5.jpg', NULL, NULL, false, 'rejected_personal'),
  ('a0000000-0000-4000-8000-000000000006', :u, 'https://x/6.jpg', NULL, NULL, false, 'pending'),
  ('a0000000-0000-4000-8000-000000000007', :g, 'https://x/7.jpg', NULL, NULL, false, 'pending'),
  ('a0000000-0000-4000-8000-000000000008', :u, 'https://x/8.png', NULL, NULL, false, 'pending');
INSERT INTO capture_privacy_promote_exclude VALUES ('a0000000-0000-4000-8000-000000000006', 'fixture');
CREATE TEMP TABLE t_before AS SELECT id, taken_at, exif_data FROM vehicle_images;

\ir ../migrations/20261122210000_capture_exif_complete.sql
SELECT t_assert(NOT has_function_privilege('authenticated', 'public.capture_exif_complete_v1(uuid,uuid,uuid,jsonb,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.capture_exif_complete_revert_v1(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.capture_exif_complete_v1(uuid,uuid,uuid,jsonb,boolean)', 'EXECUTE'),
  'grants: service_role only');

\set fields '{"Make": "Apple", "Model": "iPhone X", "Software": "12.2", "LensModel": "iPhone X back dual camera 4mm f/1.8", "ContentIdentifier": "B779EAE5-3FDE-4B40-8815-886D036B41E9", "RunTimeFlags": 1, "RunTimeValue": 90083159473458, "RunTimeEpoch": 0, "RunTimeScale": 1000000000, "capture_session": {"anchor_at": "2019-04-27T22:57:10.000Z", "uptime_s": 90083, "basis": "DateTimeOriginal - RunTimeValue/RunTimeScale; RunTime pauses in sleep"}, "DateTimeOriginal": "2019:04:28 17:00:00", "GPSLatitude": 1.5, "capture_clock": {"at": "x"}, "taken_at": "2001-01-01"}'
CREATE TEMP TABLE t_items AS SELECT jsonb_agg(jsonb_build_object('image_id', id, 'fields', CASE WHEN id::text LIKE '%8' THEN '{}'::jsonb ELSE :'fields'::jsonb END)) AS j
  FROM vehicle_images;

CREATE TEMP TABLE t_dry AS SELECT capture_exif_complete_v1(:u, 'b0000000-0000-4000-8000-000000000001', NULL, (SELECT j FROM t_items)) AS r;
SELECT t_assert((SELECT (r ->> 'with_new_keys')::int = 2 AND (r ->> 'examined_nothing_new')::int = 1
  AND r -> 'skipped' = '{"private": 2, "other_owner": 1, "privacy_excluded": 1, "no_stored_picture": 1}'::jsonb
  AND (r #>> '{keys_added,Make}')::int = 1 AND (r #>> '{keys_added,capture_session}')::int = 2 FROM t_dry),
  'dry: counts what it would add and why it skips');
SELECT t_assert((SELECT count(*) FROM vehicle_images v JOIN t_before b USING (id) WHERE v.exif_data IS DISTINCT FROM b.exif_data) = 0,
  'dry: writes nothing');
DO $$ BEGIN
  PERFORM capture_exif_complete_v1('00000000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, '[]', false);
  RAISE EXCEPTION 'no refusal';
EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF; END $$;
SELECT t_assert(true, 'live: refused without granted_by');
DO $$ BEGIN
  PERFORM capture_exif_complete_v1('00000000-0000-4000-8000-000000000001', gen_random_uuid(), NULL,
    (SELECT jsonb_agg(jsonb_build_object('image_id', gen_random_uuid())) FROM generate_series(1, 51)));
  RAISE EXCEPTION 'no refusal';
EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%at most 50%' THEN RAISE; END IF; END $$;
SELECT t_assert(true, 'cap: more than 50 items refused');

CREATE TEMP TABLE t_live AS SELECT capture_exif_complete_v1(:u, 'b0000000-0000-4000-8000-000000000001', :g, (SELECT j FROM t_items), false) AS r;
SELECT t_assert((SELECT (r ->> 'with_new_keys')::int = 2 FROM t_live), 'live: two rows gain keys');
SELECT t_assert((SELECT exif_data - 'exif_completeness' = '{"uuid": "A1", "camera_make": "Apple", "Make": "Apple", "Model": "iPhone X", "Software": "12.2", "LensModel": "iPhone X back dual camera 4mm f/1.8", "ContentIdentifier": "B779EAE5-3FDE-4B40-8815-886D036B41E9", "RunTimeFlags": 1, "RunTimeValue": 90083159473458, "RunTimeEpoch": 0, "RunTimeScale": 1000000000, "capture_session": {"anchor_at": "2019-04-27T22:57:10.000Z", "uptime_s": 90083, "basis": "DateTimeOriginal - RunTimeValue/RunTimeScale; RunTime pauses in sleep"}}'::jsonb
  AND exif_data #>> '{exif_completeness,signature}' = 'capture_exif_complete_v1/b0000000-0000-4000-8000-000000000001'
  AND exif_data #>> '{exif_completeness,granted_by}' = '00000000-0000-4000-8000-000000000002'
  FROM vehicle_images WHERE id = 'a0000000-0000-4000-8000-000000000001'), 'live: the camera fields and session are added with a signed marker');
SELECT t_assert((SELECT exif_data ->> 'Model' = 'iPhone X' AND exif_data #> '{exif_completeness,keys}' ? 'Software'
  AND NOT exif_data #> '{exif_completeness,keys}' ? 'Make' FROM vehicle_images WHERE id = 'a0000000-0000-4000-8000-000000000002'),
  'live: an existing key is never overwritten');
SELECT t_assert((SELECT count(*) FROM vehicle_images WHERE exif_data ?| ARRAY['DateTimeOriginal','GPSLatitude','capture_clock','taken_at']) = 0
  AND (SELECT count(*) FROM vehicle_images v JOIN t_before b USING (id) WHERE v.taken_at IS DISTINCT FROM b.taken_at) = 0,
  'live: no clock, no GPS, taken_at untouched');
SELECT t_assert((SELECT exif_data - 'exif_completeness' = '{}'::jsonb AND exif_data #> '{exif_completeness,keys}' = '[]'::jsonb
  FROM vehicle_images WHERE id = 'a0000000-0000-4000-8000-000000000008'), 'live: a file with nothing to add is marked examined');
SELECT t_assert((SELECT count(*) FROM vehicle_images v JOIN t_before b USING (id)
  WHERE v.id::text ~ '-00000000000[34567]$' AND v.exif_data IS DISTINCT FROM b.exif_data) = 0, 'live: skipped rows untouched');
CREATE TEMP TABLE t_again AS SELECT capture_exif_complete_v1(:u, 'b0000000-0000-4000-8000-000000000009', :g, (SELECT j FROM t_items), false) AS r;
SELECT t_assert((SELECT (r ->> 'with_new_keys')::int = 0 AND (r #>> '{skipped,already_examined}')::int = 3 FROM t_again),
  'replay: a second run examines nothing again');

CREATE TEMP TABLE t_rev AS SELECT capture_exif_complete_revert_v1(:u, 'b0000000-0000-4000-8000-000000000001') AS r;
SELECT t_assert((SELECT (r ->> 'reverted')::int = 3 FROM t_rev)
  AND (SELECT count(*) FROM vehicle_images v JOIN t_before b USING (id) WHERE v.exif_data IS DISTINCT FROM b.exif_data) = 0,
  'revert: every row is back to what it held');

\ir ../migrations/20261122210000_capture_exif_complete.sql
SELECT t_assert(to_regprocedure('public.capture_exif_complete_v1(uuid,uuid,uuid,jsonb,boolean)') IS NOT NULL, 'replay: the migration re-applies');
\ir revert_20261122210000_capture_exif_complete.sql
SELECT t_assert(to_regprocedure('public.capture_exif_complete_v1(uuid,uuid,uuid,jsonb,boolean)') IS NULL
  AND to_regprocedure('public.capture_exif_complete_revert_v1(uuid,uuid)') IS NULL, 'revert file: functions dropped');
