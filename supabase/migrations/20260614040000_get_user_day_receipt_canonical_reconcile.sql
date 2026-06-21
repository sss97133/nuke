-- get_user_day_receipt: repointed to canonical vehicle_images.ai_scan_metadata.byok_deep_analysis
-- (was image_analysis_records fork). Applied live via psql 2026-06-14; this file repairs the drift.

CREATE OR REPLACE FUNCTION public.get_user_day_receipt(p_user_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_owner boolean := (auth.uid() = p_user_id);
  v_photos jsonb;
  v_work jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_money jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_facets jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'url', s.image_url, 'thumb', COALESCE(s.thumbnail_url, s.image_url),
           'vehicle_id', s.vehicle_id, 'taken_at', s.taken_at, 'file_name', s.file_name,
           'narrative', NULLIF(s.narrative, ''), 'components', s.components, 'part_numbers', s.part_numbers,
           'intent', s.intent,
           'intent_confidence', s.intent_confidence, 'intent_confirmed', s.intent_confirmed,
           'analyzed_by', s.analyzed_by, 'analyzed_at', s.analyzed_at,
           'source', 'vehicle_images') ORDER BY s.taken_at), '[]'::jsonb)
  INTO v_photos
  FROM (
    SELECT vi.id, vi.image_url, vi.thumbnail_url, vi.vehicle_id, vi.taken_at, vi.file_name,
           a.bda->>'narrative_one_line' AS narrative,
           (SELECT jsonb_agg(c->>'label')
              FROM jsonb_array_elements(COALESCE(a.bda->'components_seen','[]'::jsonb)) c
             WHERE c->>'label' IS NOT NULL) AS components,
           (SELECT jsonb_agg(c->>'part_number_guess')
              FROM jsonb_array_elements(COALESCE(a.bda->'components_seen','[]'::jsonb)) c
             WHERE NULLIF(c->>'part_number_guess','') IS NOT NULL) AS part_numbers,
           a.bda->>'intent' AS intent,
           NULLIF(a.bda->>'intent_confidence','')::numeric AS intent_confidence,
           false AS intent_confirmed,
           a.bda->>'agent_model' AS analyzed_by,
           NULLIF(a.bda->>'analyzed_at','')::timestamptz AS analyzed_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    -- CANONICAL: read analysis from the image's own ai_scan_metadata.byok_deep_analysis
    -- (the home the existing pipeline writes), not the retired image_analysis_records fork.
    LEFT JOIN LATERAL (
      SELECT (vi.ai_scan_metadata->'byok_deep_analysis') AS bda
    ) a ON true
    WHERE vi.user_id = p_user_id AND vi.taken_at >= p_date::timestamptz AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false AND (v_is_owner OR (vi.vehicle_id IS NOT NULL AND v.is_public = true))
    ORDER BY vi.taken_at LIMIT 60
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ws.id, 'title', COALESCE(ws.title, ws.work_type, 'work session'), 'vehicle_id', ws.vehicle_id,
           'duration_minutes', ws.duration_minutes,
           'total_job_cost', CASE WHEN v_is_owner THEN ws.total_job_cost ELSE NULL END,
           'source', 'work_sessions') ORDER BY ws.start_time NULLS LAST), '[]'::jsonb)
  INTO v_work FROM work_sessions ws WHERE ws.user_id = p_user_id AND ws.session_date = p_date;

  IF v_is_owner THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'vendor', r.vendor_name, 'total', COALESCE(r.total_amount, r.total),
             'vehicle_id', r.vehicle_id, 'source', 'receipts') ORDER BY COALESCE(r.total_amount,r.total) DESC NULLS LAST), '[]'::jsonb)
    INTO v_receipts FROM receipts r
    WHERE r.user_id = p_user_id AND r.superseded_at IS NULL
      AND p_date IN (r.transaction_date, r.purchase_date, r.receipt_date);

    -- MONEY + PEOPLE (owner-only) — every row drills to its payment_events id.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pe.id, 'direction', pe.direction, 'amount', pe.amount_usd,
             'counterparty', pe.counterparty_name, 'description', pe.description, 'paid_at', pe.paid_at,
             'source', 'payment_events') ORDER BY pe.paid_at), '[]'::jsonb)
    INTO v_money FROM payment_events pe
    WHERE pe.user_id = p_user_id AND pe.paid_at::date = p_date AND pe.superseded_at IS NULL;
  END IF;

  -- EVENTS — component_events on the vehicles touched that day.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ce.id, 'vehicle_id', ce.vehicle_id, 'event_type', ce.event_type,
           'description', ce.description, 'cost_cents', ce.cost_cents, 'source', 'component_events') ORDER BY ce.event_date), '[]'::jsonb)
  INTO v_events FROM component_events ce
  WHERE ce.event_date = p_date AND ce.vehicle_id IN (
    SELECT DISTINCT vi.vehicle_id FROM vehicle_images vi
    WHERE vi.user_id = p_user_id AND vi.taken_at >= p_date::timestamptz AND vi.taken_at < (p_date + 1)::timestamptz AND vi.vehicle_id IS NOT NULL);

  v_facets := jsonb_build_object('photos', jsonb_array_length(v_photos), 'work', jsonb_array_length(v_work),
    'receipts', jsonb_array_length(v_receipts), 'money', jsonb_array_length(v_money), 'events', jsonb_array_length(v_events));

  RETURN jsonb_build_object('date', p_date, 'is_owner_view', v_is_owner, 'photos', v_photos,
    'work_sessions', v_work, 'receipts', v_receipts, 'money', v_money, 'events', v_events, 'facets', v_facets);
END;
$function$
;
