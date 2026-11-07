-- capture_set_review drain: the sweep resolves superseded rows and rows with nothing left unfiled, re-arms days whose
-- newest open row predates the user's newest gate-passed filing (once, never a day already pending), leaves genuine
-- holds open, is service-role only and scheduled; the revert removes it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_review_drain%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_review_drain* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- Stand-ins for the live shapes the sweep reads and the queue writer it calls.
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz,
  is_duplicate boolean, is_superseded boolean);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], to_vehicle_id uuid, confidence numeric, basis text, evidence jsonb DEFAULT '{}', reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')), created_at timestamptz DEFAULT now(),
  UNIQUE (run_id, set_key));
CREATE TABLE public.capture_set_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, image_id uuid, vehicle_id uuid,
  created_at timestamptz DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.filing_run_gate(run_id text PRIMARY KEY, passed boolean);
CREATE TABLE public.capture_document_pages(image_id uuid, revoked_at timestamptz);
CREATE TABLE public.capture_set_rescore_queue(user_id uuid, day date, requested_at timestamptz, not_before date, reasons jsonb,
  done_run_id uuid, done_at timestamptz, PRIMARY KEY (user_id, day));
-- the live queue writer, as deployed (20261108140000)
CREATE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO capture_set_rescore_queue AS q (user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE
    SET requested_at = now(), not_before = least(q.not_before, current_date), done_at = NULL, done_run_id = NULL,
        reasons = q.reasons || jsonb_build_array(p_reason) $$;
-- pg_cron stand-in.
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_id RETURNING true $$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261111140000_capture_review_drain.sql

-- Fixture (synthetic, a disposable database): one user, five photo sets on four days.
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at) VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:00+00'),  -- set A: still unfiled
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-01 18:05+00'),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-02 18:00+00'), -- set B: filed since
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-02 18:05+00'),  -- set B: landed as a document page
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-03 18:00+00'),  -- set C: re-landed (two rows)
 ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-04 18:00+00'),  -- set D: scored after the last gate pass
 ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-05 18:00+00');  -- set E: already pending in the queue
INSERT INTO capture_set_links(run_id, image_id, vehicle_id, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b1', '2026-11-07 08:00+00');
INSERT INTO filing_run_gate VALUES ('00000000-0000-4000-8000-0000000000e1', true);
INSERT INTO capture_document_pages VALUES ('00000000-0000-4000-8000-000000000004', NULL);
INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, reason, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:A', '{00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:B', '{00000000-0000-4000-8000-000000000003,00000000-0000-4000-8000-000000000004}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:C', '{00000000-0000-4000-8000-000000000005}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'ios:a:C', '{00000000-0000-4000-8000-000000000005}', 'score_below_threshold', '2026-11-02 00:00+00'),
 ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000aa', 'ios:a:D', '{00000000-0000-4000-8000-000000000006}', 'no_clear_lead', '2026-11-07 09:00+00'),
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:E', '{00000000-0000-4000-8000-000000000007}', 'no_clear_lead', '2026-11-01 00:00+00');
INSERT INTO capture_set_rescore_queue(user_id, day, requested_at, not_before, reasons) VALUES
 ('00000000-0000-4000-8000-0000000000aa', '2026-03-05', now() - interval '1 hour', current_date, '[{"arrival": 1}]');

SELECT public.capture_set_review_sweep(NULL, 200) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'superseded' = '1', 'the older row of the re-landed set C is superseded');
SELECT pg_temp.assert_true((:'r')::jsonb->>'nothing_left_unfiled' = '1', 'set B (filed + document page) is resolved');
SELECT pg_temp.assert_true((:'r')::jsonb->>'rearmed' = '2', 'days A and C are re-armed; D (newer than the gate pass) and E (already pending) are not');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE set_key = 'ios:a:A') = 'open', 'a genuine hold stays open');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE set_key = 'ios:a:B') = 'resolved', 'set B resolved');
SELECT pg_temp.assert_true((SELECT evidence#>>'{resolved,how}' FROM capture_set_review WHERE set_key = 'ios:a:B') = 'nothing_left_unfiled', 'set B carries how');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE set_key = 'ios:a:C' AND run_id = '00000000-0000-4000-8000-0000000000c1') = 'resolved', 'older C resolved');
SELECT pg_temp.assert_true((SELECT evidence#>>'{resolved,how}' FROM capture_set_review WHERE set_key = 'ios:a:C' AND run_id = '00000000-0000-4000-8000-0000000000c1') = 'superseded_by_newer_run', 'older C carries how');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE set_key = 'ios:a:C' AND run_id = '00000000-0000-4000-8000-0000000000c2') = 'open', 'newer C stays open');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE set_key = 'ios:a:D') = 'open', 'D stays open');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue WHERE done_at IS NULL) = 3, 'queue holds A, C and the pre-existing E');
SELECT pg_temp.assert_true((SELECT reasons->-1 ? 'new_anchors' FROM capture_set_rescore_queue WHERE day = '2026-03-01') , 'day A re-armed with reason new_anchors');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(reasons) FROM capture_set_rescore_queue WHERE day = '2026-03-05') = 1, 'pending day E was not re-queued');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue WHERE day = '2026-03-04') = 0, 'day D (scored after the gate pass) not re-armed');
-- the limit holds and the oldest day goes first
DELETE FROM capture_set_rescore_queue WHERE day IN ('2026-03-01','2026-03-03');
SELECT public.capture_set_review_sweep(NULL, 1) AS r1 \gset
SELECT pg_temp.assert_true((:'r1')::jsonb->>'rearmed' = '1' AND (SELECT count(*) FROM capture_set_rescore_queue WHERE day = '2026-03-01') = 1, 'limit 1 re-arms the oldest day only');
-- a second full pass changes nothing more
SELECT public.capture_set_review_sweep(NULL, 200) AS r2 \gset
SELECT pg_temp.assert_true((:'r2')::jsonb->>'superseded' = '0' AND (:'r2')::jsonb->>'nothing_left_unfiled' = '0' AND (:'r2')::jsonb->>'rearmed' = '1', 'second pass: only day C left to re-arm');
-- the sweep never writes vehicle_images or capture_set_links
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_links) = 1 AND (SELECT count(*) FROM vehicle_images WHERE vehicle_id IS NOT NULL) = 1, 'no testimony written');
-- the backlog view
SELECT pg_temp.assert_true((SELECT open_rows = 4 AND open_sets = 4 AND unfiled_frames = 5 AND days = 4 AND oldest_day = '2026-03-01' AND reasons->>'no_clear_lead' = '3' AND reasons->>'score_below_threshold' = '1'
                            FROM v_capture_review_backlog WHERE user_id = '00000000-0000-4000-8000-0000000000aa'), 'backlog view counts what remains');
-- service-role only; scheduled
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_set_review_sweep(uuid, integer)', 'EXECUTE'), 'sweep not executable by anon');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_set_review_sweep(uuid, integer)', 'EXECUTE'), 'sweep not executable by authenticated');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_set_review_sweep(uuid, integer)', 'EXECUTE'), 'sweep executable by service_role');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon', 'public.v_capture_review_backlog', 'SELECT'), 'backlog view hidden from anon');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job WHERE jobname = 'capture-review-sweep' AND schedule = '17 * * * *') = 1, 'sweep scheduled hourly');
-- migration idempotent
\i supabase/migrations/20261111140000_capture_review_drain.sql
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job WHERE jobname = 'capture-review-sweep') = 1, 'migration re-run keeps one job');
-- revert
\i supabase/sql/revert_20261111140000_capture_review_drain.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_set_review_sweep(uuid, integer)') IS NULL, 'revert drops the sweep');
SELECT pg_temp.assert_true(to_regclass('public.v_capture_review_backlog') IS NULL, 'revert drops the view');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job WHERE jobname = 'capture-review-sweep') = 0, 'revert unschedules');
SELECT 'capture_review_drain contract passed' AS result;
