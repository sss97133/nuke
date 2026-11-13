-- 20261115193000 capture_replan_vehicle_leftovers
-- Enqueue days that still have unfiled, admitted, vehicle-typed frames after a
-- previous plan (applied / refused / gate_failed / review-only) so typ coverage
-- and identity_conflict (already live in plan_step) can replan via the sanctioned
-- capture_sets_enqueue path. Does not file, does not call capture_landing_gate_check,
-- does not invent clocks, does not touch typ=other / receipt_document (those belong
-- to non_vehicle_review) or empty_url / the 452 exclude set.
-- Dry-default, cap 50 photos, granted_by required, log + revert (clears the enqueue
-- only when the queue row was armed by this run and is still pending).
-- Revert: capture_replan_vehicle_leftovers_revert_v1 then
-- supabase/sql/revert_20261115193000_capture_replan_vehicle_leftovers.sql

CREATE TABLE IF NOT EXISTS public.capture_privacy_promote_exclude (
  image_id uuid PRIMARY KEY,
  reason text NOT NULL DEFAULT 'privacy_backup_union',
  granted_by uuid,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.capture_replan_vehicle_log (
  run_id uuid NOT NULL,
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  typ text,
  day date NOT NULL,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id)
);

REVOKE ALL ON public.capture_replan_vehicle_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_replan_vehicle_log TO service_role;

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

  CREATE TEMP TABLE IF NOT EXISTS _rv_elig (
    image_id uuid PRIMARY KEY,
    typ text,
    day date NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _rv_elig;

  INSERT INTO _rv_elig (image_id, typ, day)
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
  ORDER BY 3, vi.id
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

CREATE OR REPLACE FUNCTION public.capture_replan_vehicle_leftovers_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int := 0; q int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_replan_vehicle_leftovers_revert_v1: user and run required';
  END IF;
  -- Only clear a queue row still pending from this run (do not un-apply a later drain).
  DELETE FROM public.capture_set_rescore_queue q
   WHERE q.user_id = p_user AND q.done_at IS NULL
     AND q.reasons @> jsonb_build_array(jsonb_build_object('replan_vehicle_leftovers', p_run));
  GET DIAGNOSTICS q = ROW_COUNT;
  UPDATE public.capture_replan_vehicle_log
     SET reverted_at = now()
   WHERE user_id = p_user AND run_id = p_run AND reverted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run, 'reverted_log', n, 'queue_cleared', q);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_replan_vehicle_leftovers_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_replan_vehicle_leftovers_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_replan_vehicle_leftovers_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_replan_vehicle_leftovers_revert_v1(uuid, uuid) TO service_role;
