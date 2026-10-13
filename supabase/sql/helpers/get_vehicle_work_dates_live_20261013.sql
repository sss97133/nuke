-- The live definition of public.get_vehicle_work_dates(uuid, date, date) as read from production on
-- 2026-10-13 16:35Z (source hash edwpMUVMNmyIQFg0gTuDcEYU+KZJtzd/JLly7GJX1+U=), kept so the contract
-- can start from the deployed state before applying 20261013164500_day_receipt_money_owner_only.sql.
CREATE OR REPLACE FUNCTION public.get_vehicle_work_dates(p_vehicle_id uuid, p_start_date date DEFAULT '2026-02-27'::date, p_end_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
END;
$function$
;
