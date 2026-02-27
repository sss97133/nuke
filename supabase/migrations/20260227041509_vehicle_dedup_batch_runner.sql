-- Server-side batch dedup function — runs entirely in PL/pgSQL, no HTTP timeout issues.
-- Processes up to max_ops vehicle merges per call.
-- Uses merge_into_primary() (created in earlier migration) for each pair.
CREATE OR REPLACE FUNCTION run_vehicle_dedup_batch(max_ops INT DEFAULT 2000)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_rec RECORD;
  v_primary_id UUID;
  v_merged INT := 0;
  v_result JSONB;
  v_errors INT := 0;
BEGIN
  -- Process groups one at a time. Without index, this is a full scan
  -- but server-side so no HTTP timeout constraint.
  FOR v_rec IN
    SELECT listing_url,
           array_agg(id ORDER BY created_at ASC, id ASC) as ids
    FROM vehicles
    WHERE listing_url IS NOT NULL
      AND listing_url != ''
      AND (status IS DISTINCT FROM 'merged')
      AND merged_into_vehicle_id IS NULL
    GROUP BY listing_url
    HAVING COUNT(*) > 1
  LOOP
    EXIT WHEN v_merged >= max_ops;

    v_primary_id := v_rec.ids[1];

    FOR i IN 2..array_length(v_rec.ids, 1) LOOP
      EXIT WHEN v_merged >= max_ops;
      BEGIN
        SELECT merge_into_primary(v_primary_id, v_rec.ids[i]) INTO v_result;
        IF NOT (v_result ? 'skipped') THEN
          v_merged := v_merged + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('merged', v_merged, 'errors', v_errors);
END;
$$;
