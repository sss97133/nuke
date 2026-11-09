-- Capture ledger classifier skips (20261113110000): frames the classifier or the phone already judged (duplicate, not a
-- vehicle, personal) stop reading 'unsorted'; personal never becomes 'skipped' and never carries a thumbnail; filed, pulled,
-- private, failed, waiting and held frames keep their state; nothing is written; anon reaches nothing; the revert restores it.
-- and vanish once the frame arrives; the re-scan request is made by the owner, claimed once by a phone and closed; anon
-- reaches nothing; the revert removes it all.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_ledger_classifier_skips%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_ledger_classifier_skips* database';
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

-- Stand-ins for the live shapes the ledger reads (vision_gate_status is an enum live; the ledger compares it as text).
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, year integer, make text, model text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  source text, vision_gate_status public.vision_gate_status, is_document boolean DEFAULT false, exif_data jsonb,
  thumbnail_url text, image_url text, file_name text, is_duplicate boolean DEFAULT false, ai_scan_metadata jsonb);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], reason text, evidence jsonb DEFAULT '{}', status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, stage text, error_class text);

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261111170000_capture_ledger.sql
\i supabase/migrations/20261111180000_capture_ledger_fast.sql
\i supabase/migrations/20261111190000_capture_ledger_index.sql

\i supabase/migrations/20261113110000_capture_ledger_classifier_skips.sql

-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', 1973, 'Pontiac', 'Firebird');
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, source, vision_gate_status, thumbnail_url, image_url, file_name, is_duplicate, ai_scan_metadata) VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-01 18:00+00', 'iphoto', 'approved', 't1', 'i1', 'a', false, '{"classification":{"image_type":"other"}}'), -- filed wins
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:01+00', 'iphoto', NULL, 't2', 'i2', 'b', false, '{"classification":{"image_type":"vehicle_exterior"}}'), -- unsorted stays
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:02+00', 'iphoto', NULL, 't3', 'i3', 'c', false, '{"classification":{"image_type":"other"}}'), -- not_vehicle:classifier
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:03+00', 'iphoto', NULL, 't4', 'i4', 'd', true, '{"classification":{"image_type":"vehicle_exterior"}}'), -- duplicate
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:04+00', 'capture_relay_ios', 'pending', 't5', 'i5', 'e', false, '{"on_device_vision":{"is_vehicle":false,"is_personal":false}}'), -- not_vehicle:on_device
 ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:05+00', 'capture_relay_ios', 'pending', 't6', 'i6', 'f', true, '{"on_device_vision":{"is_vehicle":false,"is_personal":true}}'), -- personal wins over duplicate
 ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:06+00', 'capture_relay_ios', 'pending', 't7', 'i7', 'g', false, '{"classification":{"image_type":"vehicle_exterior"},"on_device_vision":{"is_vehicle":false}}'), -- classifier says vehicle: unsorted
 ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:07+00', 'iphoto', 'rejected_misattributed', 't8', 'i8', 'h', true, '{"classification":{"image_type":"other"}}'), -- pulled wins
 ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:08+00', 'iphoto', NULL, 't9', 'i9', 'i', false, '{"classification":{"image_type":"other"}}'), -- held wins
 ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-0000000000bb', NULL, '2026-03-01 18:09+00', 'iphoto', NULL, 't10', 'i10', 'j', true, '{}'); -- another user
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'k', '{00000000-0000-4000-8000-000000000009}', 'no_clear_lead', '2026-11-01 00:00+00');
CREATE TEMP TABLE before_rows AS SELECT * FROM vehicle_images;

SELECT pg_temp.assert_true((SELECT i.indisvalid AND i.indpred IS NOT NULL FROM pg_index i WHERE i.indexrelid = 'public.idx_vehicle_images_ledger_classified'::regclass), 'the partial index is valid and partial');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_capture_ledger(text, date, date, integer)', 'EXECUTE'), 'anon cannot read the ledger');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_ledger_states(uuid, text, date, date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_ledger_frames(uuid, text, date, date)', 'EXECUTE'), 'the readers stay internal');

CREATE TEMP TABLE st AS SELECT image_id, state, reason FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'UTC', NULL, NULL);
CREATE FUNCTION pg_temp.s(n int) RETURNS text LANGUAGE sql AS $$ SELECT state || '/' || reason FROM st WHERE image_id = ('00000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
SELECT pg_temp.assert_true(pg_temp.s(1) = 'on_vehicle/approved', 'a filed frame keeps on_vehicle whatever the classifier said');
SELECT pg_temp.assert_true(pg_temp.s(2) = 'unsorted/not_scored', 'a vehicle frame nobody sorted still reads unsorted');
SELECT pg_temp.assert_true(pg_temp.s(3) = 'skipped/not_vehicle:classifier', 'classifier other -> skipped, signed by the classifier');
SELECT pg_temp.assert_true(pg_temp.s(4) = 'skipped/duplicate', 'a duplicate -> skipped');
SELECT pg_temp.assert_true(pg_temp.s(5) = 'skipped/not_vehicle:on_device', 'no classifier answer and the phone said not a vehicle -> skipped, signed by the phone');
SELECT pg_temp.assert_true(pg_temp.s(6) = 'private/personal_on_device', 'a personal reading is private, never skipped, even when also a duplicate');
SELECT pg_temp.assert_true(pg_temp.s(7) = 'unsorted/not_scored', 'the classifier saying vehicle outranks the phone saying not');
SELECT pg_temp.assert_true(pg_temp.s(8) = 'pulled/rejected_misattributed', 'pulled wins');
SELECT pg_temp.assert_true(pg_temp.s(9) = 'held/no_clear_lead', 'held wins');
SELECT pg_temp.assert_true((SELECT count(*) FROM st) = 9, 'every frame is still listed: nothing is hidden');

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000aa"}', false);
SELECT public.get_capture_ledger('UTC', NULL) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->'totals' @> '{"taken":9,"on_vehicle":1,"unsorted":2,"private":1,"pulled":1,"held":1,"skipped":3}', 'totals: three skipped, one more private, two unsorted');
SELECT pg_temp.assert_true((:'r')::jsonb->'days'->0->'skip_reasons' = '{"duplicate":1,"not_vehicle:classifier":1,"not_vehicle:on_device":1}'::jsonb, 'skip reasons name the producer');
SELECT public.get_capture_ledger_day('2026-03-01', 'UTC') AS d \gset
SELECT pg_temp.assert_true(jsonb_array_length((:'d')::jsonb->'frames') = 9, 'the day detail lists all nine frames');
SELECT pg_temp.assert_true((SELECT f->>'thumb' FROM jsonb_array_elements((:'d')::jsonb->'frames') f WHERE f->>'image_id' = '00000000-0000-4000-8000-000000000006') IS NULL, 'a personal frame carries no thumbnail');
SELECT pg_temp.assert_true((SELECT f->>'state' FROM jsonb_array_elements((:'d')::jsonb->'frames') f WHERE f->>'image_id' = '00000000-0000-4000-8000-000000000003') = 'skipped'
  AND (SELECT f->>'thumb' FROM jsonb_array_elements((:'d')::jsonb->'frames') f WHERE f->>'image_id' = '00000000-0000-4000-8000-000000000003') = 't3', 'day detail and day list agree; a skipped frame keeps its thumbnail');
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000bb"}', false);
SELECT pg_temp.assert_true((public.get_capture_ledger('UTC', NULL)->'totals') @> '{"taken":1,"skipped":1}', 'another user sees only their own frame');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT * FROM vehicle_images EXCEPT SELECT * FROM before_rows) AND NOT EXISTS (SELECT * FROM before_rows EXCEPT SELECT * FROM vehicle_images), 'readers only: no frame written');

\i supabase/sql/revert_20261113110000_capture_ledger_classifier_skips.sql
SELECT pg_temp.assert_true(to_regclass('public.idx_vehicle_images_ledger_classified') IS NULL
  AND position('personal_on_device' IN pg_get_functiondef('public.capture_ledger_states(uuid, text, date, date)'::regprocedure)) = 0
  AND position('sk_all' IN pg_get_functiondef('public.get_capture_ledger(text, date, date, integer)'::regprocedure)) = 0, 'revert restores the 20261111190000 readers');
SELECT pg_temp.assert_true((SELECT state FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'UTC', NULL, NULL) WHERE image_id = '00000000-0000-4000-8000-000000000003') = 'unsorted', 'after revert the frame reads unsorted again');
SELECT 'capture ledger classifier skips contract: ok' AS result;
