-- capture_non_vehicle_review_v1: reviewed non-vehicle ledger state after a second look.
-- typ alone does not terminate. Dry-default, cap 50, revert-by-run, granted_by required.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_non_vehicle_reviewed%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_non_vehicle_reviewed* database';
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
  is_sensitive boolean DEFAULT false, image_url text, thumbnail_url text, file_name text,
  ai_scan_metadata jsonb, is_duplicate boolean DEFAULT false, duplicate_of uuid, exif_data jsonb);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], reason text, evidence jsonb DEFAULT '{}', status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text);
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, stage text, error_class text);
CREATE TABLE public.capture_set_rescore_queue(
  user_id uuid, day date, requested_at timestamptz, not_before date, done_at timestamptz, done_run_id uuid, reasons jsonb DEFAULT '[]',
  PRIMARY KEY (user_id, day));
CREATE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb)
 RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.capture_set_rescore_queue(user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE SET requested_at = now(), done_at = NULL, done_run_id = NULL,
    reasons = capture_set_rescore_queue.reasons || jsonb_build_array(p_reason);
END $$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261115191000_capture_non_vehicle_reviewed.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_non_vehicle_review_v1(uuid,uuid,uuid,jsonb,boolean,integer)', 'EXECUTE'), 'anon cannot review');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_non_vehicle_review_v1(uuid,uuid,uuid,jsonb,boolean,integer)', 'EXECUTE'), 'service_role can review');

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, is_sensitive, image_url, file_name, ai_scan_metadata) VALUES
 -- eligible typ=other
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:00+00', false, 'https://example.invalid/a1', 'a1.jpg', '{"classification":{"image_type":"other"}}'),
 -- eligible typ=receipt_document
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:01+00', false, 'https://example.invalid/a2', 'a2.jpg', '{"classification":{"image_type":"receipt_document"}}'),
 -- typ=other but actually a vehicle (reviewer verdict)
 ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-02 18:00+00', false, 'https://example.invalid/a3', 'a3.jpg', '{"classification":{"image_type":"other"}}'),
 -- typ=other, reviewer thinks personal, not is_sensitive
 ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:03+00', false, 'https://example.invalid/a4', 'a4.jpg', '{"classification":{"image_type":"other"}}'),
 -- typ=other, is_sensitive (already classified)
 ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:04+00', true, 'https://example.invalid/a5', 'a5.jpg', '{"classification":{"image_type":"other"}}'),
 -- empty url typ=other — skip
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:05+00', false, NULL, 'empty.jpg', '{"classification":{"image_type":"other"}}'),
 -- exclude table typ=other — skip
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:06+00', false, 'https://example.invalid/ex', 'ex.jpg', '{"classification":{"image_type":"other"}}'),
 -- typ=vehicle_exterior cannot be non_vehicle
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:07+00', false, 'https://example.invalid/ex3', 'ex3.jpg', '{"classification":{"image_type":"vehicle_exterior"}}');

INSERT INTO capture_privacy_promote_exclude(image_id, reason, granted_by)
VALUES ('00000000-0000-4000-8000-0000000000e2', 'privacy_backup_union', '00000000-0000-4000-8000-0000000000cc');

-- granted_by required
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_non_vehicle_review_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', NULL, '[]'::jsonb, true, 50);
    RAISE EXCEPTION 'expected granted_by required';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF;
  END;
END $$;

-- dry does not write
SELECT public.capture_non_vehicle_review_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000cc',
  '[{"image_id":"00000000-0000-4000-8000-0000000000a1","verdict":"non_vehicle"}]'::jsonb,
  true, 50) AS dry \gset
SELECT pg_temp.assert_true((:'dry')::jsonb->>'non_vehicle' = '1', 'dry would take the typ=other frame');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM capture_non_vehicle_log), 'dry wrote no log');
SELECT pg_temp.assert_true((SELECT state FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa','UTC','2026-03-01','2026-03-02') WHERE image_id='00000000-0000-4000-8000-0000000000a1') = 'unsorted', 'dry leaves unsorted');

-- mixed apply
SELECT public.capture_non_vehicle_review_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000cc',
  '[
    {"image_id":"00000000-0000-4000-8000-0000000000a1","verdict":"non_vehicle"},
    {"image_id":"00000000-0000-4000-8000-0000000000a2","verdict":"non_vehicle"},
    {"image_id":"00000000-0000-4000-8000-0000000000a3","verdict":"vehicle"},
    {"image_id":"00000000-0000-4000-8000-0000000000a4","verdict":"already_classified_personal"},
    {"image_id":"00000000-0000-4000-8000-0000000000a5","verdict":"non_vehicle"},
    {"image_id":"00000000-0000-4000-8000-0000000000e1","verdict":"non_vehicle"},
    {"image_id":"00000000-0000-4000-8000-0000000000e2","verdict":"non_vehicle"},
    {"image_id":"00000000-0000-4000-8000-0000000000e3","verdict":"non_vehicle"}
  ]'::jsonb,
  false, 50) AS applied \gset

SELECT pg_temp.assert_true((:'applied')::jsonb->>'non_vehicle' = '2', 'two confirmed non-vehicle');
SELECT pg_temp.assert_true((:'applied')::jsonb->>'vehicle' = '1', 'one vehicle returned to planning');
SELECT pg_temp.assert_true((:'applied')::jsonb->>'judgment_personal' = '1', 'unclassified personal is logged, not promoted');
SELECT pg_temp.assert_true(((:'applied')::jsonb->>'skipped')::int = 4, 'empty/exclude/typ/sensitive skipped');

-- a5 sensitive + non_vehicle must be skipped, not promoted to non_vehicle
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM capture_non_vehicle_log WHERE image_id='00000000-0000-4000-8000-0000000000e1' AND reverted_at IS NULL),
  'empty_url not logged as accepted');
SELECT pg_temp.assert_true((SELECT state FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa','UTC','2026-03-01','2026-03-02') WHERE image_id='00000000-0000-4000-8000-0000000000a1') = 'non_vehicle', 'a1 is non_vehicle');
SELECT pg_temp.assert_true((SELECT state FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa','UTC','2026-03-01','2026-03-02') WHERE image_id='00000000-0000-4000-8000-0000000000a2') = 'non_vehicle', 'a2 is non_vehicle');
SELECT pg_temp.assert_true((SELECT state FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa','UTC','2026-03-01','2026-03-02') WHERE image_id='00000000-0000-4000-8000-0000000000a3') = 'unsorted', 'vehicle photo stays unsorted');
SELECT pg_temp.assert_true((SELECT state FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa','UTC','2026-03-01','2026-03-02') WHERE image_id='00000000-0000-4000-8000-0000000000a4') = 'unsorted', 'judgment personal stays unsorted, not private');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue WHERE day = '2026-03-02') = 1, 'vehicle photo day enqueued');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000a4') IS DISTINCT FROM 'rejected_personal', 'did not write rejected_personal from a judgment');
SELECT pg_temp.assert_true((SELECT image_url FROM vehicle_images WHERE id='00000000-0000-4000-8000-0000000000a1') = 'https://example.invalid/a1', 'did not touch image_url');

-- revert restores ledger
SELECT public.capture_non_vehicle_review_revert_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f3') AS rv \gset
SELECT pg_temp.assert_true((:'rv')::jsonb->>'reverted' = '4', 'revert marks accepted log rows (2 non_vehicle + 1 vehicle + 1 judgment)');
SELECT pg_temp.assert_true((SELECT state FROM capture_ledger_states('00000000-0000-4000-8000-0000000000aa','UTC','2026-03-01','2026-03-02') WHERE image_id='00000000-0000-4000-8000-0000000000a1') = 'unsorted', 'revert clears non_vehicle');
