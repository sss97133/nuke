-- capture_set_candidates: writer writes proposals only for the user's unfiled photos, never files, and revert revokes.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_set_candidates%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_set_candidates* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid);
\ir ../migrations/20261023220000_capture_set_candidates.sql

CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-0000000000a1', NULL, NULL), ('00000000-0000-4000-8000-0000000000a2', now(), NULL);
INSERT INTO vehicle_images VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f0', NULL),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000f0', NULL),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000f0', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000f9', NULL);
CREATE TEMP TABLE before_images AS SELECT * FROM vehicle_images;
CREATE TEMP TABLE res AS SELECT public.record_capture_set_candidates('00000000-0000-4000-8000-0000000000e1',
  '00000000-0000-4000-8000-0000000000f0', 'test', $j$[
  {"set_key":"s1","image_ids":["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002"],
   "vehicle_id":"00000000-0000-4000-8000-0000000000a1","rank":1,"combined":0.97,"margin":0.95,"band":"clear","signals":{"gps":{"near":3}}},
  {"set_key":"s1","image_ids":["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002"],
   "vehicle_id":"00000000-0000-4000-8000-0000000000a1","rank":1,"combined":0.97,"margin":0.95,"band":"clear","signals":{}},
  {"set_key":"s2","image_ids":["00000000-0000-4000-8000-000000000003"],
   "vehicle_id":"00000000-0000-4000-8000-0000000000a1","rank":1,"combined":0.9,"margin":0.8,"band":"likely","signals":{}},
  {"set_key":"s3","image_ids":["00000000-0000-4000-8000-000000000004"],
   "vehicle_id":"00000000-0000-4000-8000-0000000000a1","rank":1,"combined":0.9,"margin":0.8,"band":"likely","signals":{}},
  {"set_key":"s4","image_ids":["00000000-0000-4000-8000-000000000002"],
   "vehicle_id":"00000000-0000-4000-8000-0000000000a2","rank":1,"combined":0.9,"margin":0.8,"band":"likely","signals":{}}
]$j$) r;
SELECT pg_temp.assert_true((SELECT r->>'written' = '1' AND r->>'duplicate' = '1' AND r->>'skipped' = '3' FROM res),
  'one written; repeat is a duplicate; filed photo, other user''s photo and deleted vehicle are skipped');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT * FROM vehicle_images EXCEPT SELECT * FROM before_images)
  AND NOT EXISTS (SELECT * FROM before_images EXCEPT SELECT * FROM vehicle_images), 'vehicle_images is never written');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated',
  'public.record_capture_set_candidates(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.capture_set_candidates_revert(uuid,text)', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.capture_set_candidates', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.capture_set_candidates', 'INSERT'), 'writers are service-role only');
SELECT pg_temp.assert_true(public.capture_set_candidates_revert('00000000-0000-4000-8000-0000000000e1', 'test') = 1,
  'revert reports one revoked row');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_candidates WHERE revoked_at IS NULL) = 0
  AND (SELECT count(*) FROM capture_set_candidates) = 1, 'revert revokes the run and keeps the row');
\ir revert_20261023220000_capture_set_candidates.sql
SELECT pg_temp.assert_true(to_regclass('public.capture_set_candidates') IS NULL, 'down migration drops the table');
\echo 'PASS test_capture_set_candidates'
