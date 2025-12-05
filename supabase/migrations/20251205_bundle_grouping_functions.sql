-- ============================================
-- BUNDLE GROUPING FUNCTIONS
-- ============================================
-- Functions to group images into bundles for analysis
-- Bundles = images taken on same date by same device

-- ============================================
-- 1. FUNCTION: Get Image Bundles for Vehicle
-- ============================================
CREATE OR REPLACE FUNCTION get_image_bundles_for_vehicle(
  p_vehicle_id UUID,
  p_min_images INTEGER DEFAULT 3
)
RETURNS TABLE (
  bundle_date DATE,
  device_fingerprint TEXT,
  image_count BIGINT,
  session_start TIMESTAMPTZ,
  session_end TIMESTAMPTZ,
  duration_minutes NUMERIC,
  image_ids UUID[],
  device_attribution JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH bundle_groups AS (
    SELECT 
      DATE(vi.taken_at) as bundle_date,
      COALESCE(da.device_fingerprint, 'Unknown-Unknown-Unknown-Unknown') as device_fingerprint,
      COUNT(*)::BIGINT as image_count,
      MIN(vi.taken_at) as session_start,
      MAX(vi.taken_at) as session_end,
      EXTRACT(EPOCH FROM (MAX(vi.taken_at) - MIN(vi.taken_at)))/60 as duration_minutes,
      array_agg(vi.id ORDER BY vi.taken_at) as image_ids,
      MAX(da.ghost_user_id) as ghost_user_id,
      MAX(da.actual_contributor_id) as actual_contributor_id,
      MAX(da.uploaded_by_user_id) as uploaded_by_user_id,
      MAX(da.attribution_source) as attribution_source,
      MAX(da.confidence_score) as confidence_score
    FROM vehicle_images vi
    LEFT JOIN device_attributions da ON da.image_id = vi.id
    WHERE vi.vehicle_id = p_vehicle_id
      AND vi.taken_at IS NOT NULL
    GROUP BY DATE(vi.taken_at), COALESCE(da.device_fingerprint, 'Unknown-Unknown-Unknown-Unknown')
    HAVING COUNT(*) >= p_min_images
  )
  SELECT 
    bg.bundle_date,
    bg.device_fingerprint,
    bg.image_count,
    bg.session_start,
    bg.session_end,
    bg.duration_minutes,
    bg.image_ids,
    jsonb_build_object(
      'device_fingerprint', bg.device_fingerprint,
      'ghost_user_id', bg.ghost_user_id,
      'actual_contributor_id', bg.actual_contributor_id,
      'uploaded_by_user_id', bg.uploaded_by_user_id,
      'attribution_source', bg.attribution_source,
      'confidence_score', bg.confidence_score
    ) as device_attribution
  FROM bundle_groups bg
  ORDER BY bg.bundle_date DESC, bg.image_count DESC;
END;
$$;

COMMENT ON FUNCTION get_image_bundles_for_vehicle IS 'Groups images into bundles by date and device for bundle analysis';

-- ============================================
-- 2. FUNCTION: Get Bundle Context
-- ============================================
CREATE OR REPLACE FUNCTION get_bundle_context(
  p_vehicle_id UUID,
  p_bundle_date DATE,
  p_device_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_bundle_images RECORD;
  v_vehicle RECORD;
  v_context JSONB;
  v_exif_data JSONB := '{}'::jsonb;
  v_gps_coordinates JSONB[] := ARRAY[]::jsonb[];
BEGIN
  -- Get vehicle data
  SELECT year, make, model, vin, color INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;

  -- Get bundle images
  SELECT 
    COUNT(*) as image_count,
    MIN(vi.taken_at) as session_start,
    MAX(vi.taken_at) as session_end,
    array_agg(vi.id ORDER BY vi.taken_at) as image_ids,
    array_agg(vi.image_url ORDER BY vi.taken_at) as image_urls
  INTO v_bundle_images
  FROM vehicle_images vi
  LEFT JOIN device_attributions da ON da.image_id = vi.id
  WHERE vi.vehicle_id = p_vehicle_id
    AND DATE(vi.taken_at) = p_bundle_date
    AND COALESCE(da.device_fingerprint, 'Unknown-Unknown-Unknown-Unknown') = p_device_fingerprint;

  -- Aggregate EXIF data
  SELECT jsonb_object_agg(key, value)
  INTO v_exif_data
  FROM (
    SELECT DISTINCT ON (key) key, value
    FROM vehicle_images vi
    LEFT JOIN device_attributions da ON da.image_id = vi.id
    CROSS JOIN LATERAL jsonb_each(vi.exif_data) AS exif(key, value)
    WHERE vi.vehicle_id = p_vehicle_id
      AND DATE(vi.taken_at) = p_bundle_date
      AND COALESCE(da.device_fingerprint, 'Unknown-Unknown-Unknown-Unknown') = p_device_fingerprint
      AND vi.exif_data IS NOT NULL
    ORDER BY key, vi.taken_at DESC
  ) exif_agg;

  -- Get GPS coordinates
  SELECT array_agg(
    jsonb_build_object(
      'lat', exif_data->'GPS'->>'latitude',
      'lon', exif_data->'GPS'->>'longitude'
    )
  )
  INTO v_gps_coordinates
  FROM vehicle_images vi
  LEFT JOIN device_attributions da ON da.image_id = vi.id
  WHERE vi.vehicle_id = p_vehicle_id
    AND DATE(vi.taken_at) = p_bundle_date
    AND COALESCE(da.device_fingerprint, 'Unknown-Unknown-Unknown-Unknown') = p_device_fingerprint
    AND vi.exif_data->'GPS' IS NOT NULL;

  -- Build context
  v_context := jsonb_build_object(
    'vehicle', jsonb_build_object(
      'id', p_vehicle_id,
      'year', v_vehicle.year,
      'make', v_vehicle.make,
      'model', v_vehicle.model,
      'vin', v_vehicle.vin,
      'color', v_vehicle.color
    ),
    'bundle', jsonb_build_object(
      'date', p_bundle_date,
      'device_fingerprint', p_device_fingerprint,
      'image_count', v_bundle_images.image_count,
      'session_start', v_bundle_images.session_start,
      'session_end', v_bundle_images.session_end,
      'duration_minutes', EXTRACT(EPOCH FROM (v_bundle_images.session_end - v_bundle_images.session_start))/60,
      'image_ids', v_bundle_images.image_ids,
      'image_urls', v_bundle_images.image_urls
    ),
    'exif_metadata', v_exif_data,
    'gps_coordinates', v_gps_coordinates
  );

  RETURN v_context;
END;
$$;

COMMENT ON FUNCTION get_bundle_context IS 'Gets full context for a bundle (vehicle + images + EXIF + GPS)';

-- ============================================
-- 3. FUNCTION: Check if Bundle Fits Vehicle Timeline
-- ============================================
CREATE OR REPLACE FUNCTION check_bundle_fits_timeline(
  p_vehicle_id UUID,
  p_bundle_date DATE,
  p_device_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle RECORD;
  v_bundle_images RECORD;
  v_timeline_events RECORD;
  v_fits BOOLEAN := true;
  v_concerns TEXT[] := ARRAY[]::TEXT[];
  v_detected_vehicle JSONB;
BEGIN
  -- Get vehicle data
  SELECT year, make, model INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;

  -- Get bundle images
  SELECT 
    COUNT(*) as image_count,
    array_agg(vi.id) as image_ids
  INTO v_bundle_images
  FROM vehicle_images vi
  LEFT JOIN device_attributions da ON da.image_id = vi.id
  WHERE vi.vehicle_id = p_vehicle_id
    AND DATE(vi.taken_at) = p_bundle_date
    AND COALESCE(da.device_fingerprint, 'Unknown-Unknown-Unknown-Unknown') = p_device_fingerprint;

  -- Check for timeline events around this date
  SELECT 
    COUNT(*) as event_count,
    array_agg(jsonb_build_object(
      'date', event_date,
      'title', title,
      'event_type', event_type
    )) as events
  INTO v_timeline_events
  FROM timeline_events
  WHERE vehicle_id = p_vehicle_id
    AND event_date BETWEEN p_bundle_date - INTERVAL '7 days' AND p_bundle_date + INTERVAL '7 days';

  -- Check if bundle date is reasonable for vehicle
  IF p_bundle_date < (v_vehicle.year || '-01-01')::DATE THEN
    v_fits := false;
    v_concerns := array_append(v_concerns, 'Bundle date is before vehicle manufacture year');
  END IF;

  IF p_bundle_date > CURRENT_DATE + INTERVAL '1 day' THEN
    v_fits := false;
    v_concerns := array_append(v_concerns, 'Bundle date is in the future');
  END IF;

  -- Check for duplicate detection (same images in multiple bundles)
  IF EXISTS (
    SELECT 1 FROM vehicle_images vi2
    WHERE vi2.id = ANY(v_bundle_images.image_ids)
    AND vi2.vehicle_id != p_vehicle_id
  ) THEN
    v_fits := false;
    v_concerns := array_append(v_concerns, 'Images appear in multiple vehicles');
  END IF;

  RETURN jsonb_build_object(
    'fits_timeline', v_fits,
    'concerns', v_concerns,
    'bundle_date', p_bundle_date,
    'vehicle_year', v_vehicle.year,
    'image_count', v_bundle_images.image_count,
    'nearby_events', v_timeline_events.events,
    'event_count', v_timeline_events.event_count
  );
END;
$$;

COMMENT ON FUNCTION check_bundle_fits_timeline IS 'Checks if a bundle fits within vehicle timeline and flags concerns';

