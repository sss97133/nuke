-- Work days resolve from evidence; they are never a question for the owner.
--
-- Owner 2026-11-04: the iOS Work tab showed "Needs your OK · 400", all "Confirm work day".
-- A work session is photo-derived and the confirmation binds no labor value, counterparty or
-- payment (see my_signature_queue sign.does_not_bind), so asking is pure friction.
--
-- 1. resolve_work_sessions_from_evidence(): marks unresolved sessions in
--    work_sessions.metadata.auto_resolution = {status, reason, evidence, resolved_at, resolved_by}
--      closed_obsolete  vehicle merged/rejected, or no photo remains on the vehicle in the window
--      auto_confirmed   photos filed on this vehicle in the window, none rejected by the visual
--                       gate, <=25% still review_needed
--      system_hold      gate rejected/undecided photos: waits for the visual gate, no prompt
--    owner_confirmed_at is NOT written: a system decision is never recorded as the owner's.
--    Revert one row:  UPDATE work_sessions SET metadata = metadata - 'auto_resolution' WHERE id = ...
-- 2. my_signature_queue() only lists a work_session when auto_resolution.status = 'needs_owner'
--    (nothing emits that today).

CREATE OR REPLACE FUNCTION public.resolve_work_sessions_from_evidence(p_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE n integer;
BEGIN
  WITH cand AS (
    SELECT s.id, s.vehicle_id, s.start_time, s.end_time, v.status::text AS vstatus
    FROM public.work_sessions s JOIN public.vehicles v ON v.id = s.vehicle_id
    WHERE s.owner_confirmed_at IS NULL AND s.duration_minutes > 0
      AND NOT (COALESCE(s.metadata, '{}'::jsonb) ? 'auto_resolution')
      AND (p_user_id IS NULL OR s.user_id = p_user_id)
      AND left(v.id::text, 8) NOT IN ('1e9fdf16', '7b0e02b9')
    ORDER BY s.session_date DESC LIMIT p_limit
  ), g AS (
    SELECT c.id, c.vstatus,
      count(vi.id) AS tot,
      count(*) FILTER (WHERE vi.vision_gate_status = 'review_needed') AS rn,
      count(*) FILTER (WHERE vi.vision_gate_status IN ('rejected_personal', 'rejected_misattributed')) AS rej,
      count(*) FILTER (WHERE vi.vision_gate_status = 'approved') AS ap
    FROM cand c LEFT JOIN LATERAL (
      SELECT x.id, x.vision_gate_status FROM public.vehicle_images x
      WHERE x.vehicle_id = c.vehicle_id AND x.taken_at >= c.start_time - interval '1 minute'
        AND x.taken_at <= c.end_time + interval '1 minute' AND COALESCE(x.is_superseded, false) = false) vi ON true
    GROUP BY c.id, c.vstatus
  ), d AS (
    SELECT g.*, CASE
      WHEN g.vstatus IN ('merged', 'rejected') THEN 'closed_obsolete'
      WHEN g.tot = 0 THEN 'closed_obsolete'
      WHEN g.rej = 0 AND g.rn::numeric / g.tot <= 0.25 THEN 'auto_confirmed'
      ELSE 'system_hold' END AS res,
    CASE
      WHEN g.vstatus = 'merged' THEN 'vehicle_merged'
      WHEN g.vstatus = 'rejected' THEN 'vehicle_rejected'
      WHEN g.tot = 0 THEN 'no_photos_remain_on_vehicle_in_window'
      WHEN g.rej = 0 AND g.rn::numeric / g.tot <= 0.25 THEN 'filed_photos_on_vehicle_no_gate_conflict'
      WHEN g.rej > 0 THEN 'some_photos_rejected_by_gate'
      ELSE 'majority_photos_awaiting_visual_gate' END AS why
    FROM g
  ), u AS (
    UPDATE public.work_sessions s
    SET metadata = COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object('auto_resolution', jsonb_build_object(
      'status', d.res, 'reason', d.why,
      'evidence', jsonb_build_object('photos_in_window', d.tot, 'gate_approved', d.ap, 'gate_review_needed', d.rn,
                                     'gate_rejected', d.rej, 'vehicle_status', d.vstatus),
      'resolved_at', now(), 'resolved_by', 'system:resolve_work_sessions_from_evidence'))
    FROM d WHERE d.id = s.id RETURNING 1)
  SELECT count(*) INTO n FROM u;
  RETURN n;
END $fn$;

REVOKE ALL ON FUNCTION public.resolve_work_sessions_from_evidence(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_work_sessions_from_evidence(uuid, integer) TO service_role;

-- Hourly sweep for newly derived sessions.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('resolve-work-sessions-from-evidence') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resolve-work-sessions-from-evidence');
    PERFORM cron.schedule('resolve-work-sessions-from-evidence', '17 * * * *', 'select public.resolve_work_sessions_from_evidence(null, 1000)');
  END IF;
END $$;

-- Queue: a work_session is listed only when the resolver says the owner is genuinely needed.
CREATE OR REPLACE FUNCTION public.my_signature_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  uid uuid := auth.uid();
  total integer;
  items jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO total FROM public.work_sessions s JOIN public.vehicles v ON v.id = s.vehicle_id
    WHERE s.user_id = uid AND s.owner_confirmed_at IS NULL AND s.duration_minutes > 0
      AND (v.user_id = uid OR v.owner_id = uid) AND v.make <> 'UNRESOLVED'
      AND s.metadata->'auto_resolution'->>'status' = 'needs_owner';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'work_session', 'ref_id', q.id, 'work_order_id', NULL,
      'vehicle', jsonb_build_object('vehicle_id', q.vehicle_id, 'year', q.year, 'make', q.make, 'model', q.model),
      'clock', jsonb_build_object('session_date', q.session_date, 'start_time', q.start_time, 'end_time', q.end_time),
      'capture_span_minutes', q.duration_minutes,
      'evidence_counts', jsonb_build_object('session_images', q.image_count,
        'vehicle_photos_that_day', (SELECT count(*) FROM public.vehicle_images vi WHERE vi.vehicle_id = q.vehicle_id
          AND vi.taken_at >= q.session_date::timestamptz AND vi.taken_at < (q.session_date + 1)::timestamptz
          AND vi.is_external IS FALSE)),
      'sign', jsonb_build_object('rpc', 'confirm_work_session', 'binds', 'self-confirmation of a photo-derived work day',
        'does_not_bind', jsonb_build_array('counterparty acceptance', 'labor value', 'payment')))
      ORDER BY q.session_date DESC, q.id), '[]'::jsonb) INTO items
  FROM (SELECT s.id, s.vehicle_id, s.session_date, s.start_time, s.end_time, s.duration_minutes, s.image_count, v.year, v.make, v.model
    FROM public.work_sessions s JOIN public.vehicles v ON v.id = s.vehicle_id
    WHERE s.user_id = uid AND s.owner_confirmed_at IS NULL AND s.duration_minutes > 0
      AND (v.user_id = uid OR v.owner_id = uid) AND v.make <> 'UNRESOLVED'
      AND s.metadata->'auto_resolution'->>'status' = 'needs_owner'
    ORDER BY s.session_date DESC, s.id LIMIT 250) q;
  RETURN public.signature_queue_extend(uid, jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid), false),
    'as_of', statement_timestamp(), 'items', items,
    'coverage', jsonb_build_object('returned', jsonb_array_length(items), 'total', total, 'limit', 250,
      'kinds', jsonb_build_array('work_session'),
      'kinds_not_yet_available', jsonb_build_array('terms', 'offer', 'completion_attestation', 'co_sign_request'),
      'population', 'own work sessions the evidence resolver could not settle')));
END $function$;
