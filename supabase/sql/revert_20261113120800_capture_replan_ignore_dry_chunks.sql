-- Revert 20261113120800: restore the capture_day_replan_state body read 2026-11-09 (md5 4e24c7285297626bc4b13e1ded45fa8f).
CREATE OR REPLACE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  -- refusal onto a vehicle the day's open review rows propose, or in the same capture session (set_key) or capture day
  -- (20261113120100: no longer any vehicle when they propose none)
  SELECT EXISTS (SELECT 1 FROM vehicle_images v
                 WHERE v.user_id = p_user AND v.vehicle_id IS NULL AND v.taken_at >= v_from AND v.taken_at < v_to
                   AND v.created_at > c.at)
    INTO v_photos;
  SELECT EXISTS (
           WITH vehs AS (
             SELECT array_agg(DISTINCT r.to_vehicle_id) FILTER (WHERE r.to_vehicle_id IS NOT NULL) a, array_agg(DISTINCT r.set_key) s
             FROM capture_set_review r
             WHERE r.user_id = p_user AND r.status = 'open'
               AND (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) = p_day)
           SELECT 1 FROM capture_set_links l
           JOIN filing_run_gate fg ON fg.run_id = l.run_id::text AND fg.passed
           JOIN vehicle_images vi ON vi.id = l.image_id, vehs
           WHERE l.reverted_at IS NULL AND vi.user_id = p_user AND l.created_at > c.at
             AND (l.vehicle_id = ANY (coalesce(vehs.a, '{}'::uuid[])) OR l.set_key = ANY (coalesce(vehs.s, '{}'::text[]))
                  OR (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date = p_day))
    INTO v_anchor;
  IF v_photos OR v_anchor THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'new_evidence_since_refusal', 'chunk', c.id,
                              'new_photos', v_photos, 'new_anchor', v_anchor);
  END IF;
  RETURN jsonb_build_object('blocked', true, 'reason', 'refused_no_new_evidence', 'chunk', c.id, 'refused_at', c.at);
END $function$;

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.capture_day_replan_state(uuid, date)'::regprocedure)) <> '4e24c7285297626bc4b13e1ded45fa8f' THEN
    RAISE EXCEPTION 'revert did not restore the prior capture_day_replan_state body';
  END IF;
END $$;
