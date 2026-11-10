-- capture_non_vehicle_vehicle_to_review_v1: typ=other / receipt_document
-- frames already judged vehicle by #3302 go to held review, not limbo.
-- Dry-default, cap 50, revert-by-run, granted_by required.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_non_vehicle_vehicle_to_review%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_non_vehicle_vehicle_to_review* database';
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
  ai_scan_metadata jsonb, is_duplicate boolean DEFAULT false, duplicate_of uuid);
CREATE TABLE public.capture_set_review(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], confidence numeric NOT NULL DEFAULT 0, basis text, evidence jsonb DEFAULT '{}'::jsonb,
  reason text, status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now(),
  UNIQUE (run_id, set_key));
CREATE TABLE public.capture_privacy_promote_exclude(image_id uuid PRIMARY KEY, reason text, granted_by uuid);
CREATE TABLE public.capture_non_vehicle_log(
  run_id uuid NOT NULL, image_id uuid NOT NULL, user_id uuid, granted_by uuid,
  typ text, verdict text NOT NULL, reason text, day date, signature text,
  applied_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz,
  UNIQUE (run_id, image_id));
CREATE TABLE public.capture_set_links(image_id uuid, reverted_at timestamptz);
CREATE TABLE public.capture_document_pages(image_id uuid, revoked_at timestamptz);

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261115231000_capture_non_vehicle_vehicle_to_review.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_non_vehicle_vehicle_to_review_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'anon cannot route');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_non_vehicle_vehicle_to_review_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'service_role can route');

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, image_url, ai_scan_metadata) VALUES
 -- same-day typ=other, already judged vehicle
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:00+00', 'https://example.invalid/a1', '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:01+00', 'https://example.invalid/a2', '{"classification":{"image_type":"receipt_document"}}'),
 -- other day typ=other, judged vehicle
 ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-13 18:00+00', 'https://example.invalid/a3', '{"classification":{"image_type":"other"}}'),
 -- typ=other but judgment_personal — skip
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:02+00', 'https://example.invalid/b1', '{"classification":{"image_type":"other"}}'),
 -- typ=other already non_vehicle — skip
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:03+00', 'https://example.invalid/b2', '{"classification":{"image_type":"other"}}'),
 -- typ=vehicle_exterior judged vehicle — skip (not typ other)
 ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:04+00', 'https://example.invalid/b3', '{"classification":{"image_type":"vehicle_exterior"}}'),
 -- empty_url typ=other judged vehicle — skip
 ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:05+00', NULL, '{"classification":{"image_type":"other"}}'),
 -- privacy exclude typ=other judged vehicle — skip
 ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:06+00', 'https://example.invalid/b5', '{"classification":{"image_type":"other"}}'),
 -- already filed typ=other judged vehicle — skip
 ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ff', '2026-06-12 18:07+00', 'https://example.invalid/b6', '{"classification":{"image_type":"other"}}'),
 -- already in an open review — skip
 ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:08+00', 'https://example.invalid/b7', '{"classification":{"image_type":"other"}}'),
 -- typ=other, no #3302 log — skip
 ('00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-12 18:09+00', 'https://example.invalid/b8', '{"classification":{"image_type":"other"}}');

INSERT INTO capture_privacy_promote_exclude(image_id, reason, granted_by)
VALUES ('00000000-0000-4000-8000-0000000000b5', 'privacy_backup_union', '00000000-0000-4000-8000-0000000000cc');

INSERT INTO capture_non_vehicle_log(run_id, image_id, user_id, granted_by, typ, verdict, day, signature) VALUES
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'vehicle', '2026-06-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'receipt_document', 'vehicle', '2026-06-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'vehicle', '2026-06-13', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'judgment_personal', '2026-06-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'non_vehicle', '2026-06-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'vehicle_exterior', 'vehicle', '2026-06-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'vehicle', '2026-06-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'vehicle', '2026-06-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'vehicle', '2026-06-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'vehicle', '2026-06-12', 't');

INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, status)
VALUES ('00000000-0000-4000-8000-0000000000ee', '00000000-0000-4000-8000-0000000000aa', 'existing', ARRAY['00000000-0000-4000-8000-0000000000b7'::uuid], 'no_clear_lead', 'open');

-- granted_by required
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_non_vehicle_vehicle_to_review_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', NULL, true, 50);
    RAISE EXCEPTION 'expected granted_by required';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF;
  END;
END $$;

-- cap bounds
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_non_vehicle_vehicle_to_review_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000cc', true, 0);
    RAISE EXCEPTION 'expected cap';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%cap must be between 1 and 50%' THEN RAISE; END IF;
  END;
END $$;

-- dry does not write
SELECT public.capture_non_vehicle_vehicle_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS dry_out \gset
SELECT pg_temp.assert_true((:'dry_out'::jsonb->>'dry_run')::boolean, 'dry flag');
SELECT pg_temp.assert_true((:'dry_out'::jsonb->>'eligible')::int = 3, 'dry eligible is the 3 vehicle typ-other frames');
SELECT pg_temp.assert_true((:'dry_out'::jsonb->>'would_route')::int = 3, 'dry would_route 3');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_non_vehicle_vehicle_to_review_log) = 0, 'dry wrote no log');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'typ_other_vehicle') = 0, 'dry wrote no review');

-- apply
SELECT public.capture_non_vehicle_vehicle_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS apply_out \gset
SELECT pg_temp.assert_true(NOT (:'apply_out'::jsonb->>'dry_run')::boolean, 'apply flag');
SELECT pg_temp.assert_true((:'apply_out'::jsonb->>'routed')::int = 3, 'applied 3');
SELECT pg_temp.assert_true((:'apply_out'::jsonb->>'reviews')::int = 2, 'one review per day');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_non_vehicle_vehicle_to_review_log WHERE reverted_at IS NULL) = 3, '3 log rows');
SELECT pg_temp.assert_true((
  SELECT count(*) = 2 AND bool_and(status = 'open' AND basis = 'non_vehicle_review_vehicle' AND confidence = 0)
  FROM capture_set_review WHERE reason = 'typ_other_vehicle'
), 'two open typ_other_vehicle reviews');
SELECT pg_temp.assert_true((
  SELECT cardinality(image_ids) FROM capture_set_review
  WHERE set_key = 'nv_vehicle_review:2026-06-12'
) = 2, '2026-06-12 review has a1 and a2');
SELECT pg_temp.assert_true((
  SELECT image_ids = ARRAY['00000000-0000-4000-8000-0000000000a3'::uuid]
  FROM capture_set_review WHERE set_key = 'nv_vehicle_review:2026-06-13'
), '2026-06-13 review has a3');

-- idempotent
SELECT public.capture_non_vehicle_vehicle_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS again_out \gset
SELECT pg_temp.assert_true((:'again_out'::jsonb->>'routed')::int = 0, 'second apply routes 0');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'typ_other_vehicle') = 2, 'no extra reviews');

-- revert deletes open reviews
SELECT public.capture_non_vehicle_vehicle_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1') AS rev_out \gset
SELECT pg_temp.assert_true((:'rev_out'::jsonb->>'reverted_log')::int = 3, 'reverted 3 log rows');
SELECT pg_temp.assert_true((:'rev_out'::jsonb->>'deleted_open_reviews')::int = 2, 'deleted 2 open reviews');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'typ_other_vehicle') = 0, 'reviews gone');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_non_vehicle_vehicle_to_review_log WHERE reverted_at IS NULL) = 0, 'no live log');

-- eligible again after revert
SELECT public.capture_non_vehicle_vehicle_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS redry \gset
SELECT pg_temp.assert_true((:'redry'::jsonb->>'eligible')::int = 3, 'eligible again after revert');

-- apply again, resolve one review, revert leaves the resolved row
SELECT public.capture_non_vehicle_vehicle_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000cc', false, 50);
UPDATE capture_set_review SET status = 'resolved' WHERE set_key = 'nv_vehicle_review:2026-06-13';
SELECT public.capture_non_vehicle_vehicle_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f3') AS rev2 \gset
SELECT pg_temp.assert_true((:'rev2'::jsonb->>'deleted_open_reviews')::int = 1, 'only the still-open review is deleted');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE set_key = 'nv_vehicle_review:2026-06-13' AND status = 'resolved') = 1, 'resolved review kept');

-- migration revert refuses while unreverted — none live now, but re-apply then refuse
SELECT public.capture_non_vehicle_vehicle_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4',
  '00000000-0000-4000-8000-0000000000cc', false, 50);
DO $$
BEGIN
  BEGIN
    EXECUTE pg_read_file('supabase/sql/revert_20261115231000_capture_non_vehicle_vehicle_to_review.sql');
    -- \i is not available here; run the refuse check inline
    RAISE EXCEPTION 'unexpected fallthrough';
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;
-- explicit refuse check
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.capture_non_vehicle_vehicle_to_review_log WHERE reverted_at IS NULL;
  IF n = 0 THEN RAISE EXCEPTION 'expected unreverted rows before refuse check'; END IF;
END $$;
SELECT public.capture_non_vehicle_vehicle_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4');
-- resolved leftover review from f3 is unrelated; drop via migration revert after live logs are clear
\i supabase/sql/revert_20261115231000_capture_non_vehicle_vehicle_to_review.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_non_vehicle_vehicle_to_review_v1(uuid,uuid,uuid,boolean,integer)') IS NULL, 'function dropped');
SELECT pg_temp.assert_true(to_regclass('public.capture_non_vehicle_vehicle_to_review_log') IS NULL, 'log table dropped');
