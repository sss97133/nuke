-- Final optimizations with correct column names

-- 1. Create optimized function to get recent vehicle activity efficiently
CREATE OR REPLACE FUNCTION get_vehicle_activity_summary(p_vehicle_id UUID)
RETURNS TABLE (
  vehicle_id UUID,
  total_images INTEGER,
  recent_images INTEGER,
  ai_tags_count INTEGER,
  timeline_events_count INTEGER,
  total_labor_hours NUMERIC,
  last_image_date TIMESTAMP,
  confidence_score NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH vehicle_stats AS (
    SELECT
      v.id as vehicle_id,
      COALESCE(img_stats.total_images, 0) as total_images,
      COALESCE(img_stats.recent_images, 0) as recent_images,
      COALESCE(img_stats.last_image_date, v.created_at) as last_image_date,
      COALESCE(tag_stats.ai_tags_count, 0) as ai_tags_count,
      COALESCE(tag_stats.avg_confidence, 0) as confidence_score,
      COALESCE(event_stats.timeline_events_count, 0) as timeline_events_count,
      COALESCE(event_stats.total_labor_hours, 0) as total_labor_hours
    FROM vehicles v
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) as total_images,
        COUNT(*) FILTER (WHERE vi.created_at > NOW() - INTERVAL '30 days') as recent_images,
        MAX(vi.created_at) as last_image_date
      FROM vehicle_images vi
      WHERE vi.vehicle_id = v.id
    ) img_stats ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT it.id) as ai_tags_count,
        AVG(it.confidence) as avg_confidence
      FROM vehicle_images vi
      JOIN image_tags it ON vi.id = it.image_id
      WHERE vi.vehicle_id = v.id
        AND it.confidence > 0.5
    ) tag_stats ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) as timeline_events_count,
        SUM(te.labor_hours) as total_labor_hours
      FROM timeline_events te
      WHERE te.vehicle_id = v.id
        AND te.labor_hours IS NOT NULL
        AND te.labor_hours > 0
    ) event_stats ON true
    WHERE v.id = p_vehicle_id
  )
  SELECT * FROM vehicle_stats;
END;
$$;

-- 2. Create optimized valuation lookup with caching
CREATE OR REPLACE FUNCTION get_cached_vehicle_valuation(p_vehicle_id UUID)
RETURNS TABLE (
  vehicle_id UUID,
  estimated_value NUMERIC,
  confidence_score NUMERIC,
  investment_total NUMERIC,
  data_sources TEXT[],
  needs_refresh BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  cache_valid BOOLEAN := false;
BEGIN
  -- Check if we have a recent valuation cache
  SELECT EXISTS(
    SELECT 1 FROM vehicle_valuations_cache vc
    WHERE vc.vehicle_id = p_vehicle_id
    AND vc.cached_at > NOW() - INTERVAL '4 hours'
  ) INTO cache_valid;

  IF cache_valid THEN
    -- Return cached data
    RETURN QUERY
    SELECT
      vc.vehicle_id,
      vc.estimated_value,
      vc.confidence_score,
      COALESCE(vc.parts_value, 0) + COALESCE(vc.labor_value, 0) as investment_total,
      vc.data_sources,
      false as needs_refresh
    FROM vehicle_valuations_cache vc
    WHERE vc.vehicle_id = p_vehicle_id;
  ELSE
    -- Calculate fresh and cache it
    RETURN QUERY
    WITH fresh_valuation AS (
      SELECT * FROM calculate_ai_vehicle_valuation(p_vehicle_id)
    )
    SELECT
      p_vehicle_id,
      fv.estimated_value,
      fv.confidence_score,
      COALESCE(fv.parts_value, 0) + COALESCE(fv.labor_value, 0) as investment_total,
      fv.data_sources,
      true as needs_refresh
    FROM fresh_valuation fv;

    -- Cache the result
    INSERT INTO vehicle_valuations_cache (
      vehicle_id, estimated_value, confidence_score, parts_value, labor_value,
      base_value, data_sources, cached_at
    )
    SELECT
      p_vehicle_id, fv.estimated_value, fv.confidence_score, fv.parts_value,
      fv.labor_value, fv.base_value, fv.data_sources, NOW()
    FROM calculate_ai_vehicle_valuation(p_vehicle_id) fv
    ON CONFLICT (vehicle_id) DO UPDATE SET
      estimated_value = EXCLUDED.estimated_value,
      confidence_score = EXCLUDED.confidence_score,
      parts_value = EXCLUDED.parts_value,
      labor_value = EXCLUDED.labor_value,
      base_value = EXCLUDED.base_value,
      data_sources = EXCLUDED.data_sources,
      cached_at = NOW();
  END IF;
END;
$$;

-- 3. Create optimized batch processing function
CREATE OR REPLACE FUNCTION get_pending_ai_analysis_batch()
RETURNS TABLE (
  image_id UUID,
  vehicle_id UUID,
  image_url TEXT,
  priority INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.id as image_id,
    vi.vehicle_id,
    vi.image_url,
    CASE
      -- Higher priority for recent uploads
      WHEN vi.created_at > NOW() - INTERVAL '7 days' THEN 3
      WHEN vi.created_at > NOW() - INTERVAL '30 days' THEN 2
      ELSE 1
    END as priority
  FROM vehicle_images vi
  WHERE NOT EXISTS (
    SELECT 1 FROM image_tags it
    WHERE it.image_id = vi.id
    AND it.metadata->>'ai_supervised' = 'true'
  )
  AND vi.image_url IS NOT NULL
  ORDER BY priority DESC, vi.created_at DESC
  LIMIT 50;  -- Reasonable batch size
END;
$$;

-- 4. Test the optimized functions
SELECT 'Testing optimized functions...' as status;

-- Test activity summary
SELECT 'Activity summary test:' as test;
SELECT * FROM get_vehicle_activity_summary('e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid);

-- Test cached valuation
SELECT 'Cached valuation test:' as test;
SELECT * FROM get_cached_vehicle_valuation('e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid);

-- Test batch processing
SELECT 'Batch processing test:' as test;
SELECT COUNT(*) as pending_analysis FROM get_pending_ai_analysis_batch();

SELECT 'Database optimization complete!' as status;