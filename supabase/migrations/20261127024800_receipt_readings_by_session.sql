-- Reverse the cited-photo edge: one authorized work session to the receipt
-- readings whose cited photos actually belong to it. This is evidence context,
-- not an item installation, financial allocation, or labor calculation.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_vehicle_receipt_readings_for_session(p_vehicle_id uuid, p_session_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
  WITH session_access AS MATERIALIZED (
    -- SECURITY INVOKER deliberately keeps the work_sessions row policy active.
    SELECT 1 FROM public.work_sessions s WHERE s.id = p_session_id AND s.vehicle_id = p_vehicle_id
  ), receipt_read AS MATERIALIZED (
    SELECT public.get_vehicle_receipt_work_context(p_vehicle_id, NULL) AS data
     WHERE EXISTS (SELECT 1 FROM session_access)
  ), matches AS (
    SELECT l.value ->> 'evidence_id' AS evidence_id, r.reading ->> 'question_id' AS question_id,
           l.value ->> 'receipt_id' AS receipt_id, l.value ->> 'item_id' AS item_id,
           (l.value ->> 'line_number')::int AS line_number, l.value ->> 'description' AS description,
           l.value ->> 'part_number' AS part_number, l.value ->> 'anchor_date' AS source_date,
           l.value ->> 'anchor_source' AS source_date_basis, r.kind, r.reading,
           r.reading #>> '{answer,frame_context,photo_taken_at}' AS photo_taken_at
      FROM receipt_read d
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.data -> 'lines', '[]'::jsonb)) l(value)
      CROSS JOIN LATERAL (VALUES ('current', l.value -> 'judgment'),
                                 ('historical', l.value -> 'historical_judgment')) r(kind, reading)
     WHERE d.data ->> 'visible' = 'true' AND r.reading ->> 'status' = 'answered'
       AND r.reading #>> '{answer,frame_context,session,id}' = p_session_id::text
       AND l.value ->> 'receipt_id' IS NOT NULL AND l.value ->> 'item_id' IS NOT NULL
  )
  SELECT jsonb_build_object(
    'available', coalesce((SELECT data ->> 'visible' = 'true' FROM receipt_read), false),
    'readings', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'evidence_id', evidence_id, 'question_id', question_id,
      'receipt_id', receipt_id, 'item_id', item_id, 'line_number', line_number,
      'description', description, 'part_number', part_number, 'reading_status', kind,
      'source_date', source_date, 'source_date_basis', source_date_basis,
      'photo_id', reading #>> '{answer,frame_context,image_id}', 'photo_taken_at', photo_taken_at,
      'visible', reading #>> '{answer,visible}', 'installed', reading #>> '{answer,installed}')
      ORDER BY receipt_id, line_number NULLS FIRST, item_id, kind) FROM matches), '[]'::jsonb))
$fn$;

REVOKE ALL ON FUNCTION public.get_vehicle_receipt_readings_for_session(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vehicle_receipt_readings_for_session(uuid,uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_vehicle_receipt_readings_for_session(uuid,uuid) IS
  'Authorized session to source receipt readings via each cited photo session FK. Current and historical testimony remain separate; no work value or allocation is asserted.';
