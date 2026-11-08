-- Capture ledger (20261111170000 + the grouped reader 20261111180000): one state per frame shared by the day list and the day detail; the phone's skips land with their reason
-- and vanish once the frame arrives; the re-scan request is made by the owner, claimed once by a phone and closed; anon
-- reaches nothing; the revert removes it all.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_ledger%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_ledger* database';
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
  thumbnail_url text, image_url text, file_name text);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], reason text, evidence jsonb DEFAULT '{}', status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, stage text, error_class text);

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261111170000_capture_ledger.sql
\i supabase/migrations/20261111180000_capture_ledger_fast.sql

-- Fixture (synthetic, a disposable database): one owner, two vehicles, one day with every state, a second day of skips.
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO vehicles VALUES
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', 1973, 'Pontiac', 'Firebird'),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', 1966, 'Ford', 'Mustang');
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, source, vision_gate_status, exif_data, thumbnail_url, image_url, file_name) VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-01 18:00+00', 'capture_relay_ios', 'approved', '{"uuid":"A1"}', 't1', 'i1', 'IMG_0001.heic'),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-01 18:01+00', 'capture_relay_ios', 'approved', '{"uuid":"A2"}', NULL, 'i2', 'IMG_0002.heic'),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b2', '2026-03-01 18:02+00', 'iphoto', 'review_needed', NULL, NULL, 'i3', 'IMG_0003.heic'),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:03+00', 'capture_relay_ios', 'pending', '{"uuid":"A4"}', NULL, 'i4', 'IMG_0004.heic'), -- held
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:04+00', 'capture_relay_ios', 'pending', NULL, NULL, 'i5', 'IMG_0005.heic'), -- waiting
 ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:05+00', 'photo_auto_sync', 'rejected_misattributed', NULL, NULL, 'i6', 'IMG_0006.heic'), -- pulled
 ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:06+00', 'photo_auto_sync', 'rejected_personal', NULL, 't7', 'i7', 'IMG_0007.heic'), -- private
 ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:07+00', 'iphoto', NULL, NULL, NULL, 'i8', 'IMG_0008.heic'), -- unsorted
 ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:08+00', 'capture_relay_ios', 'pending', NULL, NULL, 'i9', 'IMG_0009.heic'), -- failed upload
 ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000b1', '2026-03-01 18:09+00', 'capture_relay_ios', 'approved', NULL, NULL, 'i10', 'OTHER.heic'); -- another user
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, evidence, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:A', '{00000000-0000-4000-8000-000000000004}', 'score_below_threshold',
  '{"top3":[{"rank":1,"vehicle_id":"00000000-0000-4000-8000-0000000000b1","signals":{"score":1.9}},{"rank":2,"vehicle_id":"00000000-0000-4000-8000-0000000000b2","signals":{"score":0.4}}]}', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000aa', 'ios:a:A', '{00000000-0000-4000-8000-000000000004}', 'no_clear_lead', '{}', '2026-10-01 00:00+00'); -- older row for the same frame: the newest wins
INSERT INTO capture_landing_chunks(id, user_id, state) VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa', 'awaiting_gate');
INSERT INTO capture_landing_sets VALUES ('00000000-0000-4000-8000-0000000000d1', 'ios:a:W', '{00000000-0000-4000-8000-000000000005}', 'clear');
INSERT INTO capture_upload_status VALUES ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000aa', 'failed', 'timeout');

-- anon reaches nothing
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_capture_ledger(text, date, date, integer)', 'EXECUTE'), 'anon cannot read the ledger');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_capture_ledger_day(date, text)', 'EXECUTE'), 'anon cannot read a day');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.report_capture_skips(jsonb)', 'EXECUTE'), 'anon cannot report skips');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.request_capture_rescan(date, text)', 'EXECUTE'), 'anon cannot ask for a re-scan');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon', 'public.capture_skips', 'SELECT'), 'anon cannot select skips');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_ledger_frames(uuid, text, date, date)', 'EXECUTE'), 'the frame reader is internal');

-- signed out: an empty ledger, no error
SELECT set_config('request.jwt.claims', '', false);
SELECT public.get_capture_ledger('UTC', NULL) AS r0 \gset
SELECT pg_temp.assert_true((:'r0')::jsonb->'totals'->>'taken' = '0' AND jsonb_array_length((:'r0')::jsonb->'days') = 0, 'signed out: empty ledger');

-- the owner: one state per frame
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000aa"}', false);
SELECT public.get_capture_ledger('UTC', NULL) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->'totals'->>'taken' = '9', 'nine of the owner''s frames, never the other user''s');
SELECT pg_temp.assert_true((:'r')::jsonb->'totals' @> '{"on_vehicle":2,"unverified":1,"held":1,"waiting":1,"pulled":1,"private":1,"unsorted":1,"failed":1,"skipped":0}', 'totals by state');
SELECT pg_temp.assert_true(jsonb_array_length((:'r')::jsonb->'days') = 1 AND (:'r')::jsonb->'days'->0->>'day' = '2026-03-01', 'one day');
SELECT pg_temp.assert_true((:'r')::jsonb->'days'->0->'vehicles'->0 @> '{"name":"1973 Pontiac Firebird","n":2}' AND (:'r')::jsonb->'days'->0->'vehicles'->1 @> '{"name":"1966 Ford Mustang","n":1}', 'vehicles per day, biggest first, unverified counted');
SELECT pg_temp.assert_true((:'r')::jsonb->'days'->0->'held_reasons' = '{"score_below_threshold": 1}', 'the newest review row names the hold reason');
SELECT pg_temp.assert_true((:'r')::jsonb->'rescan' IS NULL OR (:'r')::jsonb->'rescan' = 'null'::jsonb, 'no open re-scan');

-- the day detail agrees with the day list and carries the near misses
SELECT public.get_capture_ledger_day('2026-03-01', 'UTC') AS d \gset
SELECT pg_temp.assert_true(jsonb_array_length((:'d')::jsonb->'frames') = 9, 'nine frames on the day');
SELECT pg_temp.assert_true((SELECT jsonb_object_agg(f->>'image_id', f->>'state') FROM jsonb_array_elements((:'d')::jsonb->'frames') f) @>
  '{"00000000-0000-4000-8000-000000000001":"on_vehicle","00000000-0000-4000-8000-000000000003":"unverified","00000000-0000-4000-8000-000000000004":"held","00000000-0000-4000-8000-000000000005":"waiting","00000000-0000-4000-8000-000000000006":"pulled","00000000-0000-4000-8000-000000000007":"private","00000000-0000-4000-8000-000000000008":"unsorted","00000000-0000-4000-8000-000000000009":"failed"}', 'each frame has its state');
SELECT pg_temp.assert_true((SELECT f->>'thumb' FROM jsonb_array_elements((:'d')::jsonb->'frames') f WHERE f->>'image_id' = '00000000-0000-4000-8000-000000000007') IS NULL, 'a private frame carries no thumbnail');
SELECT pg_temp.assert_true((SELECT f->>'thumb' FROM jsonb_array_elements((:'d')::jsonb->'frames') f WHERE f->>'image_id' = '00000000-0000-4000-8000-000000000002') = 'i2', 'thumbnail falls back to the image url');
SELECT pg_temp.assert_true((SELECT f->>'reason' FROM jsonb_array_elements((:'d')::jsonb->'frames') f WHERE f->>'image_id' = '00000000-0000-4000-8000-000000000009') = 'timeout', 'a failed upload carries its error class');
SELECT pg_temp.assert_true((SELECT f->'candidates'->0 @> '{"name":"1973 Pontiac Firebird","score":1.9}' FROM jsonb_array_elements((:'d')::jsonb->'frames') f WHERE f->>'image_id' = '00000000-0000-4000-8000-000000000004'), 'a held frame shows the scorer''s top candidate');
SELECT pg_temp.assert_true((SELECT f->>'vehicle' FROM jsonb_array_elements((:'d')::jsonb->'frames') f WHERE f->>'image_id' = '00000000-0000-4000-8000-000000000003') = '1966 Ford Mustang', 'the vehicle is named');

-- the phone reports what it skipped; a skip whose frame arrived is not counted; the newest decision wins; bad rows are ignored
SELECT public.report_capture_skips('[
  {"asset_id":"S1","reason":"no_location","taken_at":"2026-03-02T18:00:00Z","decided_at":"2026-03-02T18:00:00Z"},
  {"asset_id":"S2","reason":"off_site","taken_at":"2026-03-02T18:01:00Z","device":"iPhone"},
  {"asset_id":"S3","reason":"screenshot","taken_at":"2026-03-02T18:02:00Z"},
  {"asset_id":"A4","reason":"no_location","taken_at":"2026-03-01T18:03:00Z"},
  {"asset_id":"","reason":"off_site"},
  {"asset_id":"S9","reason":"because"}]') AS w \gset
SELECT pg_temp.assert_true((:'w')::jsonb->>'written' = '4', 'four valid skips written');
SELECT public.report_capture_skips('[{"asset_id":"S1","reason":"off_site","decided_at":"2026-03-03T00:00:00Z"},{"asset_id":"S1","reason":"no_location","decided_at":"2026-03-02T00:00:00Z"}]') AS w2 \gset
SELECT pg_temp.assert_true((SELECT reason FROM capture_skips WHERE asset_id = 'S1') = 'off_site', 'the newest decision for an asset wins');
SELECT public.report_capture_skips('[{"asset_id":"S1","reason":"screenshot","decided_at":"2026-03-01T00:00:00Z"}]') AS w3 \gset
SELECT pg_temp.assert_true((:'w3')::jsonb->>'written' = '0' AND (SELECT reason FROM capture_skips WHERE asset_id = 'S1') = 'off_site', 'an older decision never overwrites a newer one');
SELECT public.get_capture_ledger('UTC', NULL) AS r2 \gset
SELECT pg_temp.assert_true((:'r2')::jsonb->'totals'->>'skipped' = '3', 'three skips count; the one whose frame arrived (A4) does not');
SELECT pg_temp.assert_true(jsonb_array_length((:'r2')::jsonb->'days') = 2 AND (:'r2')::jsonb->'days'->0->>'day' = '2026-03-02' AND (:'r2')::jsonb->'days'->0->>'skipped' = '3' AND (:'r2')::jsonb->'days'->0->>'taken' = '0', 'a day of only skips appears, newest first');
SELECT pg_temp.assert_true((:'r2')::jsonb->'days'->0->'skip_reasons' = '{"off_site": 2, "screenshot": 1}'::jsonb, 'skip reasons per day');
SELECT public.get_capture_ledger_day('2026-03-02', 'UTC') AS d2 \gset
SELECT pg_temp.assert_true(jsonb_array_length((:'d2')::jsonb->'skipped') = 3 AND jsonb_array_length((:'d2')::jsonb->'frames') = 0, 'the day detail lists the skipped assets');
-- the window and the limit
SELECT public.get_capture_ledger('UTC', '2026-03-02', NULL, 180) AS r3 \gset
SELECT pg_temp.assert_true((:'r3')::jsonb->'totals'->>'taken' = '0' AND (:'r3')::jsonb->'totals'->>'skipped' = '3', 'p_from cuts the window');
SELECT public.get_capture_ledger('UTC', NULL, NULL, 1) AS r4 \gset
-- the default window is the last year
SELECT pg_temp.assert_true((public.get_capture_ledger('UTC')->'totals'->>'taken')::int <= 9, 'the default window reads at most the fixture');
SELECT pg_temp.assert_true(jsonb_array_length((:'r4')::jsonb->'days') = 1 AND (:'r4')::jsonb->>'days_total' = '2', 'p_limit caps the days, days_total says how many there are');

-- the re-scan request: made by the owner, widened by a second ask, claimed once, closed
SELECT public.request_capture_rescan('2026-04-01', 'web') AS q1 \gset
SELECT pg_temp.assert_true((:'q1')::jsonb->>'reused' = 'false' AND (:'q1')::jsonb->>'from_date' = '2026-04-01' AND (:'q1')::jsonb->>'source' = 'web', 'a request is made');
SELECT public.request_capture_rescan('2026-03-01', 'web') AS q2 \gset
SELECT pg_temp.assert_true((:'q2')::jsonb->>'reused' = 'true' AND (:'q2')::jsonb->>'from_date' = '2026-03-01' AND (:'q2')::jsonb->>'id' = (:'q1')::jsonb->>'id', 'a second ask widens the open request');
SELECT public.get_capture_ledger('UTC', NULL) AS r5 \gset
SELECT pg_temp.assert_true((:'r5')::jsonb->'rescan'->>'id' = (:'q1')::jsonb->>'id', 'the ledger shows the open request');
SELECT public.claim_capture_rescan('iPhone 17') AS c1 \gset
SELECT pg_temp.assert_true((:'c1')::jsonb->>'id' = (:'q1')::jsonb->>'id' AND (:'c1')::jsonb->>'device' = 'iPhone 17' AND (:'c1')::jsonb->>'acked_at' IS NOT NULL, 'the phone claims it');
SELECT pg_temp.assert_true(public.claim_capture_rescan('iPad') IS NULL, 'claimed once');
SELECT public.finish_capture_rescan(((:'q1')::jsonb->>'id')::uuid, '{"uploaded": 12, "skipped": 3}') AS f1 \gset
SELECT pg_temp.assert_true((:'f1')::jsonb->>'finished_at' IS NOT NULL AND (:'f1')::jsonb->'result'->>'uploaded' = '12', 'closed with its pass summary');
SELECT public.get_capture_ledger('UTC', NULL) AS r6 \gset
SELECT pg_temp.assert_true(((:'r6')::jsonb->'rescan') IS NULL OR (:'r6')::jsonb->'rescan' = 'null'::jsonb, 'no open request after it finishes');
SELECT pg_temp.assert_true((:'r6')::jsonb->'last_rescan'->>'id' = (:'q1')::jsonb->>'id', 'the last finished request is shown');
-- another user sees none of it
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000bb"}', false);
SELECT public.get_capture_ledger('UTC', NULL) AS r7 \gset
SELECT pg_temp.assert_true((:'r7')::jsonb->'totals'->>'taken' = '1' AND (:'r7')::jsonb->'totals'->>'skipped' = '0' AND jsonb_typeof((:'r7')::jsonb->'last_rescan') = 'null', 'another user sees only their own frame');
SELECT pg_temp.assert_true(public.finish_capture_rescan(((:'q1')::jsonb->>'id')::uuid, '{}') IS NULL, 'another user cannot close someone else''s request');
-- nothing here writes testimony
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE vehicle_id IS NOT NULL) = 4, 'vehicle_images untouched');

-- the revert removes it all
\i supabase/sql/revert_20261111170000_capture_ledger.sql
SELECT pg_temp.assert_true(to_regclass('public.capture_skips') IS NULL AND to_regclass('public.capture_rescan_requests') IS NULL
  AND to_regprocedure('public.get_capture_ledger(text, date, date, integer)') IS NULL, 'revert removes the ledger');
SELECT 'capture ledger contract: ok' AS result;
