-- Stop re-planning refused days every hour: dedupe day plans and back off refused days until new evidence arrives.
--
-- Why (owner, 2026-11-09): the same days were planned again every hour (2026-10-27, 10-28 and 11-03 had 7 chunks each by
-- 13:40 UTC; 10-27 every one refused by the visual gate). Cause, measured live: capture_set_review_sweep (cron
-- capture-review-sweep, :17 hourly) re-armed every day with an open review row older than the owner's newest gate-passed
-- filing ANYWHERE, 200 days a run (queue reasons {"new_anchors": ...} x200 at 14:17, 15:17 and 16:17 UTC), and
-- capture_sets_drain then made a fresh chunk for each, whether the previous one was still waiting on the gate or refused.
-- Change (only these two bodies plus one STABLE helper; nothing else moves):
--   capture_day_replan_state(user, day) reads the day's newest chunk: planned/awaiting_gate -> blocked 'plan_pending';
--     gate_failed with no new evidence since the refusal -> blocked 'refused_no_new_evidence'; otherwise not blocked.
--     New evidence = a photo of that day that arrived after the refusal, or a gate-passed filing after it onto a vehicle
--     the day's open review rows propose (any vehicle when they propose none).
--   capture_set_review_sweep step 3 re-arms a day only for a gate-passed filing newer than that day's open rows onto
--     a vehicle those rows propose, and never a blocked day.
--   capture_sets_drain marks a blocked queued day done with reasons += {"skipped": <reason>, "chunk": ...} instead of
--     planning it again; a day whose newest reason is new photos ("arrival") or a new text read is always planned.
-- Nothing is deleted or filed. Refuses on drift (live bodies read 2026-11-09).
-- Revert: supabase/sql/revert_20261113120001_capture_replan_backoff.sql. Contract: supabase/sql/test_capture_replan_backoff.sql.
-- Lane: photo/document/library (Codex reviews). Not applied live.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.capture_set_review_sweep(uuid, integer)'::regprocedure)) <> '98acf91af0045795437226d6e9a8872f' -- gitleaks:allow (function fingerprint)
     OR md5(pg_get_functiondef('public.capture_sets_drain(integer)'::regprocedure)) <> 'fe4310724f82af8181e84ad3ec1039a7' THEN -- gitleaks:allow (function fingerprint)
    RAISE EXCEPTION 'capture_set_review_sweep or capture_sets_drain drifted from the bodies read 2026-11-09; re-record before patching';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from timestamptz := p_day::timestamp AT TIME ZONE 'America/Los_Angeles';
  v_to   timestamptz := (p_day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles';
  c record; v_photos boolean; v_anchor boolean;
BEGIN
  SELECT id, state, coalesce(updated_at, created_at) AS at INTO c
  FROM capture_landing_chunks
  WHERE user_id = p_user AND t_from = v_from AND t_to = v_to
  ORDER BY created_at DESC LIMIT 1;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'never_planned');
  END IF;
  IF c.state IN ('planned', 'awaiting_gate') THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'plan_pending', 'chunk', c.id, 'state', c.state);
  END IF;
  IF c.state <> 'gate_failed' THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'last_plan_' || c.state, 'chunk', c.id);
  END IF;
  -- refused: new evidence is a photo of that day that arrived after the refusal, or a gate-passed filing after the
  -- refusal onto a vehicle the day's open review rows propose (any vehicle when they propose none)
  SELECT EXISTS (SELECT 1 FROM vehicle_images v
                 WHERE v.user_id = p_user AND v.vehicle_id IS NULL AND v.taken_at >= v_from AND v.taken_at < v_to
                   AND v.created_at > c.at)
    INTO v_photos;
  SELECT EXISTS (
           WITH vehs AS (
             SELECT array_agg(DISTINCT r.to_vehicle_id) FILTER (WHERE r.to_vehicle_id IS NOT NULL) a
             FROM capture_set_review r
             WHERE r.user_id = p_user AND r.status = 'open'
               AND (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) = p_day)
           SELECT 1 FROM capture_set_links l
           JOIN filing_run_gate fg ON fg.run_id = l.run_id::text AND fg.passed
           JOIN vehicle_images vi ON vi.id = l.image_id, vehs
           WHERE l.reverted_at IS NULL AND vi.user_id = p_user AND l.created_at > c.at
             AND (vehs.a IS NULL OR l.vehicle_id = ANY (vehs.a)))
    INTO v_anchor;
  IF v_photos OR v_anchor THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'new_evidence_since_refusal', 'chunk', c.id,
                              'new_photos', v_photos, 'new_anchor', v_anchor);
  END IF;
  RETURN jsonb_build_object('blocked', true, 'reason', 'refused_no_new_evidence', 'chunk', c.id, 'refused_at', c.at);
END $function$;

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
  -- 3. re-arm a day only on new evidence for THAT day: a gate-passed filing, newer than the day's newest open row,
  --    onto a vehicle the day's open rows propose (any vehicle when they propose none). A day whose plan is still
  --    waiting on the gate, or whose last plan the gate refused with no new evidence since, is not re-armed
  --    (capture_day_replan_state, 20261113120000). Before: any filing anywhere re-armed up to 200 days every hour.
  FOR rec IN
    WITH open_rows AS (
      SELECT r.user_id, r.created_at, r.to_vehicle_id,
             (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) d
      FROM capture_set_review r
      WHERE r.status = 'open' AND (p_user IS NULL OR r.user_id = p_user)
    ), per_day AS (
      SELECT o.user_id, o.d, max(o.created_at) newest_row,
             array_agg(DISTINCT o.to_vehicle_id) FILTER (WHERE o.to_vehicle_id IS NOT NULL) vehs
      FROM open_rows o WHERE o.d IS NOT NULL
      GROUP BY o.user_id, o.d
    )
    SELECT p.user_id, p.d
    FROM per_day p
    WHERE EXISTS (
            SELECT 1 FROM capture_set_links l
            JOIN filing_run_gate fg ON fg.run_id = l.run_id::text AND fg.passed
            JOIN vehicle_images vi ON vi.id = l.image_id
            WHERE l.reverted_at IS NULL AND vi.user_id = p.user_id AND l.created_at > p.newest_row
              AND (p.vehs IS NULL OR l.vehicle_id = ANY (p.vehs)))
      AND NOT EXISTS (SELECT 1 FROM capture_set_rescore_queue q WHERE q.user_id = p.user_id AND q.day = p.d AND q.done_at IS NULL)
      AND NOT coalesce((capture_day_replan_state(p.user_id, p.d)->>'blocked')::boolean, false)
    ORDER BY p.d
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
DECLARE q record; v_run uuid; v_res jsonb; v_out jsonb := '[]'; v_armed integer; v_state jsonb;
BEGIN
  v_armed := capture_sets_arm_new_photos();
  FOR q IN SELECT * FROM capture_set_rescore_queue
           WHERE done_at IS NULL AND not_before <= current_date AND requested_at < now() - interval '10 minutes'
           ORDER BY requested_at LIMIT greatest(1, least(p_max, 5)) FOR UPDATE SKIP LOCKED LOOP
    -- Dedupe and back off (20261113120000): no second plan while one waits on the gate, and no re-plan of a day the gate
    -- refused until new evidence arrives. New photos (arrival) or a new text read always re-plan.
    v_state := capture_day_replan_state(q.user_id, q.day);
    IF coalesce((v_state->>'blocked')::boolean, false)
       AND NOT coalesce(jsonb_path_query_first(q.reasons, '$[last]') ?| ARRAY['arrival', 'text_read'], false) THEN
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
    END;
  END LOOP;
  RETURN jsonb_build_object('armed_days', v_armed, 'runs', v_out);
END $function$;

REVOKE ALL ON FUNCTION public.capture_day_replan_state(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.capture_day_replan_state(uuid, date) IS
  'Whether a capture day may be planned again: blocked while its newest chunk waits on the gate, or after a gate refusal until a new photo of that day or a relevant gate-passed filing arrives (20261113120000).';
COMMIT;
