-- Optimize data pipelines and database utilization
-- Create materialized views and indexes for better performance

-- 1. Materialized view for vehicle valuations (refreshed hourly)
CREATE MATERIALIZED VIEW IF NOT EXISTS vehicle_valuations_cache AS
SELECT
  v.id as vehicle_id,
  v.make,
  v.model,
  v.year,
  av.estimated_value,
  av.confidence_score,
  av.parts_value,
  av.labor_value,
  av.base_value,
  av.data_sources,
  NOW() as cached_at
FROM vehicles v
LEFT JOIN LATERAL calculate_ai_vehicle_valuation(v.id) av ON true
WHERE v.created_at > NOW() - INTERVAL '2 years'; -- Only cache recent vehicles

-- Index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_valuations_cache_pkey ON vehicle_valuations_cache (vehicle_id);
CREATE INDEX IF NOT EXISTS vehicle_valuations_cache_make_model_year ON vehicle_valuations_cache (make, model, year);

-- 2. Materialized view for work session summaries
CREATE MATERIALIZED VIEW IF NOT EXISTS vehicle_work_sessions_cache AS
SELECT
  vehicle_id,
  DATE(taken_at) as work_date,
  COUNT(*) as image_count,
  ARRAY_AGG(DISTINCT COALESCE(it.metadata->>'category', 'unknown')) as categories_worked,
  COUNT(DISTINCT it.metadata->>'category') as unique_categories,
  AVG(it.confidence) as avg_ai_confidence,
  -- Link to timeline events labor
  COALESCE((
    SELECT SUM(te.labor_hours)
    FROM timeline_events te
    WHERE te.vehicle_id = vi.vehicle_id
    AND DATE(te.event_date) = DATE(vi.taken_at)
  ), 0) as documented_labor_hours
FROM vehicle_images vi
LEFT JOIN image_tags it ON vi.id = it.image_id
WHERE vi.taken_at IS NOT NULL
  AND vi.taken_at > NOW() - INTERVAL '2 years'
GROUP BY vehicle_id, DATE(taken_at)
HAVING COUNT(*) >= 3; -- Only significant work sessions

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_work_sessions_cache_pkey ON vehicle_work_sessions_cache (vehicle_id, work_date);
CREATE INDEX IF NOT EXISTS vehicle_work_sessions_cache_vehicle ON vehicle_work_sessions_cache (vehicle_id);

-- 3. Function to refresh caches efficiently
CREATE OR REPLACE FUNCTION refresh_valuation_caches()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Refresh materialized views
  REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuations_cache;
  REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_work_sessions_cache;

  -- Log the refresh
  INSERT INTO system_logs (log_type, message, created_at)
  VALUES ('cache_refresh', 'Refreshed valuation caches', NOW());
END;
$$;

-- 4. Create system_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS system_logs (
  id SERIAL PRIMARY KEY,
  log_type VARCHAR(50),
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Create optimized indexes for common queries

-- Image tags by vehicle and confidence
CREATE INDEX IF NOT EXISTS image_tags_vehicle_confidence ON image_tags (vehicle_id, confidence DESC)
WHERE confidence > 0.7;

-- Timeline events by vehicle and labor hours
CREATE INDEX IF NOT EXISTS timeline_events_vehicle_labor ON timeline_events (vehicle_id, event_date)
WHERE labor_hours IS NOT NULL AND labor_hours > 0;

-- Vehicle images by date taken
CREATE INDEX IF NOT EXISTS vehicle_images_taken_date ON vehicle_images (vehicle_id, taken_at)
WHERE taken_at IS NOT NULL;

-- Receipts by scope
CREATE INDEX IF NOT EXISTS receipts_scope ON receipts (scope_type, scope_id)
WHERE is_active = true;

-- 6. Function to batch process new images for AI analysis
CREATE OR REPLACE FUNCTION queue_images_for_ai_analysis()
RETURNS TABLE (
  image_id UUID,
  vehicle_id UUID,
  priority INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.id as image_id,
    vi.vehicle_id,
    CASE
      -- Higher priority for vehicles with recent activity
      WHEN vi.uploaded_at > NOW() - INTERVAL '7 days' THEN 3
      WHEN vi.uploaded_at > NOW() - INTERVAL '30 days' THEN 2
      ELSE 1
    END as priority
  FROM vehicle_images vi
  LEFT JOIN image_tags it ON vi.id = it.image_id
  WHERE it.id IS NULL  -- No AI tags yet
    OR (it.metadata->>'ai_supervised' != 'true')  -- Not fully processed
  ORDER BY priority DESC, vi.uploaded_at DESC
  LIMIT 100;  -- Batch size
END;
$$;

-- 7. Aggregate table for vehicle statistics (updated via triggers)
CREATE TABLE IF NOT EXISTS vehicle_stats_cache (
  vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  total_images INTEGER DEFAULT 0,
  total_ai_tags INTEGER DEFAULT 0,
  total_labor_hours NUMERIC DEFAULT 0,
  total_receipts_value NUMERIC DEFAULT 0,
  last_activity_date DATE,
  confidence_score INTEGER DEFAULT 0,
  systems_worked TEXT[] DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Function to update vehicle stats
CREATE OR REPLACE FUNCTION update_vehicle_stats(p_vehicle_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_stats RECORD;
BEGIN
  -- Calculate stats
  SELECT
    COUNT(DISTINCT vi.id) as total_images,
    COUNT(DISTINCT it.id) as total_ai_tags,
    COALESCE(SUM(te.labor_hours), 0) as total_labor_hours,
    COALESCE(SUM(r.total_amount), 0) as total_receipts_value,
    MAX(GREATEST(
      COALESCE(vi.uploaded_at::date, '1970-01-01'),
      COALESCE(te.event_date, '1970-01-01'),
      COALESCE(r.created_at::date, '1970-01-01')
    )) as last_activity_date,
    ARRAY_AGG(DISTINCT it.metadata->>'category') FILTER (WHERE it.metadata->>'category' IS NOT NULL) as systems_worked
  INTO v_stats
  FROM vehicles v
  LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
  LEFT JOIN image_tags it ON vi.id = it.image_id
  LEFT JOIN timeline_events te ON v.id = te.vehicle_id
  LEFT JOIN receipts r ON v.id = r.scope_id::uuid AND r.scope_type = 'vehicle' AND r.is_active = true
  WHERE v.id = p_vehicle_id
  GROUP BY v.id;

  -- Upsert stats
  INSERT INTO vehicle_stats_cache (
    vehicle_id, total_images, total_ai_tags, total_labor_hours,
    total_receipts_value, last_activity_date, systems_worked, updated_at
  ) VALUES (
    p_vehicle_id, v_stats.total_images, v_stats.total_ai_tags, v_stats.total_labor_hours,
    v_stats.total_receipts_value, v_stats.last_activity_date, v_stats.systems_worked, NOW()
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    total_images = EXCLUDED.total_images,
    total_ai_tags = EXCLUDED.total_ai_tags,
    total_labor_hours = EXCLUDED.total_labor_hours,
    total_receipts_value = EXCLUDED.total_receipts_value,
    last_activity_date = EXCLUDED.last_activity_date,
    systems_worked = EXCLUDED.systems_worked,
    updated_at = NOW();
END;
$$;

-- 8. Triggers to keep stats updated
CREATE OR REPLACE FUNCTION trigger_update_vehicle_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update stats for the affected vehicle
  PERFORM update_vehicle_stats(
    CASE
      WHEN TG_TABLE_NAME = 'vehicle_images' THEN COALESCE(NEW.vehicle_id, OLD.vehicle_id)
      WHEN TG_TABLE_NAME = 'timeline_events' THEN COALESCE(NEW.vehicle_id, OLD.vehicle_id)
      WHEN TG_TABLE_NAME = 'image_tags' THEN COALESCE(NEW.vehicle_id, OLD.vehicle_id)
      WHEN TG_TABLE_NAME = 'receipts' THEN COALESCE(NEW.scope_id::uuid, OLD.scope_id::uuid)
    END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create triggers (IF NOT EXISTS equivalent)
DO $$
BEGIN
  -- Vehicle images trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vehicle_images_stats_trigger') THEN
    CREATE TRIGGER vehicle_images_stats_trigger
      AFTER INSERT OR UPDATE OR DELETE ON vehicle_images
      FOR EACH ROW EXECUTE FUNCTION trigger_update_vehicle_stats();
  END IF;

  -- Timeline events trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'timeline_events_stats_trigger') THEN
    CREATE TRIGGER timeline_events_stats_trigger
      AFTER INSERT OR UPDATE OR DELETE ON timeline_events
      FOR EACH ROW EXECUTE FUNCTION trigger_update_vehicle_stats();
  END IF;

  -- Image tags trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'image_tags_stats_trigger') THEN
    CREATE TRIGGER image_tags_stats_trigger
      AFTER INSERT OR UPDATE OR DELETE ON image_tags
      FOR EACH ROW EXECUTE FUNCTION trigger_update_vehicle_stats();
  END IF;

  -- Receipts trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'receipts_stats_trigger') THEN
    CREATE TRIGGER receipts_stats_trigger
      AFTER INSERT OR UPDATE OR DELETE ON receipts
      FOR EACH ROW
      WHEN (OLD.scope_type = 'vehicle' OR NEW.scope_type = 'vehicle')
      EXECUTE FUNCTION trigger_update_vehicle_stats();
  END IF;
END $$;

-- 9. Create a fast lookup function using caches
CREATE OR REPLACE FUNCTION get_vehicle_summary(p_vehicle_id UUID)
RETURNS TABLE (
  vehicle_id UUID,
  estimated_value NUMERIC,
  confidence_score NUMERIC,
  total_investment NUMERIC,
  total_images INTEGER,
  total_labor_hours NUMERIC,
  systems_worked TEXT[],
  last_activity DATE
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p_vehicle_id,
    COALESCE(vc.estimated_value, 0) as estimated_value,
    COALESCE(vc.confidence_score, 0) as confidence_score,
    COALESCE(vc.parts_value, 0) + COALESCE(vc.labor_value, 0) as total_investment,
    COALESCE(vs.total_images, 0) as total_images,
    COALESCE(vs.total_labor_hours, 0) as total_labor_hours,
    COALESCE(vs.systems_worked, '{}') as systems_worked,
    vs.last_activity_date
  FROM vehicle_valuations_cache vc
  FULL OUTER JOIN vehicle_stats_cache vs ON vc.vehicle_id = vs.vehicle_id
  WHERE COALESCE(vc.vehicle_id, vs.vehicle_id) = p_vehicle_id;
END;
$$;

-- 10. Schedule cache refreshes (would need pg_cron extension)
-- SELECT cron.schedule('refresh_caches', '0 */4 * * *', 'SELECT refresh_valuation_caches();');

-- 11. Analyze tables for better query planning
ANALYZE vehicles;
ANALYZE vehicle_images;
ANALYZE image_tags;
ANALYZE timeline_events;
ANALYZE receipts;