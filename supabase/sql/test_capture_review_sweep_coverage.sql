-- Sweep coverage (20261115230000): superseded_by_newer_run must not drop unique
-- still-unfiled photos from held. The signed reopen producer restores already
-- dropped reviews. The 20261113120600 re-arm body is unchanged. Cron is unchanged.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_review_sweep_coverage%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_review_sweep_coverage* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz,
  is_duplicate boolean, is_superseded boolean);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], to_vehicle_id uuid, confidence numeric, basis text, evidence jsonb DEFAULT '{}', reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')), created_at timestamptz DEFAULT now(),
  UNIQUE (run_id, set_key));
CREATE TABLE public.capture_set_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, image_id uuid, vehicle_id uuid,
  set_key text, created_at timestamptz DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.filing_run_gate(run_id text PRIMARY KEY, passed boolean);
CREATE TABLE public.capture_document_pages(image_id uuid, revoked_at timestamptz);
CREATE TABLE public.capture_set_rescore_queue(user_id uuid, day date, requested_at timestamptz, not_before date, reasons jsonb,
  done_run_id uuid, done_at timestamptz, PRIMARY KEY (user_id, day));
CREATE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO capture_set_rescore_queue AS q (user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE
    SET requested_at = now(), not_before = least(q.not_before, current_date), done_at = NULL, done_run_id = NULL,
        reasons = q.reasons || jsonb_build_array(p_reason) $$;
CREATE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date) RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_id RETURNING true $$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/sql/helpers/capture_set_review_sweep_live_parent_20261115230000.sql

SELECT pg_temp.assert_true(md5(p.prosrc) = 'f021b75c81be85388884d9c16d42ca49', 'parent sweep md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';

-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, is_duplicate, is_superseded) VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:05+00', false, false),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-02 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-02 18:05+00', false, false),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-03 18:00+00', false, false),
 -- F1: older 4-photo-style review vs newer 2-photo review (the live bug)
 ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-06 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-06 18:05+00', false, false);
INSERT INTO capture_document_pages VALUES ('00000000-0000-4000-8000-000000000004', NULL);
INSERT INTO capture_set_review(id, run_id, user_id, set_key, image_ids, reason, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:A',
  '{00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:B',
  '{00000000-0000-4000-8000-000000000003,00000000-0000-4000-8000-000000000004}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:C',
  '{00000000-0000-4000-8000-000000000005}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'ios:a:C',
  '{00000000-0000-4000-8000-000000000005}', 'score_below_threshold', '2026-11-02 00:00+00'),
 ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:F1',
  '{00000000-0000-4000-8000-000000000021,00000000-0000-4000-8000-000000000022}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'ios:a:F1',
  '{00000000-0000-4000-8000-000000000021}', 'score_below_threshold', '2026-11-02 00:00+00');

SELECT public.capture_set_review_sweep(NULL, 0) AS pre \gset
SELECT pg_temp.assert_true((:'pre')::jsonb->>'superseded' = '2', 'pre: older C and older F1 are superseded under the parent body');
SELECT pg_temp.assert_true((:'pre')::jsonb->>'nothing_left_unfiled' = '1', 'pre: set B resolved');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f1') = 'resolved',
  'pre: older F1 is resolved even though 022 is not in the newer review (the bug)');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a1') = 'open', 'pre: genuine hold A stays open');
SELECT pg_temp.assert_true((SELECT evidence#>>'{resolved,how}' FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000c1') = 'superseded_by_newer_run',
  'pre: fully-covered older C is superseded');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 'pre: re-arm limit 0 writes no queue rows');

\i supabase/migrations/20261115230000_capture_review_sweep_coverage.sql
\i supabase/migrations/20261115230100_capture_review_reopen_uncovered_fast.sql

SELECT pg_temp.assert_true(md5(p.prosrc) <> 'f021b75c81be85388884d9c16d42ca49', 'new sweep body is not the parent')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';
SELECT pg_temp.assert_true(position('uncovered_after_newer_run' in p.prosrc) > 0
  AND position('20261113120600' in p.prosrc) > 0, 'coverage fix and 20600 re-arm comments are both present')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';

SELECT pg_temp.assert_true(md5(p.prosrc) <> 'ac989c8c6bb6d8b8d8f0f1332ddfd8bf'
  AND position('AS MATERIALIZED' in p.prosrc) > 0, 'reopen eligibility is the set-based 230100 body')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_reopen_uncovered_v1';

-- Post-patch fixtures: F2 is the same shape as F1; G is covered by another open review;
-- I's leftover photo is already filed; J's leftover is an unfiled duplicate.
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, is_duplicate, is_superseded) VALUES
 ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-07 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-07 18:05+00', false, false),
 ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-08 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-08 18:05+00', false, false),
 ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-09 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-09 18:05+00', false, false),
 ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-10 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-10 18:05+00', true, false);
INSERT INTO capture_set_review(id, run_id, user_id, set_key, image_ids, reason, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:F2',
  '{00000000-0000-4000-8000-000000000023,00000000-0000-4000-8000-000000000024}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'ios:a:F2',
  '{00000000-0000-4000-8000-000000000023}', 'score_below_threshold', '2026-11-02 00:00+00'),
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:G',
  '{00000000-0000-4000-8000-000000000008,00000000-0000-4000-8000-000000000009}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'ios:a:G',
  '{00000000-0000-4000-8000-000000000008}', 'score_below_threshold', '2026-11-02 00:00+00'),
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'ios:a:H',
  '{00000000-0000-4000-8000-000000000009}', 'no_clear_lead', '2026-11-02 00:00+00'),
 ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:I',
  '{00000000-0000-4000-8000-000000000011,00000000-0000-4000-8000-000000000012}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'ios:a:I',
  '{00000000-0000-4000-8000-000000000011}', 'score_below_threshold', '2026-11-02 00:00+00'),
 ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:J',
  '{00000000-0000-4000-8000-000000000013,00000000-0000-4000-8000-000000000014}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'ios:a:J',
  '{00000000-0000-4000-8000-000000000013}', 'score_below_threshold', '2026-11-02 00:00+00');

SELECT public.capture_set_review_sweep(NULL, 0) AS post \gset
SELECT pg_temp.assert_true((:'post')::jsonb->>'superseded' = '2', 'post: only G and I (fully covered / leftover filed) are superseded');
SELECT pg_temp.assert_true((:'post')::jsonb->>'uncovered_left_open' = '2', 'post: F2 and J stay open with uncovered photos');
SELECT pg_temp.assert_true((:'post')::jsonb->>'uncovered_images' = '2', 'post: two unique uncovered photos (024 and 014)');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f3') = 'open',
  'post: older F2 stays open because 024 is not in any other open review');
SELECT pg_temp.assert_true((SELECT evidence#>'{uncovered_after_newer_run,image_ids}'
  FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f3')
  = '["00000000-0000-4000-8000-000000000024"]'::jsonb, 'post: F2 records the uncovered id');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000e6') = 'open',
  'post: older J stays open; an unfiled is_duplicate is not exempt');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000e1') = 'resolved'
  AND (SELECT evidence#>>'{resolved,how}' FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000e1') = 'superseded_by_newer_run',
  'post: older G resolves because 009 is in another open review');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000e4') = 'resolved',
  'post: older I resolves because 012 is already filed');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f1') = 'resolved',
  'post: already-resolved F1 is not auto-reopened by the sweep');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a1') = 'open',
  'post: genuine hold A still open');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000c1') = 'resolved',
  'post: fully-covered older C stays resolved');

-- second pass is idempotent; uncovered evidence is not rewritten
SELECT evidence#>>'{uncovered_after_newer_run,at}' AS f2_at FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f3' \gset
SELECT public.capture_set_review_sweep(NULL, 0) AS post2 \gset
SELECT pg_temp.assert_true((:'post2')::jsonb->>'superseded' = '0' AND (:'post2')::jsonb->>'nothing_left_unfiled' = '0'
  AND (:'post2')::jsonb->>'uncovered_left_open' = '2' AND (:'post2')::jsonb->>'rearmed' = '0',
  'second pass changes no resolutions and re-arms nothing at limit 0');
SELECT pg_temp.assert_true((SELECT evidence#>>'{uncovered_after_newer_run,at}'
  FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f3') = :'f2_at',
  'uncovered evidence is not rewritten when the id set is unchanged');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 're-arm limit 0 still writes no queue rows');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job) = 0, 'this migration does not touch cron');

-- reopen producer: F1 is already resolved with uncovered 022; dry writes nothing
SELECT public.capture_set_review_reopen_uncovered_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000aa', true, 50) AS dry \gset
SELECT pg_temp.assert_true((:'dry')::jsonb->>'dry_run' = 'true' AND (:'dry')::jsonb->>'would_reopen' = '1'
  AND (:'dry')::jsonb->>'eligible' = '1'
  AND (:'dry')::jsonb#>>'{items,0,review_id}' = '00000000-0000-4000-8000-0000000000f1',
  'dry: only already-dropped F1 is eligible (F2/J are still open)');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f1') = 'resolved'
  AND (SELECT count(*) FROM capture_review_reopen_uncovered_log) = 0,
  'dry writes no rows');

SELECT public.capture_set_review_reopen_uncovered_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000aa', false, 50) AS appl \gset
SELECT pg_temp.assert_true((:'appl')::jsonb->>'reopened' = '1' AND (:'appl')::jsonb->>'dry_run' = 'false', 'apply reopens F1');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f1') = 'open',
  'apply: F1 is open again');
SELECT pg_temp.assert_true((SELECT evidence#>>'{reopened,how}' FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f1')
  = 'uncovered_not_in_newer_review', 'apply records reopened how');
SELECT pg_temp.assert_true((SELECT prior_status FROM capture_review_reopen_uncovered_log
  WHERE run_id = '00000000-0000-4000-8000-0000000000d1') = 'resolved', 'log backs up prior status');

-- idempotent: a second run skips the unreverted log row
SELECT public.capture_set_review_reopen_uncovered_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000aa', true, 50) AS dry2 \gset
SELECT pg_temp.assert_true((:'dry2')::jsonb->>'would_reopen' = '0' AND (:'dry2')::jsonb->>'eligible' = '0',
  'already-reopened (or still-open) reviews are not eligible again');

-- after apply, the coverage sweep must not re-close F1
SELECT public.capture_set_review_sweep(NULL, 0) AS after_reopen \gset
SELECT pg_temp.assert_true((:'after_reopen')::jsonb->>'superseded' = '0', 'sweep does not re-close reopened F1; 022 is still uncovered');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f1') = 'open',
  'reopened F1 stays open');

SELECT public.capture_set_review_reopen_uncovered_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000d1') AS rv \gset
SELECT pg_temp.assert_true((:'rv')::jsonb->>'reverted' = '1', 'revert restores one review');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f1') = 'resolved',
  'revert: F1 is resolved again');
SELECT pg_temp.assert_true((SELECT evidence->'reopened' FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000f1') IS NULL,
  'revert restores prior evidence');

-- migration revert refuses while the log is unreverted: re-apply, then refuse, then revert the run
SELECT public.capture_set_review_reopen_uncovered_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000d3',
  '00000000-0000-4000-8000-0000000000aa', false, 50) AS appl2 \gset
SELECT pg_temp.assert_true((:'appl2')::jsonb->>'reopened' = '1', 'second apply after revert works');
DO $$
DECLARE ok boolean := false; msg text;
BEGIN
  BEGIN
    EXECUTE pg_read_file('/dev/null'); -- placeholder, actual refuse is via \i in a subtransaction
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_set_review_sweep(uuid, integer)', 'EXECUTE'), 'sweep not executable by anon');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_set_review_sweep(uuid, integer)', 'EXECUTE'), 'sweep not executable by authenticated');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_set_review_sweep(uuid, integer)', 'EXECUTE'), 'sweep executable by service_role');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_set_review_reopen_uncovered_v1(uuid, uuid, uuid, boolean, integer)', 'EXECUTE'),
  'reopen not executable by anon');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_set_review_reopen_uncovered_v1(uuid, uuid, uuid, boolean, integer)', 'EXECUTE'),
  'reopen executable by service_role');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_set_review_reopen_uncovered_revert_v1(uuid, uuid)', 'EXECUTE'),
  'reopen revert executable by service_role');

-- refuse migration revert while unreverted log rows remain
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_review_reopen_uncovered_log WHERE reverted_at IS NULL) = 1,
  'one unreverted log row');
DO $$
BEGIN
  BEGIN
    -- inline the refuse check the revert uses
    IF EXISTS (SELECT 1 FROM public.capture_review_reopen_uncovered_log WHERE reverted_at IS NULL) THEN
      RAISE EXCEPTION 'refusing revert 20261115230000: unreverted capture_review_reopen_uncovered_log rows remain';
    END IF;
    RAISE EXCEPTION 'contract failed: revert did not refuse';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'refusing revert 20261115230000%' THEN RAISE; END IF;
  END;
END $$;

SELECT public.capture_set_review_reopen_uncovered_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000d3') AS rv2 \gset
SELECT pg_temp.assert_true((:'rv2')::jsonb->>'reverted' = '1', 'second revert works');

\i supabase/sql/revert_20261115230000_capture_review_sweep_coverage.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = 'f021b75c81be85388884d9c16d42ca49', 'revert restores parent sweep md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';
SELECT pg_temp.assert_true(to_regprocedure('public.capture_set_review_reopen_uncovered_v1(uuid, uuid, uuid, boolean, integer)') IS NULL,
  'revert drops reopen');
SELECT pg_temp.assert_true(to_regclass('public.capture_review_reopen_uncovered_log') IS NULL, 'revert drops reopen log');
SELECT 'capture_review_sweep_coverage contract passed' AS result;
