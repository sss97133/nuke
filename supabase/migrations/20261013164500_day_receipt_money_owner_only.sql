-- Money on the day receipt and the work calendar is the owner's.
--
-- Measured 2026-10-13 16:20Z as an anonymous caller: get_daily_work_receipt (SECURITY DEFINER, EXECUTE
-- for anon) returned a work session's total_labor_cost and total_job_cost for a public vehicle, and
-- get_vehicle_work_dates returns each session's total_parts_cost and the range's total_parts_spend.
-- Neither checked that the vehicle is public. Both now resolve the caller once: the signed-in owner,
-- uploader or a contributor with access (vehicle_user_has_access) sees money; everyone else gets the
-- same record with every money-bearing key set to null (jsonb_mask_money) and money_masked = true,
-- so the page can show "$•••" rather than nothing; a private vehicle reads as NULL for anyone its
-- policies exclude. Photos, descriptions, counts and has_receipts are unchanged: masking, not hiding.
-- Same signatures, grants and SECURITY DEFINER (the readers join tables anon cannot read directly).
-- Built from the live definitions (supabase/sql/helpers/*_live_20261013.sql), guarded by their hashes.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s';

DO $guard$
DECLARE a text; b text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO a FROM pg_proc WHERE oid = 'public.get_daily_work_receipt(uuid,date)'::regprocedure;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO b FROM pg_proc WHERE oid = 'public.get_vehicle_work_dates(uuid,date,date)'::regprocedure;
  IF a NOT IN ('dEbWdXTdwfeWQfuZrNa3GQ8bk3giryAXcT9t+8//t5o=', 'cIgepeai/3s1iJamZ3Zqkd0YT9iiH7blsnJ3AKV9qxc=')
     OR b NOT IN ('edwpMUVMNmyIQFg0gTuDcEYU+KZJtzd/JLly7GJX1+U=', 'MDeWt4FuaZXBFl0R+5VO0u3u4g5w39G/lGGPU0tKYCM=') THEN
    RAISE EXCEPTION 'get_daily_work_receipt or get_vehicle_work_dates differs from the reviewed definition';
  END IF;
  IF to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_user_has_access is missing';
  END IF;
END $guard$;

-- Every money-bearing key in a document set to null, at any depth. Counts, flags, names and clocks stay.
CREATE OR REPLACE FUNCTION public.jsonb_mask_money(j jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (m.keys) THEN 'null'::jsonb ELSE public.jsonb_mask_money(e.v) END)
      FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(public.jsonb_mask_money(a.e) ORDER BY a.o)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, o)), '[]'::jsonb)
    ELSE j END
  FROM (SELECT ARRAY['total', 'total_amount', 'unit_price', 'price', 'amount', 'subtotal', 'tax', 'tax_amount',
                     'shipping', 'discount', 'cost', 'cost_cents', 'cost_amount', 'cost_estimate', 'parts_cost_cents',
                     'total_cost_cents', 'labor_cost_cents', 'total_parts_cost', 'total_labor_cost', 'total_job_cost',
                     'parts_total', 'labor_cost', 'parts_cost', 'grand_total', 'line_total', 'total_parts_spend',
                     'hourly_rate', 'labor_rate']::text[] AS keys) m;
$$;
COMMENT ON FUNCTION public.jsonb_mask_money(jsonb) IS
  'Returns the document with every money-bearing key (totals, amounts, prices, costs, rates) set to null at any depth; counts, flags, names and clocks are kept. Used by readers that serve one record to owners and readers alike.';
REVOKE ALL ON FUNCTION public.jsonb_mask_money(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jsonb_mask_money(jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_daily_work_receipt(p_vehicle_id uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  v_uid uuid := auth.uid();
  v_money boolean := false;
  v_visible boolean := false;
  v_session_id uuid;
  v_vehicle_info jsonb;
  v_photos jsonb;
  v_receipts jsonb;
  v_events jsonb;
  v_line_items jsonb;
  v_session_info jsonb;
BEGIN
  -- Get vehicle info
  SELECT jsonb_build_object(
    'id', v.id,
    'year', v.year,
    'make', v.make,
    'model', v.model,
    'vin', v.vin,
    'trim', v.trim
  ) INTO v_vehicle_info
  FROM vehicles v WHERE v.id = p_vehicle_id;

  IF v_vehicle_info IS NULL THEN
    RETURN jsonb_build_object('error', 'Vehicle not found');
  END IF;

  -- Money is the owner's (owner rule, 2026-09-28): costs, receipts and line-item prices reach the
  -- signed-in owner, uploader or a contributor with access; every other caller gets the same record
  -- with its money masked. A private vehicle reads as NULL for anyone its policies exclude.
  SELECT v_uid IS NOT NULL AND (v.user_id = v_uid OR v.owner_id = v_uid OR v.uploaded_by = v_uid
           OR public.vehicle_user_has_access(v.id, v_uid)),
         coalesce(v.is_public, false)
    INTO v_money, v_visible
  FROM vehicles v WHERE v.id = p_vehicle_id;
  IF NOT (coalesce(v_visible, false) OR coalesce(v_money, false)) THEN
    RETURN NULL;
  END IF;

  -- Get work session for this date (if exists)
  SELECT id INTO v_session_id
  FROM work_sessions
  WHERE vehicle_id = p_vehicle_id
  AND session_date = p_date
  LIMIT 1;

  -- Get session info
  SELECT jsonb_build_object(
    'id', ws.id,
    'title', ws.title,
    'session_date', ws.session_date,
    'start_time', ws.start_time,
    'end_time', ws.end_time,
    'duration_minutes', ws.duration_minutes,
    'work_type', ws.work_type,
    'work_description', ws.work_description,
    'status', ws.status,
    'total_parts_cost', ws.total_parts_cost,
    'total_labor_cost', ws.total_labor_cost,
    'total_job_cost', ws.total_job_cost,
    'image_count', ws.image_count
  ) INTO v_session_info
  FROM work_sessions ws
  WHERE ws.id = v_session_id;

  -- Get photos for this date (with thumbnails)
  -- FILTER: exclude gate-rejected, personal, duplicate, and superseded images.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', vi.id,
      'image_url', vi.image_url,
      'thumbnail_url', COALESCE(vi.thumbnail_url, vi.image_url),
      'taken_at', vi.taken_at,
      'source', vi.source,
      'file_name', vi.file_name,
      'area', vi.area,
      'part', vi.part,
      'operation', vi.operation,
      'fabrication_stage', vi.fabrication_stage,
      'image_type', vi.image_type,
      'category', vi.category,
      'caption', vi.caption
    ) ORDER BY vi.taken_at
  ), '[]'::jsonb) INTO v_photos
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
  AND vi.taken_at::date = p_date
  AND (vi.vision_gate_status IS NULL OR vi.vision_gate_status::text NOT IN ('rejected_personal', 'rejected_misattributed'))
  AND vi.is_duplicate IS NOT TRUE
  AND vi.is_superseded IS NOT TRUE;

  -- Get receipts/parts for this date
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'vendor_name', r.vendor_name,
      'receipt_date', r.receipt_date,
      'total', r.total,
      'total_amount', r.total_amount,
      'items', r.raw_json->'items',
      'order_number', COALESCE(r.raw_json->>'order_number', r.invoice_number),
      'payment_method', r.payment_method
    ) ORDER BY r.vendor_name
  ), '[]'::jsonb) INTO v_receipts
  FROM receipts r
  WHERE r.vehicle_id = p_vehicle_id
  AND r.receipt_date = p_date;

  -- Get component events for this date
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ce.id,
      'event_type', ce.event_type,
      'event_date', ce.event_date,
      'description', ce.description,
      'component_table', ce.component_table,
      'cost_cents', ce.cost_cents,
      'work_order_id', ce.work_order_id
    ) ORDER BY ce.event_date
  ), '[]'::jsonb) INTO v_events
  FROM component_events ce
  WHERE ce.work_order_id IN (
    SELECT wo.id FROM work_orders wo WHERE wo.vehicle_id = p_vehicle_id
  )
  AND ce.event_date = p_date;

  -- Get work order line items that are relevant to this date's events
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'line_number', li.line_number,
      'task_type', li.task_type,
      'task_description', li.task_description,
      'hours_labor', li.hours_labor,
      'parts_cost_cents', li.parts_cost_cents,
      'total_cost_cents', li.total_cost_cents,
      'status', li.status,
      'notes', li.notes
    ) ORDER BY li.line_number
  ), '[]'::jsonb) INTO v_line_items
  FROM work_order_line_items li
  WHERE li.component_event_id IN (
    SELECT ce.id FROM component_events ce
    WHERE ce.work_order_id IN (
      SELECT wo.id FROM work_orders wo WHERE wo.vehicle_id = p_vehicle_id
    )
    AND ce.event_date = p_date
  );

  -- Build the final receipt
  result := jsonb_build_object(
    'receipt_date', p_date,
    'vehicle', v_vehicle_info,
    'work_session', COALESCE(v_session_info, 'null'::jsonb),
    'photos', v_photos,
    'photo_count', jsonb_array_length(v_photos),
    'receipts', v_receipts,
    'parts_count', (
      SELECT COALESCE(sum(jsonb_array_length(r.raw_json->'items')), 0)
      FROM receipts r
      WHERE r.vehicle_id = p_vehicle_id AND r.receipt_date = p_date
    ),
    'parts_total', (
      SELECT COALESCE(sum(r.total::numeric), 0)
      FROM receipts r
      WHERE r.vehicle_id = p_vehicle_id AND r.receipt_date = p_date
    ),
    'component_events', v_events,
    'line_items', v_line_items,
    'summary', jsonb_build_object(
      'has_photos', jsonb_array_length(v_photos) > 0,
      'has_parts', jsonb_array_length(v_receipts) > 0,
      'has_events', jsonb_array_length(v_events) > 0,
      'has_session', v_session_id IS NOT NULL,
      'activity_level', CASE
        WHEN jsonb_array_length(v_photos) > 20 THEN 'heavy'
        WHEN jsonb_array_length(v_photos) > 5 THEN 'moderate'
        WHEN jsonb_array_length(v_photos) > 0 THEN 'light'
        WHEN jsonb_array_length(v_receipts) > 0 THEN 'parts_only'
        ELSE 'no_activity'
      END
    )
  );

  IF NOT coalesce(v_money, false) THEN
    result := public.jsonb_mask_money(result);
  END IF;
  RETURN result || jsonb_build_object('money_masked', NOT coalesce(v_money, false));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vehicle_work_dates(p_vehicle_id uuid, p_start_date date DEFAULT '2026-02-27'::date, p_end_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  v_out jsonb;
  v_uid uuid := auth.uid();
  v_money boolean := false;
  v_visible boolean := false;
BEGIN
  -- Money is the owner's (owner rule, 2026-09-28): costs, receipts and line-item prices reach the
  -- signed-in owner, uploader or a contributor with access; every other caller gets the same record
  -- with its money masked. A private vehicle reads as NULL for anyone its policies exclude.
  SELECT v_uid IS NOT NULL AND (v.user_id = v_uid OR v.owner_id = v_uid OR v.uploaded_by = v_uid
           OR public.vehicle_user_has_access(v.id, v_uid)),
         coalesce(v.is_public, false)
    INTO v_money, v_visible
  FROM vehicles v WHERE v.id = p_vehicle_id;
  IF NOT (coalesce(v_visible, false) OR coalesce(v_money, false)) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', ws.session_date,
      'title', ws.title,
      'work_type', ws.work_type,
      'image_count', ws.image_count,
      'duration_minutes', ws.duration_minutes,
      'total_parts_cost', ws.total_parts_cost,
      'has_receipts', ws.total_parts_cost > 0,
      'work_description', ws.work_description,
      'status', ws.status
    ) ORDER BY ws.session_date
  ), '[]'::jsonb) INTO result
  FROM work_sessions ws
  WHERE ws.vehicle_id = p_vehicle_id
  AND ws.session_date BETWEEN p_start_date AND p_end_date;

  v_out := jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'date_range', jsonb_build_object('start', p_start_date, 'end', p_end_date),
    'total_sessions', jsonb_array_length(result),
    'total_photos', (
      SELECT count(*) FROM vehicle_images
      WHERE vehicle_id = p_vehicle_id
      AND taken_at::date BETWEEN p_start_date AND p_end_date
      AND (vision_gate_status IS NULL OR vision_gate_status::text NOT IN ('rejected_personal', 'rejected_misattributed'))
      AND is_duplicate IS NOT TRUE
      AND is_superseded IS NOT TRUE
    ),
    'total_parts_spend', (
      SELECT COALESCE(sum(total::numeric), 0)
      FROM receipts
      WHERE vehicle_id = p_vehicle_id
      AND receipt_date BETWEEN p_start_date AND p_end_date
    ),
    'sessions', result
  );
  IF NOT coalesce(v_money, false) THEN
    v_out := public.jsonb_mask_money(v_out);
  END IF;
  RETURN v_out || jsonb_build_object('money_masked', NOT coalesce(v_money, false));
END;
$function$;

COMMIT;
