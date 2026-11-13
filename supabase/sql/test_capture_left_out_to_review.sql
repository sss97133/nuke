-- capture_left_out_to_review_v1: clocked, non-sensitive left-outs of
-- already-planned days, and never-planned frames with a real storage
-- URL, go to held review. Never files, never re-arms, never touches
-- the gate. typ=other / receipt_document and placeholder URLs are skipped.
-- Dry-default, cap 50, granted_by, revert-by-run, confidence 0.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_left_out_to_review%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_left_out_to_review* database';
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
  is_sensitive boolean DEFAULT false, image_url text, file_name text,
  ai_scan_metadata jsonb, is_duplicate boolean DEFAULT false, duplicate_of uuid);
CREATE TABLE public.capture_set_review(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], confidence numeric NOT NULL DEFAULT 0, basis text, evidence jsonb DEFAULT '{}'::jsonb,
  reason text, status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now(),
  UNIQUE (run_id, set_key));
CREATE TABLE public.capture_landing_chunks(
  id uuid PRIMARY KEY, user_id uuid, t_from timestamptz, t_to timestamptz,
  dry boolean DEFAULT false, state text, run_id uuid, created_at timestamptz DEFAULT now(),
  note text);
CREATE TABLE public.capture_privacy_promote_exclude(image_id uuid PRIMARY KEY, reason text, granted_by uuid);
CREATE TABLE public.capture_non_vehicle_log(
  run_id uuid NOT NULL, image_id uuid NOT NULL, user_id uuid, granted_by uuid,
  typ text, verdict text NOT NULL, reason text, day date, signature text,
  applied_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz,
  UNIQUE (run_id, image_id));
CREATE TABLE public.capture_set_links(image_id uuid, reverted_at timestamptz);
CREATE TABLE public.capture_document_pages(image_id uuid, revoked_at timestamptz);
CREATE TABLE public.capture_set_rescore_queue(
  user_id uuid, day date, requested_at timestamptz, done_at timestamptz, reasons jsonb DEFAULT '[]',
  PRIMARY KEY (user_id, day));
CREATE TABLE public.capture_landing_config(
  user_id uuid PRIMARY KEY, forward_cursor timestamptz, halted boolean, halt_reason text);

INSERT INTO capture_landing_config(user_id, forward_cursor, halted)
VALUES ('00000000-0000-4000-8000-0000000000aa', '2026-11-03 10:00:00+00', false);

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261115235000_capture_left_out_to_review.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_left_out_to_review_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'anon cannot route');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_left_out_to_review_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'service_role can route');

-- chunks: A,B applied (planned left-outs); D awaiting_gate (must not route). C has no chunk (unadmitted).
INSERT INTO capture_landing_chunks(id, user_id, t_from, t_to, dry, state, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa',
  '2026-03-12 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2026-03-13 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  false, 'applied', '2026-03-13 08:00+00'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa',
  '2026-03-14 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2026-03-15 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  false, 'applied', '2026-03-15 08:00+00'),
 ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000aa',
  '2026-07-01 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2026-07-02 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  false, 'awaiting_gate', '2026-07-02 08:00+00');

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, image_url, is_sensitive, is_duplicate, duplicate_of, ai_scan_metadata) VALUES
 -- day A applied typ-empty: 2 eligible
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:00+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/a1.jpg', false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:10+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-images/a2.jpg', false, false, NULL, '{"classification":{"image_type":""}}'),
 -- day B applied typ progress_shot / exterior (superseded analog): 2 eligible
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-14 18:00+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/b1.jpg', false, false, NULL, '{"classification":{"image_type":"progress_shot"}}'),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-14 18:10+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/b2.jpg', false, false, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
 -- day C never planned, real files: 2 eligible
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-05-23 18:00+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/c1.jpg', false, false, NULL, '{"classification":{"image_type":"engine_bay"}}'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-05-23 18:10+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/c2.jpg', false, false, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
 -- skips
 ('00000000-0000-4000-8000-0000000000d0', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:20+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/d0.jpg', false, false, NULL, '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:21+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/d1.jpg', false, false, NULL, '{"classification":{"image_type":"receipt_document"}}'),
 ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:22+00', 'https://example.com/final_test.jpg', false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-14 18:20+00', 'https://test.example.com/test.jpg', false, false, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-05-23 18:20+00', 'https://test-trigger-check.jpg', false, false, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:23+00', NULL, false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/d6.jpg', false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000d7', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:24+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/d7.jpg', true, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:25+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/d8.jpg', false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:26+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/d9.jpg', false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ff', '2026-03-12 18:27+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/da.jpg', false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000db', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:28+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/db.jpg', false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000dc', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:29+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/dc.jpg', false, true, '00000000-0000-4000-8000-0000000000a1', '{}'),
 ('00000000-0000-4000-8000-0000000000dd', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:30+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/dd.jpg', false, false, NULL, '{}'),
 ('00000000-0000-4000-8000-0000000000de', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-07-01 18:00+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/de.jpg', false, false, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000df', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-05-23 18:30+00', 'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/df.jpg', false, false, NULL, '{"classification":{"image_type":"other"}}');

INSERT INTO capture_privacy_promote_exclude(image_id, reason, granted_by)
VALUES ('00000000-0000-4000-8000-0000000000d9', 'privacy_backup_union', '00000000-0000-4000-8000-0000000000cc');
INSERT INTO capture_non_vehicle_log(run_id, image_id, user_id, granted_by, typ, verdict, day, signature) VALUES
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'judgment_personal', '2026-03-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000dd', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'non_vehicle', '2026-03-12', 't');
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, status)
VALUES ('00000000-0000-4000-8000-0000000000ee', '00000000-0000-4000-8000-0000000000aa', 'existing', ARRAY['00000000-0000-4000-8000-0000000000db'::uuid], 'no_clear_lead', 'open');

-- granted_by required
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_left_out_to_review_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', NULL, true, 50);
    RAISE EXCEPTION 'expected granted_by required';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF;
  END;
END $$;

-- cap bounds
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_left_out_to_review_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000cc', true, 0);
    RAISE EXCEPTION 'expected cap';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%cap must be between 1 and 50%' THEN RAISE; END IF;
  END;
END $$;

-- dry cap 3 packs only day A (2 photos), does not split day B
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 3) AS dry_pack \gset
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->>'dry_run')::boolean, 'dry flag');
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->>'eligible')::int = 6, '6 eligible originals');
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->>'would_route')::int = 2, 'cap 3 packs only day A');
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->>'days')::int = 1, 'one whole day under cap 3');
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->'items'->0->>'left_out_kind') = 'planned', 'day A is planned leftover');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_left_out_to_review_log) = 0, 'dry wrote no log');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'left_out') = 0, 'dry wrote no review');

-- dry cap 50 would take all 6 (A planned, B planned, C unadmitted)
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS dry_all \gset
SELECT pg_temp.assert_true((:'dry_all'::jsonb->>'would_route')::int = 6, 'cap 50 would_route 6');
SELECT pg_temp.assert_true((:'dry_all'::jsonb->>'days')::int = 3, 'three days');
SELECT pg_temp.assert_true((
  SELECT count(*) FILTER (WHERE i->>'left_out_kind' = 'unadmitted') = 2
     AND count(*) FILTER (WHERE i->>'left_out_kind' = 'planned') = 4
  FROM jsonb_array_elements((:'dry_all'::jsonb)->'items') i
), '4 planned and 2 unadmitted');

-- apply cap 3: only day A
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000cc', false, 3) AS apply1 \gset
SELECT pg_temp.assert_true((:'apply1'::jsonb->>'routed')::int = 2, 'applied 2');
SELECT pg_temp.assert_true((:'apply1'::jsonb->>'reviews')::int = 1, 'one review for day A');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_left_out_to_review_log WHERE reverted_at IS NULL) = 1, 'one log row per review');
SELECT pg_temp.assert_true((SELECT cardinality(image_ids) FROM capture_left_out_to_review_log WHERE run_id = '00000000-0000-4000-8000-0000000000f1') = 2, 'log image_ids has both day A photos');
SELECT pg_temp.assert_true((
  SELECT count(*) = 1 AND bool_and(status = 'open' AND confidence = 0 AND basis = 'left_out_to_review'
    AND evidence->>'left_out_kind' = 'planned'
    AND (evidence->>'chunk_id')::uuid = '00000000-0000-4000-8000-0000000000c1'
    AND evidence->>'chunk_state' = 'applied')
  FROM capture_set_review WHERE reason = 'left_out'
), 'review evidence and confidence 0');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 'did not re-arm');
SELECT pg_temp.assert_true((SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000c1') = 'applied', 'chunk state untouched');
SELECT pg_temp.assert_true((SELECT forward_cursor = '2026-11-03 10:00:00+00' AND halted IS FALSE FROM capture_landing_config WHERE user_id = '00000000-0000-4000-8000-0000000000aa'), 'forward cursor untouched');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE vehicle_id IS NOT NULL AND id IN (
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2')) = 0, 'did not file');

-- second apply cap 50 takes remaining 4 (days B planned and C unadmitted)
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS apply2 \gset
SELECT pg_temp.assert_true((:'apply2'::jsonb->>'routed')::int = 4, 'second apply routes remaining 4');
SELECT pg_temp.assert_true((:'apply2'::jsonb->>'reviews')::int = 2, 'two more reviews');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'left_out') = 3, 'three reviews total');
SELECT pg_temp.assert_true((
  SELECT bool_and(evidence->>'left_out_kind' = 'unadmitted' AND evidence->>'chunk_state' IS NULL)
  FROM capture_set_review
  WHERE reason = 'left_out' AND set_key LIKE 'left_out_review:2026-05-23:%'
), 'unadmitted review has no chunk_state');

-- idempotent
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS again \gset
SELECT pg_temp.assert_true((:'again'::jsonb->>'routed')::int = 0, 'third apply routes 0');

-- revert f1 deletes only the still-open f1 review
SELECT public.capture_left_out_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1') AS rev1 \gset
SELECT pg_temp.assert_true((:'rev1'::jsonb->>'reverted_log')::int = 1, 'reverted f1 log (one review)');
SELECT pg_temp.assert_true((:'rev1'::jsonb->>'deleted_open_reviews')::int = 1, 'deleted f1 review');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'left_out') = 2, 'f2 reviews remain');

-- resolve one f2 review; revert f2 leaves the resolved row
UPDATE capture_set_review SET status = 'resolved'
 WHERE run_id = '00000000-0000-4000-8000-0000000000f2'
   AND set_key LIKE 'left_out_review:2026-03-14:%';
SELECT public.capture_left_out_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2') AS rev2 \gset
SELECT pg_temp.assert_true((:'rev2'::jsonb->>'deleted_open_reviews')::int = 1, 'only still-open f2 review deleted');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'left_out' AND status = 'resolved') = 1, 'resolved review kept');

-- after revert, day A and day C are eligible again (B still in resolved review)
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS redry \gset
SELECT pg_temp.assert_true((:'redry'::jsonb->>'eligible')::int = 4, 'A and C eligible again (B still in resolved review)');

-- apply then refuse migration revert, then revert run and drop
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4',
  '00000000-0000-4000-8000-0000000000cc', false, 50);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.capture_left_out_to_review_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'expected unreverted rows';
  END IF;
  BEGIN
    -- inline the refuse check
    PERFORM 1;
  END;
END $$;
-- unreverted rows must block the migration revert
DO $$
BEGIN
  BEGIN
    -- simulate the revert script's refuse
    IF EXISTS (SELECT 1 FROM public.capture_left_out_to_review_log WHERE reverted_at IS NULL) THEN
      RAISE EXCEPTION 'capture_left_out_to_review: unreverted log rows; revert those runs first';
    END IF;
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%unreverted log rows%' THEN RAISE; END IF;
  END;
END $$;
SELECT public.capture_left_out_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4');
\i supabase/sql/revert_20261115235000_capture_left_out_to_review.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_left_out_to_review_v1(uuid,uuid,uuid,boolean,integer)') IS NULL, 'function dropped');
SELECT pg_temp.assert_true(to_regclass('public.capture_left_out_to_review_log') IS NULL, 'log table dropped');
