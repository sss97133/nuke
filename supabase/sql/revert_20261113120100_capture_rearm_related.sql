-- Revert 20261113120100_capture_rearm_related: restore the 20261113120000 bodies of capture_day_replan_state and
-- capture_set_review_sweep. Live revert alternative: re-execute the defs in backup_20261109_rearm_related_fn_defs.
BEGIN;
SET LOCAL statement_timeout = '30s';
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

COMMIT;
