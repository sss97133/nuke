-- Capture documents land by VIN (20261112130000, 20261112160000, 20261112170000): a waiting document page whose VIN resolves
-- to a vehicle the user holds is recorded as a text read and lands on that vehicle as a page (landing_vehicle_id); the frame,
-- held or not, is never touched; bad check digits, low confidence, ambiguous or foreign VINs are skipped with a reason; dry
-- runs write nothing; landed pages leave the to-land view; the tick, grants, schedule and revert.
-- ALLOW_RAW_TESTIMONY_WRITE: every table here is a stand-in created in a disposable test database, never production.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_documents_land_by_vin%' OR to_regclass('public.capture_document_pages') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_documents_land_by_vin* database';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- Stand-ins for the live shapes (columns as live on 2026-11-08) and for the writers the step calls.
CREATE TABLE public.contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contributor_type text NOT NULL, agent_key text, agent_version text,
  status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vin text, owner_id uuid, user_id uuid, deleted_at timestamptz,
  merged_into_vehicle_id uuid, status text DEFAULT 'active', created_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, taken_at timestamptz,
  is_duplicate boolean DEFAULT false, is_sensitive boolean DEFAULT false, vision_gate_status text DEFAULT 'pending', file_hash text);
CREATE TABLE public.capture_document_pages(image_id uuid PRIMARY KEY, user_id uuid NOT NULL, doc_type text, class_conf numeric,
  extraction jsonb NOT NULL DEFAULT '{}', revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.image_text_reads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, run_id uuid, contributor_key text, method text,
  is_document boolean, vin_candidates jsonb);
CREATE TABLE public.capture_set_links(run_id uuid, set_key text, image_id uuid, vehicle_id uuid, confidence numeric, basis text, min_conf numeric);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;

-- the live check digit (copied 2026-11-08)
CREATE FUNCTION public.vin_check_digit_ok(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN upper(coalesce(p, '')) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN false ELSE (
    SELECT substr(upper(p), 9, 1) = CASE WHEN sum(val * w) % 11 = 10 THEN 'X' ELSE (sum(val * w) % 11)::text END
    FROM (SELECT CASE WHEN ch ~ '[0-9]' THEN ch::int ELSE (position(ch IN 'ABCDEFGHJKLMNPRSTUVWXYZ') - 1)::int END idx, ch, i,
                 ('{8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2}'::int[])[i] w
          FROM (SELECT substr(upper(p), i, 1) ch, i FROM generate_series(1, 17) i) c) c2
    CROSS JOIN LATERAL (SELECT CASE WHEN c2.ch ~ '[0-9]' THEN c2.idx
      ELSE ('{1,2,3,4,5,6,7,8,1,2,3,4,5,7,9,2,3,4,5,6,7,8,9}'::int[])[c2.idx + 1] END val) v) END $$;
-- the live resolver, which 20261112160000 stops calling (it scans every vehicle; the step reads upper(vin) on its index)
CREATE FUNCTION public.find_vehicle_by_vin(p_vin text, p_require_unique boolean) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
BEGIN RAISE EXCEPTION 'find_vehicle_by_vin must not be called: it scans every vehicle'; END $$;
CREATE FUNCTION public.receipt_user_vehicle_tie(p_user uuid, p_vehicle uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN owner_id = p_user THEN 'vehicles.owner_id' WHEN user_id = p_user THEN 'vehicles.user_id' END FROM vehicles WHERE id = p_vehicle $$;
-- writers, stubbed to record what they were asked
CREATE FUNCTION public.record_image_text_reads(p_run_id uuid, p_contributor_key text, p_method text, p_items jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contributors WHERE agent_key = p_contributor_key AND status <> 'frozen') THEN RAISE EXCEPTION 'unknown contributor %', p_contributor_key; END IF;
  INSERT INTO image_text_reads(image_id, run_id, contributor_key, method, is_document, vin_candidates)
  SELECT (it->>'image_id')::uuid, p_run_id, p_contributor_key, p_method, (it->>'is_document')::boolean, it->'vin_candidates' FROM jsonb_array_elements(p_items) it;
  RETURN jsonb_build_object('recorded', jsonb_array_length(p_items), 'skipped', 0, 'run_id', p_run_id);
END $$;
CREATE FUNCTION public.capture_sets_apply(p_run_id uuid, p_user uuid, p_items jsonb, p_min_conf numeric) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'capture_sets_apply must not be called: frames stay where they are, the page lands'; END $$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

-- Fixture (stand-in tables, synthetic ids and VINs only):
--   U holds V1 (17-char VIN, check digit valid) and V2 (pre-1981 serial); V3 belongs to someone else; V4a/V4b share a serial.
INSERT INTO vehicles(id, vin, owner_id, user_id) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', '1HGCM82633A004352', 'aaaaaaaa-0000-4000-8000-00000000000a', NULL),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'CE141J600001', NULL, 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('aaaaaaaa-0000-4000-8000-0000000000a3', '2HGCM82623A004353', 'bbbbbbbb-0000-4000-8000-00000000000b', NULL),
  ('aaaaaaaa-0000-4000-8000-0000000000a4', 'KE141S600002', 'aaaaaaaa-0000-4000-8000-00000000000a', NULL),
  ('aaaaaaaa-0000-4000-8000-0000000000a5', 'KE141S600002', 'aaaaaaaa-0000-4000-8000-00000000000a', NULL);
INSERT INTO vehicle_images(id, user_id, taken_at, vision_gate_status) VALUES
  ('cccccccc-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-00000000000a', '2024-01-27 18:00+00', 'pending'),  -- title, V1
  ('cccccccc-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-00000000000a', '2024-01-28 18:00+00', 'pending'),  -- sale sheet, V2 serial
  ('cccccccc-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-4000-8000-00000000000a', '2024-01-29 18:00+00', 'pending'),  -- bad check digit
  ('cccccccc-0000-4000-8000-0000000000c4', 'aaaaaaaa-0000-4000-8000-00000000000a', '2024-01-30 18:00+00', 'pending'),  -- someone else's vehicle
  ('cccccccc-0000-4000-8000-0000000000c5', 'aaaaaaaa-0000-4000-8000-00000000000a', '2024-01-31 18:00+00', 'pending'),  -- low confidence
  ('cccccccc-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-4000-8000-00000000000a', '2024-02-01 18:00+00', 'pending'),  -- ambiguous serial
  ('cccccccc-0000-4000-8000-0000000000c7', 'aaaaaaaa-0000-4000-8000-00000000000a', '2024-02-02 18:00+00', 'rejected_personal'), -- held frame
  ('cccccccc-0000-4000-8000-0000000000c8', 'aaaaaaaa-0000-4000-8000-00000000000a', '2024-02-03 18:00+00', 'pending');  -- no vin on the page
INSERT INTO capture_document_pages(image_id, user_id, doc_type, class_conf, extraction) VALUES
  ('cccccccc-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-00000000000a', 'title', 0.9, '{"vin":"1HGCM82633A004352","confidence":0.92,"year":"2003"}'),
  ('cccccccc-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-00000000000a', 'sale_sheet', 0.8, '{"vin":"CE141J 600001","confidence":0.85,"year":"1971"}'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-4000-8000-00000000000a', 'title', 0.9, '{"vin":"1HGCM82643A004352","confidence":0.9}'),
  ('cccccccc-0000-4000-8000-0000000000c4', 'aaaaaaaa-0000-4000-8000-00000000000a', 'title', 0.9, '{"vin":"2HGCM82623A004353","confidence":0.9}'),
  ('cccccccc-0000-4000-8000-0000000000c5', 'aaaaaaaa-0000-4000-8000-00000000000a', 'other', 0.3, '{"vin":"1HGCM82633A004352","confidence":0.4}'),
  ('cccccccc-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-4000-8000-00000000000a', 'title', 0.9, '{"vin":"KE141S600002","confidence":0.9}'),
  ('cccccccc-0000-4000-8000-0000000000c7', 'aaaaaaaa-0000-4000-8000-00000000000a', 'title', 0.9, '{"vin":"1HGCM82633A004352","confidence":0.9}'),
  ('cccccccc-0000-4000-8000-0000000000c8', 'aaaaaaaa-0000-4000-8000-00000000000a', 'receipt', 0.9, '{"vendor_name":"Example Parts Co","total":12.5}');

\i supabase/migrations/20261112130000_capture_documents_land_by_vin.sql
\i supabase/migrations/20261112160000_capture_documents_land_by_vin_indexed.sql
\i supabase/migrations/20261112170000_capture_documents_land_pages_by_vin.sql

SELECT pg_temp.assert_true((SELECT count(*) FROM contributors WHERE agent_key='agent:subscription-document-reader' AND contributor_type='agent') = 1, 'the reader is a contributor');

-- dry run: three candidates (the title, the sale sheet and the held title: a held frame still carries paper), four skipped
-- with reasons, nothing written
SELECT public.capture_documents_land_by_vin('aaaaaaaa-0000-4000-8000-00000000000a', 'dddddddd-0000-4000-8000-0000000000d1', true, 50) AS dry \gset
SELECT pg_temp.assert_true((:'dry')::jsonb->>'candidates' = '3' AND ((:'dry')::jsonb->>'dry')::boolean, 'dry run: the title, the sale sheet and the held title are candidates');
SELECT pg_temp.assert_true((SELECT jsonb_agg(s->>'reason' ORDER BY s->>'image_id') FROM jsonb_array_elements((:'dry')::jsonb->'skipped') s)
  = '["check_digit_failed","vehicle_not_held_by_user","low_confidence","no_unique_vehicle"]'::jsonb, 'skipped pages carry their reason');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_document_pages WHERE landing_vehicle_id IS NOT NULL) = 0 AND (SELECT count(*) FROM image_text_reads) = 0, 'a dry run writes nothing');

-- live run: three pages land on their vehicles, three reads recorded with the reader as contributor; no frame moves
SELECT public.capture_documents_land_by_vin('aaaaaaaa-0000-4000-8000-00000000000a', 'dddddddd-0000-4000-8000-0000000000d2', false, 50) AS live \gset
SELECT pg_temp.assert_true((:'live')::jsonb->>'pages_resolved' = '3' AND (:'live')::jsonb#>>'{text_reads,recorded}' = '3', 'live run resolves three pages and records three reads');
SELECT pg_temp.assert_true((SELECT landing_vehicle_id FROM capture_document_pages WHERE image_id='cccccccc-0000-4000-8000-0000000000c1') = 'aaaaaaaa-0000-4000-8000-0000000000a1'
  AND (SELECT landing_vehicle_id FROM capture_document_pages WHERE image_id='cccccccc-0000-4000-8000-0000000000c2') = 'aaaaaaaa-0000-4000-8000-0000000000a2'
  AND (SELECT landing_vehicle_id FROM capture_document_pages WHERE image_id='cccccccc-0000-4000-8000-0000000000c7') = 'aaaaaaaa-0000-4000-8000-0000000000a1', 'each page lands on the vehicle its VIN names');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_document_pages WHERE landing_basis='vin:document_page' AND landing_run_id='dddddddd-0000-4000-8000-0000000000d2') = 3, 'the landing carries its basis and run');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE vehicle_id IS NOT NULL) = 0, 'no frame is moved');
SELECT pg_temp.assert_true((SELECT count(*) FROM image_text_reads WHERE contributor_key='agent:subscription-document-reader' AND method='capture_document_pages_vin_v1'
  AND is_document AND vin_candidates->0->>'vin' IN ('1HGCM82633A004352','CE141J600001')) = 3, 'the reads carry the reader, the method and the VIN');

-- the resolved pages wait for the document route with their vehicle; a landed page leaves the view
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_document_pages_to_land WHERE basis='vin:document_page' AND vehicle_id IS NOT NULL) = 3, 'three pages are ready to land, each with its vehicle');
UPDATE capture_document_pages SET extraction = extraction || '{"landed":{"as":"vehicle_document","at":"2026-11-08T18:00:00Z"}}' WHERE image_id='cccccccc-0000-4000-8000-0000000000c1'; -- stand-in table
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_document_pages_to_land) = 2, 'a landed page leaves the view');
-- a frame that holds a vehicle lists its page too, with the frame as basis
UPDATE vehicle_images SET vehicle_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' WHERE id='cccccccc-0000-4000-8000-0000000000c8'; -- stand-in table
SELECT pg_temp.assert_true((SELECT basis FROM capture_document_pages_to_land WHERE image_id='cccccccc-0000-4000-8000-0000000000c8') = 'frame', 'a page on a filed frame lands by the frame');

-- a second run finds nothing left
SELECT public.capture_documents_land_by_vin('aaaaaaaa-0000-4000-8000-00000000000a', 'dddddddd-0000-4000-8000-0000000000d3', false, 50) AS again \gset
SELECT pg_temp.assert_true((:'again')::jsonb->>'candidates' = '0' AND (:'again')::jsonb->>'pages_resolved' = '0', 'nothing lands twice');

-- the tick covers users with unresolved VIN pages
UPDATE capture_document_pages SET landing_vehicle_id = NULL, landing_basis = NULL, landing_run_id = NULL WHERE image_id='cccccccc-0000-4000-8000-0000000000c2'; -- stand-in table
SELECT public.capture_documents_land_by_vin_tick(50) AS tick \gset
SELECT pg_temp.assert_true((:'tick')::jsonb->>'users' = '1' AND (:'tick')::jsonb->'runs'->0->>'pages_resolved' = '1', 'the tick runs the step per user');

-- grants and schedule
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_documents_land_by_vin(uuid, uuid, boolean, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_documents_land_by_vin_tick(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.capture_documents_land_by_vin(uuid, uuid, boolean, integer)', 'EXECUTE'), 'service side only');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon', 'public.capture_document_pages_to_land', 'SELECT') AND has_table_privilege('service_role', 'public.capture_document_pages_to_land', 'SELECT'), 'the view is service side');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job WHERE jobname='capture-documents-land-by-vin' AND schedule='4-59/10 * * * *') = 1, 'scheduled every 10 minutes');

-- revert (page landing, then the indexed body, then the step itself)
\i supabase/sql/revert_20261112170000_capture_documents_land_pages_by_vin.sql
SELECT pg_temp.assert_true(to_regclass('public.capture_document_pages_to_land') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='capture_document_pages' AND column_name='landing_vehicle_id'), 'the page-landing revert restores the frame step and drops its columns');
\i supabase/sql/revert_20261112160000_capture_documents_land_by_vin_indexed.sql
\i supabase/sql/revert_20261112130000_capture_documents_land_by_vin.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_documents_land_by_vin(uuid, uuid, boolean, integer)') IS NULL AND to_regclass('public.capture_document_pages_to_land') IS NULL
  AND (SELECT count(*) FROM cron.job WHERE jobname='capture-documents-land-by-vin') = 0 AND (SELECT count(*) FROM image_text_reads) = 4, 'revert removes the step, view and schedule, keeps the reads');
SELECT 'capture documents land by vin contract: ok' AS result;
