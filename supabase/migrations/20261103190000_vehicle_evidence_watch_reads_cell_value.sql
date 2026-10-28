-- The heartbeat cell is stored by ingest_financial_evidence as {"value": {...}}; the watch read the unwrapped shape and so reported
-- "never" while the local job was reporting. Read the cell value, unwrapped or not.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.check_vehicle_evidence_job(p_max_age interval DEFAULT interval '14 hours')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_at timestamptz; v_val jsonb;
BEGIN
  SELECT (c.v->>'at')::timestamptz, c.v INTO v_at, v_val
    FROM (SELECT coalesce(e.value_normalized->'value', e.value_normalized) AS v
            FROM financial_document_extractions e
           WHERE e.field_key = 'job_heartbeat' AND NOT e.is_superseded) c
   WHERE c.v->>'job' = 'vehicle-evidence'
   ORDER BY (c.v->>'at')::timestamptz DESC LIMIT 1;
  IF v_at IS NULL OR v_at < now() - p_max_age THEN
    RAISE EXCEPTION 'vehicle-evidence local job has not reported since % (limit %)', coalesce(v_at::text, 'never'), p_max_age;
  END IF;
  RETURN jsonb_build_object('last_heartbeat', v_at, 'last_run', v_val - 'job');
END
$$;

COMMIT;
