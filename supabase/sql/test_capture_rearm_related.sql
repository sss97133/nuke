-- Related re-arm (20261113120100): a gate-passed filing re-arms only days related to it (a proposed vehicle, the same
-- capture session, or the same capture day), never every day whose open rows propose no vehicle.
-- Requires empty disposable dm_refinement_capture_rearm_related* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_rearm_related%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  is_duplicate boolean, is_superseded boolean);
CREATE TABLE public.capture_set_review (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text, image_ids uuid[],
  from_vehicle_id uuid, to_vehicle_id uuid, confidence numeric, basis text, evidence jsonb, reason text, status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_set_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, set_key text, image_id uuid, vehicle_id uuid,
  created_at timestamptz DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.filing_run_gate (run_id text PRIMARY KEY, passed boolean);
CREATE TABLE public.capture_document_pages (image_id uuid, revoked_at timestamptz);
CREATE TABLE public.capture_set_rescore_queue (user_id uuid, day date, requested_at timestamptz, not_before date, reasons jsonb,
  done_run_id uuid, done_at timestamptz, PRIMARY KEY (user_id, day));
CREATE TABLE public.capture_landing_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), track text DEFAULT 'manual', pass int DEFAULT 1, user_id uuid,
  t_from timestamptz, t_to timestamptz, state text, run_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION public.capture_sets_arm_new_photos() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
-- stand-in landing run: records one new awaiting_gate chunk for the window, as the live run does after planning
CREATE FUNCTION public.capture_sets_landing_run(p_user uuid, p_from timestamptz, p_to timestamptz, p_run uuid, p_dry boolean) RETURNS jsonb
LANGUAGE sql AS $$ INSERT INTO capture_landing_chunks(user_id, t_from, t_to, state, run_id) VALUES (p_user, p_from, p_to, 'awaiting_gate', p_run);
  SELECT jsonb_build_object('sets_scored', 1) $$;

-- the live bodies read 2026-11-09, verbatim
CREATE OR REPLACE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  INSERT INTO capture_set_rescore_queue AS q (user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE
    SET requested_at = now(), not_before = least(q.not_before, current_date), done_at = NULL, done_run_id = NULL,
        reasons = (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT x FROM jsonb_array_elements(q.reasons || jsonb_build_array(p_reason)) x
                   OFFSET greatest(0, jsonb_array_length(q.reasons) + 1 - 20)) t)
$function$;

CREATE OR REPLACE FUNCTION public.capture_set_review_sweep(p_user uuid DEFAULT NULL::uuid, p_rearm_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n_sup integer := 0; n_done integer := 0; n_arm integer := 0; rec record;
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  -- 1. superseded: a newer row for the same set exists (the day was re-landed)
  WITH sup AS (
    SELECT r.id FROM capture_set_review r
    WHERE r.status = 'open' AND (p_user IS NULL OR r.user_id = p_user)
      AND EXISTS (SELECT 1 FROM capture_set_review n WHERE n.user_id = r.user_id AND n.set_key = r.set_key AND n.created_at > r.created_at)
  ), u AS (
    UPDATE capture_set_review r SET status = 'resolved',
      evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object('resolved',
        jsonb_build_object('how', 'superseded_by_newer_run', 'by', 'capture_set_review_sweep', 'at', now()))
    FROM sup WHERE r.id = sup.id RETURNING 1)
  SELECT count(*) INTO n_sup FROM u;
  -- 2. nothing left unfiled: every photo of the set is filed, duplicate/superseded, or landed as a document page
  WITH done AS (
    SELECT r.id FROM capture_set_review r
    WHERE r.status = 'open' AND (p_user IS NULL OR r.user_id = p_user)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(r.image_ids) i JOIN vehicle_images v ON v.id = i
        WHERE v.vehicle_id IS NULL AND NOT coalesce(v.is_duplicate, false) AND NOT coalesce(v.is_superseded, false)
          AND NOT EXISTS (SELECT 1 FROM capture_set_links l WHERE l.image_id = i AND l.reverted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM capture_document_pages dp WHERE dp.image_id = i AND dp.revoked_at IS NULL))
  ), u AS (
    UPDATE capture_set_review r SET status = 'resolved',
      evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object('resolved',
        jsonb_build_object('how', 'nothing_left_unfiled', 'by', 'capture_set_review_sweep', 'at', now()))
    FROM done WHERE r.id = done.id RETURNING 1)
  SELECT count(*) INTO n_done FROM u;
  -- 3. re-arm: days whose newest open row predates the user's newest gate-passed filing (new visual anchors)
  FOR rec IN
    WITH anchors AS (
      SELECT vi.user_id, max(l.created_at) last_link
      FROM capture_set_links l JOIN filing_run_gate fg ON fg.run_id = l.run_id::text AND fg.passed
      JOIN vehicle_images vi ON vi.id = l.image_id
      WHERE l.reverted_at IS NULL AND (p_user IS NULL OR vi.user_id = p_user)
      GROUP BY vi.user_id
    ), days AS (
      SELECT r.user_id,
             (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) d,
             max(r.created_at) newest_row
      FROM capture_set_review r JOIN anchors a ON a.user_id = r.user_id
      WHERE r.status = 'open'
      GROUP BY r.user_id, r.image_ids
    )
    SELECT d.user_id, d.d
    FROM days d JOIN anchors a ON a.user_id = d.user_id
    WHERE d.d IS NOT NULL
    GROUP BY d.user_id, d.d, a.last_link
    HAVING max(d.newest_row) < a.last_link
       AND NOT EXISTS (SELECT 1 FROM capture_set_rescore_queue q WHERE q.user_id = d.user_id AND q.day = d.d AND q.done_at IS NULL)
    ORDER BY d.d
    LIMIT greatest(0, p_rearm_limit)
  LOOP
    PERFORM capture_sets_enqueue(rec.user_id, rec.d, jsonb_build_object('new_anchors', now()));
    n_arm := n_arm + 1;
  END LOOP;
  RETURN jsonb_build_object('superseded', n_sup, 'nothing_left_unfiled', n_done, 'rearmed', n_arm, 'at', now());
END $function$;

CREATE OR REPLACE FUNCTION public.capture_sets_drain(p_max integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q record; v_run uuid; v_res jsonb; v_out jsonb := '[]'; v_armed integer;
BEGIN
  v_armed := capture_sets_arm_new_photos();
  FOR q IN SELECT * FROM capture_set_rescore_queue
           WHERE done_at IS NULL AND not_before <= current_date AND requested_at < now() - interval '10 minutes'
           ORDER BY requested_at LIMIT greatest(1, least(p_max, 5)) FOR UPDATE SKIP LOCKED LOOP
    v_run := gen_random_uuid();
    BEGIN
      v_res := capture_sets_landing_run(q.user_id, (q.day::timestamp AT TIME ZONE 'America/Los_Angeles'),
                                        ((q.day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'), v_run, false);
      UPDATE capture_set_rescore_queue SET done_run_id = v_run, done_at = now()
       WHERE user_id = q.user_id AND day = q.day AND requested_at = q.requested_at;
      v_out := v_out || jsonb_build_object('day', q.day, 'run_id', v_run, 'sets', v_res->'sets_scored',
                 'filed', v_res#>'{apply,photos_filed}', 'review_sets', v_res->'review_sets');
    EXCEPTION WHEN OTHERS THEN
      UPDATE capture_set_rescore_queue SET not_before = current_date + 1,
             reasons = reasons || jsonb_build_array(jsonb_build_object('error', left(SQLERRM, 200), 'at', now()))
       WHERE user_id = q.user_id AND day = q.day;
      v_out := v_out || jsonb_build_object('day', q.day, 'error', left(SQLERRM, 200));
    END;
  END LOOP;
  RETURN jsonb_build_object('armed_days', v_armed, 'runs', v_out);
END $function$;

SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_set_review_sweep(uuid, integer)'::regprocedure)) = '98acf91af0045795437226d6e9a8872f'
  AND md5(pg_get_functiondef('public.capture_sets_drain(integer)'::regprocedure)) = 'fe4310724f82af8181e84ad3ec1039a7', 'stand-ins match the live fingerprints the migration pins');


\i supabase/migrations/20261113120001_capture_replan_backoff.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_set_review_sweep(uuid, integer)'::regprocedure)) = '4220544e9d0951cb074fc7f24a51459b'
  AND md5(pg_get_functiondef('public.capture_day_replan_state(uuid, date)'::regprocedure)) = '48f434a988614531f5c29ada12cf4e18', '20261113120000 bodies match the live fingerprints 20261113120100 pins');

-- fixtures: owner U. 10-20 open row proposes NO vehicle (set s20); 10-25 proposes V2 (last plan applied); 10-27 proposes
-- nothing and its last plan was refused (set s27).
CREATE FUNCTION pg_temp.day_from(d date) RETURNS timestamptz LANGUAGE sql AS $$ SELECT d::timestamp AT TIME ZONE 'America/Los_Angeles' $$;
CREATE FUNCTION pg_temp.fixtures() RETURNS void LANGUAGE sql AS $$
  TRUNCATE vehicle_images, capture_set_review, capture_set_links, filing_run_gate, capture_set_rescore_queue, capture_landing_chunks;
  INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, created_at) VALUES
    ('00000000-0000-4000-8000-000000000a20', '00000000-0000-4000-8000-0000000000aa', NULL, pg_temp.day_from('2026-10-20') + interval '9 hours', now() - interval '20 days'),
    ('00000000-0000-4000-8000-000000000c25', '00000000-0000-4000-8000-0000000000aa', NULL, pg_temp.day_from('2026-10-25') + interval '9 hours', now() - interval '20 days'),
    ('00000000-0000-4000-8000-000000000a27', '00000000-0000-4000-8000-0000000000aa', NULL, pg_temp.day_from('2026-10-27') + interval '9 hours', now() - interval '20 days');
  INSERT INTO capture_set_review(user_id, set_key, image_ids, to_vehicle_id, status, created_at) VALUES
    ('00000000-0000-4000-8000-0000000000aa', 's20', ARRAY['00000000-0000-4000-8000-000000000a20'::uuid], NULL, 'open', now() - interval '3 hours'),
    ('00000000-0000-4000-8000-0000000000aa', 's25', ARRAY['00000000-0000-4000-8000-000000000c25'::uuid], '00000000-0000-4000-8000-0000000000f2', 'open', now() - interval '3 hours'),
    ('00000000-0000-4000-8000-0000000000aa', 's27', ARRAY['00000000-0000-4000-8000-000000000a27'::uuid], NULL, 'open', now() - interval '3 hours');
  INSERT INTO capture_landing_chunks(user_id, t_from, t_to, state, created_at, updated_at) VALUES
    ('00000000-0000-4000-8000-0000000000aa', pg_temp.day_from('2026-10-20'), pg_temp.day_from('2026-10-21'), 'applied', now() - interval '3 hours', now() - interval '3 hours'),
    ('00000000-0000-4000-8000-0000000000aa', pg_temp.day_from('2026-10-25'), pg_temp.day_from('2026-10-26'), 'applied', now() - interval '3 hours', now() - interval '3 hours'),
    ('00000000-0000-4000-8000-0000000000aa', pg_temp.day_from('2026-10-27'), pg_temp.day_from('2026-10-28'), 'gate_failed', now() - interval '3 hours', now() - interval '2 hours');
  INSERT INTO filing_run_gate VALUES ('00000000-0000-4000-8000-00000000e001', true);
$$;
-- a gate-passed filing of photo img (taken at ts) onto veh, linked under set_key sk
CREATE FUNCTION pg_temp.file(img text, veh text, ts timestamptz, sk text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at) VALUES (img::uuid, '00000000-0000-4000-8000-0000000000aa', veh::uuid, ts);
  INSERT INTO capture_set_links(run_id, set_key, image_id, vehicle_id) VALUES ('00000000-0000-4000-8000-00000000e001', sk, img::uuid, veh::uuid) $$;
CREATE FUNCTION pg_temp.queued() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(day::text, ',' ORDER BY day), '') FROM capture_set_rescore_queue WHERE done_at IS NULL $$;
CREATE FUNCTION pg_temp.st(d date) RETURNS text LANGUAGE sql AS $$
  SELECT public.capture_day_replan_state('00000000-0000-4000-8000-0000000000aa', d)->>'reason' $$;

-- before (20261113120000): one unrelated filing (Firebird-style, a photo of today onto V9) re-arms the no-vehicle day 10-20
-- and counts as new evidence for the refused no-vehicle day 10-27
SELECT pg_temp.fixtures();
SELECT pg_temp.file('00000000-0000-4000-8000-000000000f99', '00000000-0000-4000-8000-0000000000f9', now(), 'ios:other');
SELECT pg_temp.assert_true(pg_temp.st('2026-10-27') = 'new_evidence_since_refusal', 'before: an unrelated filing unblocks a refused no-vehicle day');
SELECT public.capture_set_review_sweep(NULL, 200);
SELECT pg_temp.assert_true(pg_temp.queued() = '2026-10-20,2026-10-27', 'before: an unrelated filing re-arms every no-vehicle day (the leak)');

\i supabase/migrations/20261113120100_capture_rearm_related.sql
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_day_replan_state(uuid, date)', 'EXECUTE'), 'helper still not callable by anon');

-- after: the same unrelated filing re-arms nothing and is no new evidence
SELECT pg_temp.fixtures();
SELECT pg_temp.file('00000000-0000-4000-8000-000000000f99', '00000000-0000-4000-8000-0000000000f9', now(), 'ios:other');
SELECT pg_temp.assert_true(pg_temp.st('2026-10-27') = 'refused_no_new_evidence', 'after: an unrelated filing does not unblock a refused day');
SELECT public.capture_set_review_sweep(NULL, 200);
SELECT pg_temp.assert_true(pg_temp.queued() = '', 'after: an unrelated filing re-arms no day');
-- same capture session (set_key of the day's open row) re-arms that day only
SELECT pg_temp.file('00000000-0000-4000-8000-000000000f20', '00000000-0000-4000-8000-0000000000f9', now(), 's20');
SELECT public.capture_set_review_sweep(NULL, 200);
SELECT pg_temp.assert_true(pg_temp.queued() = '2026-10-20', 'a filing in the same capture session re-arms only that day');
-- a photo taken the same capture day is new evidence for the refused 10-27 and re-arms it
SELECT pg_temp.file('00000000-0000-4000-8000-000000000f27', '00000000-0000-4000-8000-0000000000f9', pg_temp.day_from('2026-10-27') + interval '11 hours', 'ios:x27');
SELECT pg_temp.assert_true(pg_temp.st('2026-10-27') = 'new_evidence_since_refusal', 'a same-day filing is new evidence for the refused day');
SELECT public.capture_set_review_sweep(NULL, 200);
SELECT pg_temp.assert_true(pg_temp.queued() = '2026-10-20,2026-10-27', 'a same-day filing re-arms that day only');
-- the proposed-vehicle rule is unchanged: a filing onto V2 re-arms 10-25
SELECT pg_temp.file('00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-0000000000f2', now(), 'ios:y');
SELECT public.capture_set_review_sweep(NULL, 200);
SELECT pg_temp.assert_true(pg_temp.queued() = '2026-10-20,2026-10-25,2026-10-27', 'a filing onto a proposed vehicle still re-arms its day');

\i supabase/sql/revert_20261113120100_capture_rearm_related.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_set_review_sweep(uuid, integer)'::regprocedure)) = '4220544e9d0951cb074fc7f24a51459b'
  AND md5(pg_get_functiondef('public.capture_day_replan_state(uuid, date)'::regprocedure)) = '48f434a988614531f5c29ada12cf4e18', 'revert restores the 20261113120000 bodies');
SELECT 'capture rearm related contract: ok' AS result;
