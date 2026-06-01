-- Day-card / build-log RPCs were rendering gate-rejected, personal, duplicate,
-- and superseded images. The main gallery (loadVehicleData.ts:143) already filters
-- vision_gate_status IN ('rejected_personal','rejected_misattributed','rejected'),
-- but get_daily_work_receipt and get_vehicle_work_dates did not — so misattributed
-- photos (e.g. a maroon Cheyenne K10, a K5 Blazer, an airplane) and personal shots
-- (deposit slips, Telegram screenshots) leaked onto the K2500 day cards.
--
-- This is a display filter only. No testimony is touched (trust-invariant safe).
-- The wrongly-attributed rows remain on the vehicle and must still be REATTRIBUTED
-- (ghost-vehicle / relink) in a follow-up — this just stops them rendering.

CREATE OR REPLACE FUNCTION public.get_daily_work_receipt(p_vehicle_id uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
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
  AND (vi.vision_gate_status IS NULL OR vi.vision_gate_status::text NOT IN ('rejected_personal', 'rejected_misattributed', 'rejected'))
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

  RETURN result;
END;
$function$;

-- get_vehicle_work_dates: total_photos count must use the same filter so the
-- timeline badge counts match what actually renders.
CREATE OR REPLACE FUNCTION public.get_vehicle_work_dates(p_vehicle_id uuid, p_start_date date DEFAULT '2026-02-27'::date, p_end_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
BEGIN
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

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'date_range', jsonb_build_object('start', p_start_date, 'end', p_end_date),
    'total_sessions', jsonb_array_length(result),
    'total_photos', (
      SELECT count(*) FROM vehicle_images
      WHERE vehicle_id = p_vehicle_id
      AND taken_at::date BETWEEN p_start_date AND p_end_date
      AND (vision_gate_status IS NULL OR vision_gate_status::text NOT IN ('rejected_personal', 'rejected_misattributed', 'rejected'))
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
END;
$function$;
