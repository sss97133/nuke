-- Contract: 20261125131000. The one-time re-arm enqueues exactly the local days with a scorable photo classified after
-- every chunk covering it, through capture_sets_enqueue, and a replay after the day is re-planned enqueues nothing.
-- Cases (owner U, Pacific days):
--   R1 2017-02-05: a photo read after its only chunk was created            -> enqueued, reason read_after_scoring 1
--   R2 2017-09-03: two such photos, plus one read before a later chunk       -> enqueued once, read_after_scoring 2
--   N1 2018-01-10: read after the first chunk, but a later chunk postdates it -> not enqueued
--   N2 2018-02-10: read after its chunk, image_type other (scorer blocks it)  -> not enqueued
--   N3 2018-03-10: read after its chunk, duplicate                            -> not enqueued
--   N4 2018-04-10: read after its chunk, filed on a car                       -> not enqueued
--   N5 2018-05-10: read after its chunk, uploaded 40 days ago                 -> not enqueued (30-day bound)
--   N6 2018-06-10: no chunk covers it (the drain's arrival path owns it)      -> not enqueued
--   N7 2018-07-10: covered only by a dry chunk                                -> not enqueued
--   N8 2018-08-10: another user's photo                                       -> not enqueued
--   an existing queue row for R1 keeps its reasons and gains this one; replay after new chunks enqueues 0;
--   a drifted capture_sets_enqueue stops the migration.
-- capture_sets_enqueue and capture_sets_drain are production's bodies of 2026-11-25 (md5-checked).
-- Disposable PG17 only, synthetic rows in stand-in tables. -- ALLOW_RAW_TESTIMONY_WRITE (local fixture, never production)
\set ON_ERROR_STOP on
SET client_min_messages = notice;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database (dm_refinement_*)';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
CREATE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ===== stand-ins: the columns the re-arm reads
-- guardrail-allow(center-key-fk): vehicle_images: disposable PG17 stand-in of a live table; only the columns the re-arm reads
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  source text DEFAULT 'capture_relay_ios', exif_data jsonb, image_url text DEFAULT 'x.jpg', taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), ai_processing_status text DEFAULT 'completed', ai_processing_completed_at timestamptz,
  is_document boolean, doc_flag boolean, is_duplicate boolean, is_superseded boolean, is_sensitive boolean,
  vision_gate_status text, ai_scan_metadata jsonb);
CREATE TABLE public.capture_landing_config(id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), user_id uuid NOT NULL);
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), track text NOT NULL DEFAULT 'manual',
  user_id uuid NOT NULL, t_from timestamptz NOT NULL, t_to timestamptz NOT NULL, dry boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'applied', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.capture_set_rescore_queue(user_id uuid NOT NULL, day date NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
  not_before date NOT NULL DEFAULT (CURRENT_DATE + 1), reasons jsonb NOT NULL DEFAULT '[]'::jsonb, done_run_id uuid,
  done_at timestamptz, PRIMARY KEY (user_id, day));
CREATE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT p_source = 'capture_relay_ios' $$;

-- ===== production's bodies
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
$function$

;

CREATE OR REPLACE FUNCTION public.capture_sets_drain(p_max integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q record; v_run uuid; v_res jsonb; v_out jsonb := '[]'; v_armed integer; v_state jsonb; v_pending integer;
        v_last jsonb; v_nv_by uuid; v_nv jsonb;
BEGIN
  v_armed := capture_sets_arm_new_photos();
  FOR q IN SELECT * FROM capture_set_rescore_queue
           WHERE done_at IS NULL AND not_before <= current_date AND requested_at < now() - interval '10 minutes'
           ORDER BY requested_at LIMIT greatest(1, least(p_max, 5)) FOR UPDATE SKIP LOCKED LOOP
    -- 20261122030000: a day waits while one of its photos is still being classified, so it is scored on the
    -- classifier's answer and not before it. A photo uploaded more than 6 hours ago no longer holds the day back.
    SELECT count(*) INTO v_pending FROM vehicle_images v
     WHERE v.user_id = q.user_id AND v.vehicle_id IS NULL
       AND v.taken_at >= (q.day::timestamp AT TIME ZONE 'America/Los_Angeles')
       AND v.taken_at < ((q.day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles')
       AND v.created_at > now() - interval '6 hours'
       AND coalesce(v.ai_processing_status, 'pending') IN ('pending', 'processing', 'in_progress', 'running', 'classifying', 'started')
       AND v.is_duplicate IS NOT TRUE AND nullif(btrim(coalesce(v.image_url, '')), '') IS NOT NULL
       AND public.capture_set_photo_admits(v.source, v.vehicle_id, v.exif_data);
    IF v_pending > 0 THEN
      UPDATE capture_set_rescore_queue SET requested_at = now()
       WHERE user_id = q.user_id AND day = q.day AND requested_at = q.requested_at;
      v_out := v_out || jsonb_build_object('day', q.day, 'deferred', 'awaiting_classification', 'pending', v_pending);
      CONTINUE;
    END IF;
    -- Dedupe and back off (20261113120000): no second plan while one waits on the gate, and no re-plan of a day the gate
    -- refused until new evidence arrives. New photos (arrival) or a new text read always re-plan. A finished
    -- classification (classified, read_after_scoring; 20261122030000) re-plans a refused day, never a pending plan.
    v_state := capture_day_replan_state(q.user_id, q.day);
    v_last := jsonb_path_query_first(q.reasons, '$[last]');
    IF coalesce((v_state->>'blocked')::boolean, false)
       AND NOT coalesce(v_last ?| ARRAY['arrival', 'text_read'], false)
       AND NOT (v_state->>'reason' = 'refused_no_new_evidence'
                AND coalesce(v_last ?| ARRAY['classified', 'read_after_scoring'], false)) THEN
      UPDATE capture_set_rescore_queue SET done_at = now(), done_run_id = NULL,
             reasons = reasons || jsonb_build_array(jsonb_build_object('skipped', v_state->>'reason', 'chunk', v_state->'chunk', 'at', now()))
       WHERE user_id = q.user_id AND day = q.day AND requested_at = q.requested_at;
      v_out := v_out || jsonb_build_object('day', q.day, 'skipped', v_state->>'reason', 'chunk', v_state->'chunk');
      CONTINUE;
    END IF;
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
      CONTINUE;
    END;
    -- 20261122030000: when the owner's landing config names a grantor, the day's classifier-"other" photos that the
    -- second reader also finds no vehicle in become non_vehicle under the same run id (revert:
    -- capture_non_vehicle_review_revert_v1(user, run)). Off while auto_non_vehicle_granted_by is null.
    v_nv_by := NULL;
    SELECT c.auto_non_vehicle_granted_by INTO v_nv_by FROM capture_landing_config c
     WHERE c.user_id = q.user_id AND c.enabled AND NOT c.halted ORDER BY c.id LIMIT 1;
    IF v_nv_by IS NOT NULL THEN
      BEGIN
        v_nv := capture_non_vehicle_auto_v1(q.user_id, v_run, v_nv_by, false, 200, q.day, false);
        v_out := jsonb_set(v_out, ARRAY[(jsonb_array_length(v_out) - 1)::text, 'non_vehicle'], coalesce(v_nv->'taken', '0'));
      EXCEPTION WHEN OTHERS THEN
        v_out := jsonb_set(v_out, ARRAY[(jsonb_array_length(v_out) - 1)::text, 'non_vehicle_error'], to_jsonb(left(SQLERRM, 200)));
      END;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('armed_days', v_armed, 'runs', v_out);
END 
$function$

;

SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_sets_enqueue') = 'd45a3d1b58a48eb4df3f8e579592e4fc'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_sets_drain') = 'e7780a1c38b3373e83a5f42c011ea3a7',
  'capture_sets_enqueue and capture_sets_drain are production''s bodies (md5)');

-- ===== fixture. Photos taken at 10:00 PT; each day's chunk is the Pacific day, created 2 h before now; reads 1 h ago.
INSERT INTO public.capture_landing_config VALUES (1, '00000000-0000-4000-8000-0000000000aa');
CREATE FUNCTION pg_temp.day(d text, created timestamptz DEFAULT now() - interval '2 hours', dry boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.capture_landing_chunks(user_id, t_from, t_to, dry, created_at)
  VALUES ('00000000-0000-4000-8000-0000000000aa', (d || ' 00:00')::timestamp AT TIME ZONE 'America/Los_Angeles',
          (d || ' 00:00')::timestamp AT TIME ZONE 'America/Los_Angeles' + interval '1 day', dry, created) $$;
CREATE FUNCTION pg_temp.photo(d text, read_at timestamptz DEFAULT now() - interval '1 hour', extra jsonb DEFAULT '{}') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images(user_id, vehicle_id, taken_at, created_at, ai_processing_completed_at, is_duplicate, ai_scan_metadata)
  VALUES (coalesce((extra->>'user')::uuid, '00000000-0000-4000-8000-0000000000aa'), (extra->>'vehicle')::uuid,
          (d || ' 10:00')::timestamp AT TIME ZONE 'America/Los_Angeles',
          coalesce((extra->>'created')::timestamptz, now() - interval '3 hours'), read_at, (extra->>'dup')::boolean,
          jsonb_build_object('classification', jsonb_build_object('image_type', coalesce(extra->>'type', 'vehicle_exterior')))) $$;
SELECT pg_temp.day('2017-02-05'); SELECT pg_temp.photo('2017-02-05');
SELECT pg_temp.day('2017-09-03'); SELECT pg_temp.photo('2017-09-03'); SELECT pg_temp.photo('2017-09-03');
SELECT pg_temp.photo('2017-09-03', now() - interval '3 hours');
SELECT pg_temp.day('2018-01-10'); SELECT pg_temp.day('2018-01-10', now() - interval '30 minutes'); SELECT pg_temp.photo('2018-01-10');
SELECT pg_temp.day('2018-02-10'); SELECT pg_temp.photo('2018-02-10', extra => '{"type":"other"}');
SELECT pg_temp.day('2018-03-10'); SELECT pg_temp.photo('2018-03-10', extra => '{"dup":true}');
SELECT pg_temp.day('2018-04-10'); SELECT pg_temp.photo('2018-04-10', extra => '{"vehicle":"00000000-0000-4000-8000-0000000000c3"}');
SELECT pg_temp.day('2018-05-10'); SELECT pg_temp.photo('2018-05-10', extra => jsonb_build_object('created', now() - interval '40 days'));
SELECT pg_temp.photo('2018-06-10');
SELECT pg_temp.day('2018-07-10', dry => true); SELECT pg_temp.photo('2018-07-10');
SELECT pg_temp.day('2018-08-10'); SELECT pg_temp.photo('2018-08-10', extra => '{"user":"00000000-0000-4000-8000-0000000000bb"}');
-- R1 already has a done queue row from an earlier arrival
INSERT INTO public.capture_set_rescore_queue(user_id, day, requested_at, not_before, reasons, done_at)
VALUES ('00000000-0000-4000-8000-0000000000aa', '2017-02-05', now() - interval '3 hours', '2026-11-09', '[{"arrival":16}]', now() - interval '2 hours');

-- ===== a drifted writer stops the migration
ALTER FUNCTION public.capture_sets_enqueue(uuid, date, jsonb) RENAME TO capture_sets_enqueue_held;
CREATE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261125131000_capture_sets_rearm_read_after_plan.sql
\set ON_ERROR_STOP on
ROLLBACK;
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_rescore_queue WHERE done_at IS NULL) = 0,
  'a drifted capture_sets_enqueue: the guard stops the migration, nothing enqueued');
DROP FUNCTION public.capture_sets_enqueue(uuid, date, jsonb);
ALTER FUNCTION public.capture_sets_enqueue_held(uuid, date, jsonb) RENAME TO capture_sets_enqueue;

-- ===== apply
\ir ../migrations/20261125131000_capture_sets_rearm_read_after_plan.sql
SELECT pg_temp.ok((SELECT array_agg(day ORDER BY day) FROM capture_set_rescore_queue WHERE done_at IS NULL) = ARRAY['2017-02-05'::date, '2017-09-03'::date],
  'only R1 and R2 are enqueued (N1-N8 are not)');
SELECT pg_temp.ok((SELECT (reasons->-1->>'read_after_scoring')::int = 2 AND reasons->-1->>'by' = '20261125131000_capture_sets_rearm_read_after_plan'
                     AND not_before = current_date FROM capture_set_rescore_queue WHERE day = '2017-09-03'),
  'R2: one queue row, read_after_scoring 2 (the photo read before a covering chunk does not count), due today');
SELECT pg_temp.ok((SELECT reasons = '[{"arrival":16},{"read_after_scoring":1,"by":"20261125131000_capture_sets_rearm_read_after_plan"}]'::jsonb
                          AND done_at IS NULL AND not_before = '2026-11-09'
                     FROM capture_set_rescore_queue WHERE day = '2017-02-05'),
  'R1: the existing queue row keeps its reasons, gains read_after_scoring as its last reason, and is pending again');
SELECT pg_temp.ok(jsonb_path_query_first((SELECT reasons FROM capture_set_rescore_queue WHERE day = '2017-02-05'), '$[last]')
                    ?| ARRAY['classified', 'read_after_scoring'],
  'the last reason is one the drain re-plans on even when the gate refused the day (capture_sets_drain)');

-- ===== replay after the drain re-planned both days: nothing
UPDATE capture_set_rescore_queue SET done_at = now();
SELECT pg_temp.day('2017-02-05', now()); SELECT pg_temp.day('2017-09-03', now());
\ir ../migrations/20261125131000_capture_sets_rearm_read_after_plan.sql
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM capture_set_rescore_queue WHERE done_at IS NULL),
  'replay after the days are re-planned enqueues 0');

SELECT 'test_capture_sets_rearm_read_after_plan: all contracts passed' AS result;
