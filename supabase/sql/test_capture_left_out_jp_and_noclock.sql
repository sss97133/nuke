-- 20261116244000: classifier work / work_with_people overrides an
-- operator judgment_personal log (and typ=other for those frames),
-- and real no-clock files go to review by created-at day with
-- clock_missing, never writing taken_at.
-- Disposable DB only (dm_refinement_capture_left_out_jp%).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_left_out_jp%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_left_out_jp* database';
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
\i supabase/migrations/20261116244000_capture_left_out_jp_and_noclock.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_left_out_to_review_v1(uuid,uuid,uuid,boolean,integer,jsonb)', 'EXECUTE'), 'anon cannot route');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_left_out_to_review_v1(uuid,uuid,uuid,boolean,integer,jsonb)', 'EXECUTE'), 'service_role can route');

INSERT INTO capture_landing_chunks(id, user_id, t_from, t_to, dry, state, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa',
  '2026-02-10 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2026-02-11 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  false, 'applied', '2026-02-11 08:00+00');

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, created_at, image_url, is_sensitive, is_duplicate, duplicate_of, ai_scan_metadata) VALUES
 -- clocked typ=exterior leftover on an applied day: still eligible without a classifier
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-02-10 18:00+00', '2026-02-10 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/a1.jpg', false, false, NULL,
  '{"classification":{"image_type":"vehicle_exterior"}}'),
 -- typ=other jp, classifier work_with_people: eligible via override
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-02-10 18:10+00', '2026-02-10 18:15+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/j1.jpg', false, false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- typ=other jp, classifier work: eligible via override
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-02-10 18:20+00', '2026-02-10 18:25+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/j2.jpg', false, false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- typ=other jp, no classifier item: still skipped
 ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-02-10 18:30+00', '2026-02-10 18:35+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/j3.jpg', false, false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- typ=other jp, classifier category not work: still skipped
 ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-02-10 18:40+00', '2026-02-10 18:45+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/j4.jpg', false, false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- typ=other, no jp, no classifier: stays on #3302, skipped
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2026-02-10 18:50+00', '2026-02-10 18:55+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/t1.jpg', false, false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- no-clock real exterior, created 2026-06-11 LA
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL,
  NULL, '2026-06-11 16:00+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/n1.jpg', false, false, NULL,
  '{"classification":{"image_type":"vehicle_exterior"}}'),
 -- no-clock real typ-empty, created 2026-02-12 LA
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', NULL,
  NULL, '2026-02-12 20:00+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/n2.jpg', false, false, NULL,
  '{}'),
 -- no-clock placeholder skipped
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa', NULL,
  NULL, '2026-06-11 16:10+00',
  'https://example.com/n3.jpg', false, false, NULL, '{}'),
 -- no-clock empty_url skipped
 ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000aa', NULL,
  NULL, '2026-06-11 16:20+00',
  NULL, false, false, NULL, '{}'),
 -- no-clock sensitive skipped
 ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000aa', NULL,
  NULL, '2026-06-11 16:30+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/n5.jpg', true, false, NULL, '{}');

INSERT INTO capture_non_vehicle_log(run_id, image_id, user_id, granted_by, typ, verdict, day, signature) VALUES
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'judgment_personal', '2026-02-10', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'judgment_personal', '2026-02-10', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'judgment_personal', '2026-02-10', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'judgment_personal', '2026-02-10', 't');

-- 5-arg call still works (defaults). Dry, no classifier: only a1 eligible (j* skipped, no-clock n1/n2 eligible!)
-- n1 and n2 are no-clock real files, so eligible even without classifier.
-- Order: 2026-02-10 planned a1, 2026-02-12 no_clock n2, 2026-06-11 no_clock n1.
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS dry_base \gset
SELECT pg_temp.assert_true((:'dry_base'::jsonb->>'dry_run')::boolean, '5-arg dry flag');
SELECT pg_temp.assert_true((:'dry_base'::jsonb->>'eligible')::int = 3, 'base eligible is a1+n1+n2');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_left_out_to_review_log) = 0, 'dry wrote no log');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE taken_at IS NOT NULL AND id IN (
  '00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2')) = 0, 'dry did not invent taken_at');

-- Classifier items: j1 work_with_people, j2 work, j4 sensitive (ignored).
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 50,
  '[{"image_id":"00000000-0000-4000-8000-0000000000b1","category":"work_with_people","reason":"people_no_redaction"},
    {"image_id":"00000000-0000-4000-8000-0000000000b2","category":"work","reason":"vehicle"},
    {"image_id":"00000000-0000-4000-8000-0000000000b4","category":"sensitive","reason":"document"}]'::jsonb
) AS dry_cls \gset
SELECT pg_temp.assert_true((:'dry_cls'::jsonb->>'eligible')::int = 5, 'a1+j1+j2+n1+n2 eligible');
SELECT pg_temp.assert_true((:'dry_cls'::jsonb->>'would_route')::int = 5, 'would_route 5');
SELECT pg_temp.assert_true((
  SELECT count(*) FILTER (WHERE (i->>'classifier_overrides_jp')::boolean) = 2
     AND count(*) FILTER (WHERE (i->>'clock_missing')::boolean) = 2
     AND count(*) FILTER (WHERE i->>'left_out_kind' = 'planned') = 3
     AND count(*) FILTER (WHERE i->>'left_out_kind' = 'no_clock') = 2
  FROM jsonb_array_elements((:'dry_cls'::jsonb)->'items') i
), 'two jp overrides, two no-clock, three planned');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_left_out_classifier_override_log) = 0, 'dry wrote no classifier log');

-- Invalid classifier payload refused
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_left_out_to_review_v1(
      '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
      '00000000-0000-4000-8000-0000000000cc', true, 50, '{"nope":true}'::jsonb);
    RAISE EXCEPTION 'expected classifier_items array';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%classifier_items must be a JSON array%' THEN RAISE; END IF;
  END;
END $$;

-- Signed cap 50 routes all five. taken_at on no-clock rows stays null.
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000cc', false, 50,
  '[{"image_id":"00000000-0000-4000-8000-0000000000b1","category":"work_with_people","reason":"people_no_redaction"},
    {"image_id":"00000000-0000-4000-8000-0000000000b2","category":"work","reason":"vehicle"},
    {"image_id":"00000000-0000-4000-8000-0000000000b4","category":"sensitive","reason":"document"}]'::jsonb
) AS apply1 \gset
SELECT pg_temp.assert_true((:'apply1'::jsonb->>'routed')::int = 5, 'applied 5');
SELECT pg_temp.assert_true((:'apply1'::jsonb->>'reviews')::int = 3, 'one review per day/kind (planned + two no_clock days)');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_left_out_to_review_log WHERE reverted_at IS NULL) = 3, 'three log rows');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_left_out_classifier_override_log WHERE reverted_at IS NULL) = 2, 'two signed classifier overrides');
SELECT pg_temp.assert_true((
  SELECT bool_and(status = 'open' AND confidence = 0)
     AND bool_or(evidence->>'classifier_overrides_jp' = 'true'
                 AND evidence->>'left_out_kind' = 'planned'
                 AND evidence->>'clock_missing' = 'false')
     AND bool_or(evidence->>'clock_missing' = 'true'
                 AND evidence->>'left_out_kind' = 'no_clock'
                 AND (evidence->>'day') = '2026-06-11')
     AND bool_or(evidence->>'clock_missing' = 'true'
                 AND (evidence->>'day') = '2026-02-12')
  FROM capture_set_review WHERE reason = 'left_out'
), 'reviews carry override and clock_missing evidence');
SELECT pg_temp.assert_true((
  SELECT taken_at IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'
) AND (
  SELECT taken_at IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e2'
), 'signed run never wrote taken_at');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 'did not re-arm');
SELECT pg_temp.assert_true((SELECT forward_cursor = '2026-11-03 10:00:00+00' AND halted IS FALSE FROM capture_landing_config), 'cursor untouched');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE vehicle_id IS NOT NULL) = 0, 'did not file');
SELECT pg_temp.assert_true((
  SELECT count(*) = 0 FROM capture_set_review r
  WHERE reason = 'left_out' AND '00000000-0000-4000-8000-0000000000b3' = ANY (r.image_ids)
) AND (
  SELECT count(*) = 0 FROM capture_set_review r
  WHERE reason = 'left_out' AND '00000000-0000-4000-8000-0000000000b4' = ANY (r.image_ids)
) AND (
  SELECT count(*) = 0 FROM capture_set_review r
  WHERE reason = 'left_out' AND '00000000-0000-4000-8000-0000000000d1' = ANY (r.image_ids)
), 'j3, j4, and typ=other without override stayed out');

-- idempotent
SELECT public.capture_left_out_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000cc', false, 50,
  '[{"image_id":"00000000-0000-4000-8000-0000000000b1","category":"work_with_people","reason":"people_no_redaction"},
    {"image_id":"00000000-0000-4000-8000-0000000000b2","category":"work","reason":"vehicle"}]'::jsonb
) AS again \gset
SELECT pg_temp.assert_true((:'again'::jsonb->>'routed')::int = 0, 'second apply routes 0');

-- migration revert refuses while unreverted
DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.capture_left_out_to_review_log WHERE reverted_at IS NULL) THEN
      RAISE EXCEPTION 'capture_left_out_jp_and_noclock: unreverted left-out log rows; revert those runs first';
    END IF;
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%unreverted left-out log rows%' THEN RAISE; END IF;
  END;
END $$;

-- revert restores photos unchanged (taken_at still null, not filed)
SELECT public.capture_left_out_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1') AS rev1 \gset
SELECT pg_temp.assert_true((:'rev1'::jsonb->>'reverted_log')::int = 3, 'reverted three log rows');
SELECT pg_temp.assert_true((:'rev1'::jsonb->>'deleted_open_reviews')::int = 3, 'deleted three reviews');
SELECT pg_temp.assert_true((:'rev1'::jsonb->>'reverted_classifier_overrides')::int = 2, 'reverted two classifier rows');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'left_out') = 0, 'no left_out reviews remain');
SELECT pg_temp.assert_true((
  SELECT taken_at IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'
), 'revert did not write taken_at');

\i supabase/sql/revert_20261116244000_capture_left_out_jp_and_noclock.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_left_out_to_review_v1(uuid,uuid,uuid,boolean,integer,jsonb)') IS NULL, '6-arg function dropped');
SELECT pg_temp.assert_true(to_regprocedure('public.capture_left_out_to_review_v1(uuid,uuid,uuid,boolean,integer)') IS NOT NULL, '5-arg parent restored');
SELECT pg_temp.assert_true(to_regclass('public.capture_left_out_classifier_override_log') IS NULL, 'classifier log dropped');
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'capture_left_out_to_review_log' AND column_name = 'clock_missing'
  ), 'clock_missing column dropped');
