-- capture_refused_day_to_review_v1: unfiled photos of gate_failed days
-- go to held review. Never files, never re-arms, never touches the gate.
-- Dry-default, cap 50, granted_by, revert-by-run, confidence 0.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_refused_day_to_review%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_refused_day_to_review* database';
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

CREATE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date)
 RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'blocked', true,
    'reason', 'refused_no_new_evidence',
    'chunk', (SELECT id FROM capture_landing_chunks
              WHERE user_id = p_user
                AND (t_from AT TIME ZONE 'America/Los_Angeles')::date = p_day
              ORDER BY created_at DESC LIMIT 1));
$$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261115233000_capture_refused_day_to_review.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_refused_day_to_review_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'anon cannot route');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_refused_day_to_review_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'service_role can route');

-- chunks: A,B,C gate_failed; D applied (must not route)
INSERT INTO capture_landing_chunks(id, user_id, t_from, t_to, dry, state, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa',
  '2026-03-12 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2026-03-13 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  false, 'gate_failed', '2026-03-13 08:00+00'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa',
  '2026-03-14 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2026-03-15 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  false, 'gate_failed', '2026-03-15 08:00+00'),
 ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000aa',
  '2026-06-13 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2026-06-14 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  false, 'gate_failed', '2026-06-14 08:00+00'),
 ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000aa',
  '2026-07-01 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2026-07-02 00:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles',
  false, 'applied', '2026-07-02 08:00+00');

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, image_url, is_sensitive, is_duplicate, duplicate_of, ai_scan_metadata) VALUES
 -- day A: 2 eligible
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:00+00', 'https://example.invalid/a1', false, false, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:10+00', 'https://example.invalid/a2', false, false, NULL, '{}'),
 -- day B: 2 eligible
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-14 18:00+00', 'https://example.invalid/b1', false, false, NULL, '{"classification":{"image_type":"engine_bay"}}'),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-14 18:10+00', 'https://example.invalid/b2', false, false, NULL, '{"classification":{"image_type":"vehicle_interior"}}'),
 -- day C: 2 eligible (later batch under cap 3)
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-13 18:00+00', 'https://example.invalid/c1', false, false, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-13 18:10+00', 'https://example.invalid/c2', false, false, NULL, '{"classification":{"image_type":"part_closeup"}}'),
 -- skips
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:20+00', 'https://example.invalid/s1', true, false, NULL, '{}'), -- sensitive
 ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:21+00', NULL, false, false, NULL, '{}'), -- empty_url
 ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, 'https://example.invalid/s3', false, false, NULL, '{}'), -- no clock
 ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:22+00', 'https://example.invalid/s4', false, false, NULL, '{"classification":{"image_type":"other"}}'), -- judgment_personal
 ('00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:23+00', 'https://example.invalid/s5', false, false, NULL, '{}'), -- privacy exclude
 ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ff', '2026-03-12 18:24+00', 'https://example.invalid/s6', false, false, NULL, '{}'), -- filed
 ('00000000-0000-4000-8000-0000000000d7', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:25+00', 'https://example.invalid/s7', false, false, NULL, '{}'), -- already in open review
 ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:26+00', 'https://example.invalid/s8', false, true, '00000000-0000-4000-8000-0000000000a1', '{}'), -- dup of a1
 ('00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-07-01 18:00+00', 'https://example.invalid/s9', false, false, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'), -- applied day
 ('00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:27+00', 'https://example.invalid/sa', false, false, NULL, '{"classification":{"image_type":"other"}}'); -- non_vehicle log

INSERT INTO capture_privacy_promote_exclude(image_id, reason, granted_by)
VALUES ('00000000-0000-4000-8000-0000000000d5', 'privacy_backup_union', '00000000-0000-4000-8000-0000000000cc');
INSERT INTO capture_non_vehicle_log(run_id, image_id, user_id, granted_by, typ, verdict, day, signature) VALUES
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'judgment_personal', '2026-03-12', 't'),
 ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc', 'other', 'non_vehicle', '2026-03-12', 't');
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, status)
VALUES ('00000000-0000-4000-8000-0000000000ee', '00000000-0000-4000-8000-0000000000aa', 'existing', ARRAY['00000000-0000-4000-8000-0000000000d7'::uuid], 'no_clear_lead', 'open');

-- granted_by required
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_refused_day_to_review_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', NULL, true, 50);
    RAISE EXCEPTION 'expected granted_by required';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF;
  END;
END $$;

-- cap bounds
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_refused_day_to_review_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000cc', true, 0);
    RAISE EXCEPTION 'expected cap';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%cap must be between 1 and 50%' THEN RAISE; END IF;
  END;
END $$;

-- dry cap 3 packs only day A (2 photos), does not split day B
SELECT public.capture_refused_day_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 3) AS dry_pack \gset
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->>'dry_run')::boolean, 'dry flag');
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->>'eligible')::int = 6, '6 eligible originals');
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->>'would_route')::int = 2, 'cap 3 packs only day A');
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->>'days')::int = 1, 'one whole day under cap 3');
SELECT pg_temp.assert_true((:'dry_pack'::jsonb->'items'->0->>'refusal_reason') = 'refused_no_new_evidence', 'replan reason on dry items');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_refused_day_to_review_log) = 0, 'dry wrote no log');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'refused_day') = 0, 'dry wrote no review');

-- dry cap 50 would take all 6
SELECT public.capture_refused_day_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS dry_all \gset
SELECT pg_temp.assert_true((:'dry_all'::jsonb->>'would_route')::int = 6, 'cap 50 would_route 6');
SELECT pg_temp.assert_true((:'dry_all'::jsonb->>'days')::int = 3, 'three days');

-- apply cap 3: only day A
SELECT public.capture_refused_day_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000cc', false, 3) AS apply1 \gset
SELECT pg_temp.assert_true((:'apply1'::jsonb->>'routed')::int = 2, 'applied 2');
SELECT pg_temp.assert_true((:'apply1'::jsonb->>'reviews')::int = 1, 'one review for day A');
SELECT pg_temp.assert_true((
  SELECT count(*) = 1 AND bool_and(status = 'open' AND confidence = 0 AND basis = 'refused_day_to_review'
    AND evidence->>'refusal_reason' = 'refused_no_new_evidence'
    AND (evidence->>'chunk_id')::uuid = '00000000-0000-4000-8000-0000000000c1'
    AND evidence->>'chunk_state' = 'gate_failed')
  FROM capture_set_review WHERE reason = 'refused_day'
), 'review evidence and confidence 0');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 'did not re-arm');
SELECT pg_temp.assert_true((SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000c1') = 'gate_failed', 'chunk state untouched');
SELECT pg_temp.assert_true((SELECT forward_cursor = '2026-11-03 10:00:00+00' AND halted IS FALSE FROM capture_landing_config WHERE user_id = '00000000-0000-4000-8000-0000000000aa'), 'forward cursor untouched');

-- second apply cap 50 takes remaining 4 (days B and C)
SELECT public.capture_refused_day_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS apply2 \gset
SELECT pg_temp.assert_true((:'apply2'::jsonb->>'routed')::int = 4, 'second apply routes remaining 4');
SELECT pg_temp.assert_true((:'apply2'::jsonb->>'reviews')::int = 2, 'two more reviews');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'refused_day') = 3, 'three reviews total');

-- idempotent
SELECT public.capture_refused_day_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS again \gset
SELECT pg_temp.assert_true((:'again'::jsonb->>'routed')::int = 0, 'third apply routes 0');

-- revert f1 deletes only the still-open f1 review
SELECT public.capture_refused_day_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1') AS rev1 \gset
SELECT pg_temp.assert_true((:'rev1'::jsonb->>'reverted_log')::int = 2, 'reverted f1 log');
SELECT pg_temp.assert_true((:'rev1'::jsonb->>'deleted_open_reviews')::int = 1, 'deleted f1 review');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'refused_day') = 2, 'f2 reviews remain');

-- resolve one f2 review; revert f2 leaves the resolved row
UPDATE capture_set_review SET status = 'resolved'
 WHERE run_id = '00000000-0000-4000-8000-0000000000f2'
   AND set_key LIKE 'refused_day_review:2026-03-14:%';
SELECT public.capture_refused_day_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2') AS rev2 \gset
SELECT pg_temp.assert_true((:'rev2'::jsonb->>'deleted_open_reviews')::int = 1, 'only still-open f2 review deleted');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE reason = 'refused_day' AND status = 'resolved') = 1, 'resolved review kept');

-- after revert, day A and day C are eligible again
SELECT public.capture_refused_day_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS redry \gset
SELECT pg_temp.assert_true((:'redry'::jsonb->>'eligible')::int = 4, 'A and C eligible again (B still in resolved review)');

-- apply then refuse migration revert, then revert run and drop
SELECT public.capture_refused_day_to_review_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4',
  '00000000-0000-4000-8000-0000000000cc', false, 50);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.capture_refused_day_to_review_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'expected unreverted rows';
  END IF;
END $$;
SELECT public.capture_refused_day_to_review_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4');
\i supabase/sql/revert_20261115233000_capture_refused_day_to_review.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_refused_day_to_review_v1(uuid,uuid,uuid,boolean,integer)') IS NULL, 'function dropped');
SELECT pg_temp.assert_true(to_regclass('public.capture_refused_day_to_review_log') IS NULL, 'log table dropped');
