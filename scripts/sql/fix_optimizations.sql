-- Fix the optimization script errors

-- 1. Fix materialized view for work sessions (fix ambiguous column)
DROP MATERIALIZED VIEW IF EXISTS vehicle_work_sessions_cache CASCADE;

CREATE MATERIALIZED VIEW vehicle_work_sessions_cache AS
SELECT
  vi.vehicle_id,
  DATE(vi.taken_at) as work_date,
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
GROUP BY vi.vehicle_id, DATE(vi.taken_at)
HAVING COUNT(*) >= 3; -- Only significant work sessions

CREATE UNIQUE INDEX vehicle_work_sessions_cache_pkey ON vehicle_work_sessions_cache (vehicle_id, work_date);
CREATE INDEX vehicle_work_sessions_cache_vehicle ON vehicle_work_sessions_cache (vehicle_id);

-- 2. Fix receipt trigger to handle INSERT properly
DROP TRIGGER IF EXISTS receipts_stats_trigger ON receipts;

CREATE OR REPLACE FUNCTION receipts_stats_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only process vehicle-scoped receipts
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.scope_type = 'vehicle' THEN
    PERFORM update_vehicle_stats(NEW.scope_id::uuid);
  END IF;

  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') AND OLD.scope_type = 'vehicle' THEN
    PERFORM update_vehicle_stats(OLD.scope_id::uuid);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER receipts_stats_trigger
  AFTER INSERT OR UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION receipts_stats_trigger_func();

-- 3. Test the optimized functions
SELECT 'Testing get_vehicle_summary...' as status;
SELECT * FROM get_vehicle_summary('e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid) LIMIT 1;

SELECT 'Testing queue_images_for_ai_analysis...' as status;
SELECT COUNT(*) as images_queued FROM queue_images_for_ai_analysis() LIMIT 1;

-- 4. Initialize stats for existing vehicles
SELECT 'Initializing vehicle stats cache...' as status;
DO $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM vehicles LIMIT 10 LOOP
    PERFORM update_vehicle_stats(v_id);
  END LOOP;
END $$;

SELECT 'Optimization complete!' as status;