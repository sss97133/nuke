-- Surface the image analysis atoms + the intent-confirm consumer.
--
-- WHY: the iOS app (ProfileTab evidence rail, commit 05f26f5dd) and the web
-- day-receipt already have the surface; the data (2,844+ image_deep_byok
-- verdicts) is in vehicle_observations.structured_data; only the read RPC was
-- thin. This (1) enriches get_user_day_receipt so each photo carries its
-- atoms, and (2) adds confirm_photo_intent — the consumer for the $410 guard
-- that previously dead-ended (the model set needs_clarification but nothing
-- ever asked the owner).
--
-- Trust invariant: the owner's confirmed intent is stored ALONGSIDE the
-- model's original verdict (intent_confirmed_value / intent_owner_confirmed),
-- never overwriting structured_data->>'intent'. Surfaced intent prefers the
-- confirmed value via COALESCE. Visitor/owner gating is unchanged.

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
  v_facets jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'url', s.image_url, 'thumb', COALESCE(s.thumbnail_url, s.image_url),
           'vehicle_id', s.vehicle_id, 'taken_at', s.taken_at,
           'file_name', s.file_name,
           'narrative', NULLIF(s.narrative, ''),
           'components', s.components,
           'part_numbers', s.part_numbers,
           'intent', COALESCE(s.confirmed_intent, s.model_intent),
           'intent_confidence', s.intent_confidence,
           'intent_confirmed', s.intent_confirmed,
           'analyzed_by', s.analyzed_by,
           'analyzed_at', s.analyzed_at
         ) ORDER BY s.taken_at), '[]'::jsonb)
  INTO v_photos
  FROM (
    SELECT vi.id, vi.image_url, vi.thumbnail_url, vi.vehicle_id, vi.taken_at, vi.file_name,
           a.structured_data->>'narrative_one_line' AS narrative,
           (SELECT jsonb_agg(c->>'label')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'components_seen','[]'::jsonb)) c
              WHERE c->>'label' IS NOT NULL) AS components,
           (SELECT jsonb_agg(t->>'text')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'text_regions','[]'::jsonb)) t
              WHERE t->>'text' IS NOT NULL) AS part_numbers,
           a.structured_data->>'intent' AS model_intent,
           a.structured_data->>'intent_confirmed_value' AS confirmed_intent,
           NULLIF(a.structured_data->>'intent_confidence','')::numeric AS intent_confidence,
           NULLIF(a.structured_data->>'intent_owner_confirmed','')::boolean AS intent_confirmed,
           a.agent_model AS analyzed_by,
           a.ingested_at AS analyzed_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    LEFT JOIN LATERAL (
      SELECT o.structured_data, o.agent_model, o.ingested_at
      FROM vehicle_observations o
      WHERE o.structured_data->>'analysis_kind' = 'image_deep_byok'
        AND o.structured_data->>'image_id' = vi.id::text
      ORDER BY o.ingested_at DESC
      LIMIT 1
    ) a ON true
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_id IS NOT NULL AND v.is_public = true))
    ORDER BY vi.taken_at
    LIMIT 60
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ws.id,
           'title', COALESCE(ws.title, ws.work_type, 'work session'),
           'vehicle_id', ws.vehicle_id,
           'duration_minutes', ws.duration_minutes,
           'total_job_cost', CASE WHEN v_is_owner THEN ws.total_job_cost ELSE NULL END
         ) ORDER BY ws.start_time NULLS LAST), '[]'::jsonb)
  INTO v_work
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id AND ws.session_date = p_date;

  IF v_is_owner THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', r.id, 'vendor', r.vendor_name, 'total', r.total_amount,
             'vehicle_id', r.vehicle_id) ORDER BY r.total_amount DESC NULLS LAST), '[]'::jsonb)
    INTO v_receipts
    FROM receipts r
    WHERE r.user_id = p_user_id
      AND p_date IN (r.transaction_date, r.purchase_date, r.receipt_date);
  END IF;

  v_facets := jsonb_build_object(
    'photos', jsonb_array_length(v_photos),
    'work', jsonb_array_length(v_work),
    'receipts', jsonb_array_length(v_receipts)
  );

  RETURN jsonb_build_object(
    'date', p_date,
    'is_owner_view', v_is_owner,
    'photos', v_photos,
    'work_sessions', v_work,
    'receipts', v_receipts,
    'facets', v_facets
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_photo_intent(p_image_id uuid, p_intent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_updated int := 0;
BEGIN
  SELECT user_id INTO v_owner FROM vehicle_images WHERE id = p_image_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF p_intent NOT IN ('labor','inspection','parts_sourcing','communication','acquisition','documentation') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_intent');
  END IF;

  UPDATE vehicle_observations o
  SET structured_data = o.structured_data || jsonb_build_object(
        'intent_owner_confirmed', true,
        'intent_confirmed_value', p_intent,
        'intent_confirmed_by', auth.uid(),
        'intent_confirmed_at', now()
      )
  WHERE o.structured_data->>'analysis_kind' = 'image_deep_byok'
    AND o.structured_data->>'image_id' = p_image_id::text;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'image_id', p_image_id, 'intent', p_intent, 'updated', v_updated);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_photo_intent(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_photo_intent(uuid, text) TO authenticated;
