-- ============================================================================
-- GPS IMAGE→VEHICLE MATCH RPC + PULSE INDEX FIX
-- Filed: 2026-06-10
--
-- 1. auto_match_image_to_vehicles: photo-pipeline-orchestrator's resolveVehicle
--    Strategy 2 (GPS) calls this RPC — probed live: HTTP 404 / PGRST202, the
--    function NEVER EXISTED. The error is swallowed (maybeSingle → null), so
--    GPS-based filing of phone photos has silently never worked. This
--    implements it: same-user images with GPS within ~500m and a recency
--    bias. Cross-user matches are scored below the orchestrator's 0.7
--    threshold by construction — location alone must not move a photo onto
--    a stranger's vehicle.
--
-- 2. vehicle_images(created_at) index: get_pipeline_pulse's daily-images scan
--    timed out when probed (existing indexes are composite (vehicle_id,
--    created_at) / (user_id, created_at) — useless for a bare created_at
--    range). Also fixes the SystemStatus recent-images query.
-- ============================================================================

-- Partial GPS index: most of the ~30M rows are scraped (no GPS), so this
-- stays small and makes the bounding-box probe an index range scan.
CREATE INDEX IF NOT EXISTS idx_vehicle_images_gps
  ON vehicle_images (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_images_created_at
  ON vehicle_images (created_at DESC);

CREATE OR REPLACE FUNCTION auto_match_image_to_vehicles(
  p_image_id UUID,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_taken_at TIMESTAMPTZ DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (vehicle_id UUID, confidence NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5s'
AS $$
DECLARE
  -- ~500m bounding box (1 deg lat ≈ 111km; lon scaled by cos(lat))
  v_lat_delta DOUBLE PRECISION := 0.0045;
  v_lon_delta DOUBLE PRECISION := 0.0045 / GREATEST(cos(radians(p_latitude)), 0.2);
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    vi.vehicle_id,
    ROUND(GREATEST(0.05,
      0.95
      -- distance decay: ~0.05 per 100m (haversine approximation)
      - LEAST(
          (111320.0 * sqrt(
            pow(vi.latitude - p_latitude, 2) +
            pow((vi.longitude - p_longitude) * cos(radians(p_latitude)), 2)
          )) / 100.0 * 0.05,
          0.30)
      -- ownership: photos by someone else cap below the 0.7 assign threshold
      - CASE WHEN p_user_id IS NOT NULL AND vi.user_id = p_user_id THEN 0.0 ELSE 0.35 END
      -- recency: prior photo older than ~6 months loses up to 0.15
      - CASE WHEN p_taken_at IS NOT NULL AND vi.taken_at IS NOT NULL
             THEN LEAST(abs(EXTRACT(EPOCH FROM (p_taken_at - vi.taken_at))) / 86400.0 / 180.0 * 0.15, 0.15)
             ELSE 0.10 END
    )::numeric, 3) AS confidence
  FROM vehicle_images vi
  WHERE vi.latitude  BETWEEN p_latitude  - v_lat_delta AND p_latitude  + v_lat_delta
    AND vi.longitude BETWEEN p_longitude - v_lon_delta AND p_longitude + v_lon_delta
    AND vi.vehicle_id IS NOT NULL
    AND vi.id IS DISTINCT FROM p_image_id
    AND COALESCE(vi.is_duplicate, false) = false
  ORDER BY confidence DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_match_image_to_vehicles(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, UUID) TO anon, authenticated, service_role;
