-- 20261115200000 capture_replan_vehicle_leftovers idempotent
-- Skip image_ids already logged in an unreverted capture_replan_vehicle_log row,
-- and skip days that capture_day_replan_state reports as refused_no_new_evidence
-- (the same helper capture_sets_drain uses). Those days become eligible again
-- when the helper reports new evidence. Evaluates the helper once per distinct
-- day, then applies ORDER BY day, id LIMIT cap, so refused days do not consume
-- the cap. Does not file, does not call capture_landing_gate_check, does not
-- invent clocks. Dry-default, cap 50, granted_by required. Revert path unchanged:
-- capture_replan_vehicle_leftovers_revert_v1.

CREATE OR REPLACE FUNCTION public.capture_replan_vehicle_leftovers_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_take int := 0;
  n_days int := 0;
  v_items jsonb := '[]';
  v_sig text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_replan_vehicle_leftovers_v1: user, run and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_replan_vehicle_leftovers_v1: cap must be 1..50';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_replan_vehicle_leftovers'));
  v_sig := 'capture_replan_vehicle_leftovers_v1/' || p_run::text;

  CREATE TEMP TABLE IF NOT EXISTS _rv_cand (
    image_id uuid PRIMARY KEY,
    typ text,
    day date NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _rv_cand;

  INSERT INTO _rv_cand (image_id, typ, day)
  SELECT vi.id,
         vi.ai_scan_metadata#>>'{classification,image_type}',
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE 'America/Los_Angeles')::date
  FROM public.vehicle_images vi
  WHERE vi.user_id = p_user
    AND vi.vehicle_id IS NULL
    AND coalesce(vi.is_sensitive, false) IS NOT TRUE
    AND nullif(btrim(vi.image_url), '') IS NOT NULL
    AND coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') IN
        ('vehicle_exterior','vehicle_interior','engine_bay','part_closeup','detail_closeup','progress_shot')
    AND public.capture_set_photo_admits(vi.source, vi.vehicle_id, vi.exif_data)
    AND NOT EXISTS (SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id)
    AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_set_review r
      CROSS JOIN LATERAL unnest(r.image_ids) x(image_id)
      WHERE r.user_id = p_user AND r.status = 'open' AND x.image_id = vi.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_landing_chunks c
      JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
      CROSS JOIN LATERAL unnest(s.image_ids) x(image_id)
      WHERE c.user_id = p_user AND c.state = 'awaiting_gate' AND x.image_id = vi.id)
    AND EXISTS (
      SELECT 1 FROM public.capture_landing_chunks c
      WHERE c.user_id = p_user
        AND c.dry IS DISTINCT FROM true
        AND c.state IN ('applied','refused','gate_failed','awaiting_gate')
        AND (COALESCE(vi.taken_at, vi.created_at) >= c.t_from AND COALESCE(vi.taken_at, vi.created_at) < c.t_to))
    AND NOT EXISTS (
      SELECT 1 FROM public.capture_replan_vehicle_log l
      WHERE l.user_id = p_user AND l.image_id = vi.id AND l.reverted_at IS NULL);

  CREATE TEMP TABLE IF NOT EXISTS _rv_day (
    day date PRIMARY KEY,
    reason text
  ) ON COMMIT DROP;
  TRUNCATE _rv_day;
  INSERT INTO _rv_day (day, reason)
  SELECT d.day, public.capture_day_replan_state(p_user, d.day)->>'reason'
  FROM (SELECT DISTINCT c.day FROM _rv_cand c) d;

  CREATE TEMP TABLE IF NOT EXISTS _rv_elig (
    image_id uuid PRIMARY KEY,
    typ text,
    day date NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _rv_elig;

  INSERT INTO _rv_elig (image_id, typ, day)
  SELECT c.image_id, c.typ, c.day
  FROM _rv_cand c
  JOIN _rv_day d ON d.day = c.day
  WHERE coalesce(d.reason, '') IS DISTINCT FROM 'refused_no_new_evidence'
  ORDER BY c.day, c.image_id
  LIMIT p_cap;

  GET DIAGNOSTICS n_take = ROW_COUNT;
  SELECT count(DISTINCT day) INTO n_days FROM _rv_elig;
  SELECT coalesce(jsonb_agg(jsonb_build_object('image_id', image_id, 'typ', typ, 'day', day) ORDER BY day, image_id), '[]'::jsonb)
    INTO v_items FROM _rv_elig;

  IF NOT p_dry THEN
    INSERT INTO public.capture_replan_vehicle_log(run_id, image_id, user_id, granted_by, typ, day, signature)
    SELECT p_run, image_id, p_user, p_granted_by, typ, day, v_sig FROM _rv_elig
    ON CONFLICT (run_id, image_id) DO NOTHING;
    IF to_regprocedure('public.capture_sets_enqueue(uuid,date,jsonb)') IS NOT NULL THEN
      PERFORM public.capture_sets_enqueue(p_user, d, jsonb_build_object('replan_vehicle_leftovers', p_run))
      FROM (SELECT DISTINCT day d FROM _rv_elig) q;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'run_id', p_run, 'dry', p_dry, 'cap', p_cap, 'granted_by', p_granted_by, 'signature', v_sig,
    'taken', n_take, 'days', n_days, 'items', v_items);
END
$function$;
