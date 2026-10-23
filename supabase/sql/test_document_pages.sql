-- capture_document_pages: registered pages leave capture sets, evidence enqueues a debounced ±7 day rescore,
-- coverage scales, revoke by run, and revert restores capture_sets_build.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_document_pages%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_document_pages* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, vin text, owner_id uuid, user_id uuid, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, source text, taken_at timestamptz,
  latitude numeric, longitude numeric, vehicle_vin text, vehicle_vin_confidence numeric, is_document boolean, doc_flag boolean,
  is_duplicate boolean, is_superseded boolean, is_sensitive boolean, vision_gate_status text, image_url text);
CREATE TABLE public.image_text_reads(id uuid PRIMARY KEY, image_id uuid, is_document boolean, vin_candidates jsonb, revoked_at timestamptz);
CREATE FUNCTION public.vin_match_key(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(upper(regexp_replace(coalesce(t,''),'[^A-Za-z0-9]','','g')),'') $$;
CREATE FUNCTION public.vin_check_digit_ok(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
\ir ../migrations/20261023230000_document_pages.sql

CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

INSERT INTO vehicle_images(id, user_id, source, taken_at, image_url) VALUES
 ('00000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','capture_relay_ios','2026-10-22 10:00Z','https://x/1.jpg'),
 ('00000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','capture_relay_ios','2026-10-22 10:01Z','https://x/2.jpg'),
 ('00000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','capture_relay_ios','2026-10-22 10:02Z','https://x/3.jpg');
SELECT pg_temp.assert_true((SELECT sum(n) FROM capture_sets_build('11111111-1111-1111-1111-111111111111')) = 3, 'all photos in sets before registering');

INSERT INTO document_batches(id, user_id, label_image_id, box, vehicle_hint, year_hint, opened_at, run_id)
VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000001','Box 3','K5 Blazer',1979,'2026-10-22 10:00Z','33333333-3333-3333-3333-333333333333');
INSERT INTO capture_document_pages(image_id, user_id, batch_id, doc_key, is_label_card, classifier, run_id) VALUES
 ('00000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','label',true,'gemini-flash','33333333-3333-3333-3333-333333333333');
INSERT INTO capture_document_pages(image_id, user_id, batch_id, doc_key, page_no, classifier, doc_date, date_source, run_id) VALUES
 ('00000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','d1',1,'gemini-flash','2019-05-10','ocr','33333333-3333-3333-3333-333333333333');
SELECT pg_temp.assert_true((SELECT sum(n) FROM capture_sets_build('11111111-1111-1111-1111-111111111111')) = 1, 'registered pages excluded');

DO $$ BEGIN
  INSERT INTO capture_document_pages(image_id, user_id, doc_key, classifier, doc_date, date_source, run_id)
  VALUES (gen_random_uuid(), gen_random_uuid(), 'x', 'c', '2020-01-01', 'none', gen_random_uuid());
  RAISE EXCEPTION 'FAIL: dated page without ocr source accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;

INSERT INTO document_evidence(user_id, doc_key, image_ids, doc_date, run_id, batch_id) VALUES
 ('11111111-1111-1111-1111-111111111111','d1','{00000000-0000-0000-0000-000000000002}','2019-05-10','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 15, '±7 day rescore rows');
INSERT INTO document_evidence(user_id, doc_key, image_ids, doc_date, run_id) VALUES
 ('11111111-1111-1111-1111-111111111111','d2','{}','2019-05-12','33333333-3333-3333-3333-333333333333');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 17, 'debounced per user-day');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(reasons) FROM capture_set_rescore_queue WHERE day = '2019-05-11') = 2, 'overlapping day cites both docs');

SELECT pg_temp.assert_true(document_period_coverage('11111111-1111-1111-1111-111111111111','2019-05-10') IS NULL, 'no target => null');
INSERT INTO document_coverage_targets VALUES ('11111111-1111-1111-1111-111111111111','2019-01-01','2019-12-31',4,NULL);
SELECT pg_temp.assert_true(document_period_coverage('11111111-1111-1111-1111-111111111111','2019-05-10') = 0.5, 'coverage 2/4');

SELECT pg_temp.assert_true((document_ingest_revoke('33333333-3333-3333-3333-333333333333')->>'pages')::int = 2, 'revoke pages');
SELECT pg_temp.assert_true((SELECT sum(n) FROM capture_sets_build('11111111-1111-1111-1111-111111111111')) = 3, 'revoked pages return to sets');
SELECT pg_temp.assert_true(document_period_coverage('11111111-1111-1111-1111-111111111111','2019-05-10') = 0, 'revoked evidence stops counting');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE vehicle_id IS NOT NULL) = 0, 'never files');

\ir revert_20261023230000_document_pages.sql
SELECT pg_temp.assert_true(to_regclass('public.capture_document_pages') IS NULL, 'revert drops tables');
SELECT pg_temp.assert_true(position('capture_document_pages' in pg_get_functiondef('public.capture_sets_build(uuid,integer,numeric,numeric,numeric)'::regprocedure)) = 0, 'revert restores capture_sets_build');
SELECT pg_temp.assert_true((SELECT sum(n) FROM capture_sets_build('11111111-1111-1111-1111-111111111111')) = 3, 'restored function works');
\echo 'document_pages: all assertions passed'
