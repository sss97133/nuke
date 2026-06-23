-- Promote per-image depth from the JSONB verdict into the reserved columns.
--
-- The deep-analysis drain writes its full verdict into ai_scan_metadata->'byok_deep_analysis'
-- (camera_pose, components_seen[], state_observations, ...). Several first-class columns on
-- vehicle_images were created as the queryable home for that depth but were never filled —
-- they are NOT dead, they are aspirational targets the pipeline is only now producing data for
-- (see engineering-manual Ch.19). This function lifts the JSONB up into the columns so the
-- depth is indexable / joinable / visible without digging through JSONB on every read.
--
-- Mapping (verdict key -> column):
--   camera_pose       (object) -> camera_pose          jsonb
--   components_seen   (array)  -> components            jsonb
--                              -> ai_component_count    int     (length of the array)
--                              -> ai_avg_confidence     numeric (mean of element confidence)
--
-- Idempotent: only rows whose target column actually differs are touched, so re-runs after the
-- drain analyzes more frames are cheap and converge. Scope to a vehicle (drain per-batch) or a
-- user (owner backfill); the unscoped form exists but should not be run on the full table.
-- SECURITY DEFINER so the drain/app can call it; no model spend.

CREATE OR REPLACE FUNCTION public.promote_image_depth_to_columns(
  p_vehicle_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_count bigint;
BEGIN
  IF p_vehicle_id IS NULL AND p_user_id IS NULL THEN
    RAISE EXCEPTION 'promote_image_depth_to_columns requires p_vehicle_id or p_user_id (refusing full-table scan)';
  END IF;

  WITH src AS (
    SELECT vi.id,
           vi.ai_scan_metadata->'byok_deep_analysis' AS da
    FROM vehicle_images vi
    WHERE vi.ai_scan_metadata ? 'byok_deep_analysis'
      AND (p_vehicle_id IS NULL OR vi.vehicle_id = p_vehicle_id)
      AND (p_user_id    IS NULL OR vi.user_id    = p_user_id)
  ),
  computed AS (
    SELECT s.id,
           CASE WHEN jsonb_typeof(s.da->'components_seen') = 'array'
                THEN s.da->'components_seen' END AS comp,
           CASE WHEN jsonb_typeof(s.da->'camera_pose') = 'object'
                THEN s.da->'camera_pose' END AS pose,
           CASE WHEN jsonb_typeof(s.da->'components_seen') = 'array'
                THEN jsonb_array_length(s.da->'components_seen') END AS cc,
           (
             SELECT round(avg((e->>'confidence')::numeric), 4)
             FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(s.da->'components_seen') = 'array'
                    THEN s.da->'components_seen' ELSE '[]'::jsonb END) AS e
             WHERE (e->>'confidence') ~ '^[0-9]*\.?[0-9]+$'
           ) AS avgc
    FROM src s
  )
  UPDATE vehicle_images vi
  SET components         = COALESCE(c.comp, vi.components),
      camera_pose        = COALESCE(c.pose, vi.camera_pose),
      ai_component_count = COALESCE(c.cc,   vi.ai_component_count),
      ai_avg_confidence  = COALESCE(c.avgc, vi.ai_avg_confidence)
  FROM computed c
  WHERE vi.id = c.id
    AND (
      (c.comp IS NOT NULL AND vi.components         IS DISTINCT FROM c.comp) OR
      (c.pose IS NOT NULL AND vi.camera_pose        IS DISTINCT FROM c.pose) OR
      (c.cc   IS NOT NULL AND vi.ai_component_count IS DISTINCT FROM c.cc)   OR
      (c.avgc IS NOT NULL AND vi.ai_avg_confidence  IS DISTINCT FROM c.avgc)
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.promote_image_depth_to_columns(uuid, uuid) IS
  'Lift per-image depth (camera_pose, components_seen) from ai_scan_metadata->byok_deep_analysis '
  'into the first-class columns camera_pose/components/ai_component_count/ai_avg_confidence. '
  'Idempotent, vehicle- or user-scoped. The columns are aspirational targets the pipeline now '
  'fills (Ch.19), not dead columns. No model spend.';
