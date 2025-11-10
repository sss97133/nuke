-- Feed optimization migration
-- Creates materialized view and indexes for better feed performance

ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS image_category TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Create materialized view for feed items aggregation
DROP MATERIALIZED VIEW IF EXISTS feed_items_view;

CREATE MATERIALIZED VIEW feed_items_view AS
SELECT 
  'vehicle_' || v.id as id,
  'new_vehicle' as type,
  CONCAT(v.year, ' ', v.make, ' ', v.model) as title,
  CONCAT('Added by ', COALESCE('@' || p.username, p.full_name, 'Anonymous User')) as description,
  NULL as image_url,
  v.created_at as timestamp,
  v.user_id,
  p.username,
  v.id as vehicle_id,
  jsonb_build_object(
    'salePrice', v.sale_price,
    'isForSale', v.is_for_sale,
    'make', v.make,
    'model', v.model,
    'year', v.year
  ) as metadata,
  CASE WHEN v.is_for_sale THEN 2 ELSE 1 END as priority
FROM vehicles v
LEFT JOIN profiles p ON v.user_id = p.id
WHERE v.is_public = true 
  AND v.source != 'Bring a Trailer'
  AND v.user_id != '00000000-0000-0000-0000-000000000000'

UNION ALL

SELECT 
  'timeline_' || te.id as id,
  'timeline_event' as type,
  te.event_type as title,
  COALESCE(te.description, CONCAT('Timeline event for ', v.year, ' ', v.make, ' ', v.model)) as description,
  NULL as image_url,
  te.created_at as timestamp,
  v.user_id,
  p.username,
  te.vehicle_id,
  jsonb_build_object(
    'eventDate', te.event_date,
    'vehicleName', CONCAT(v.year, ' ', v.make, ' ', v.model),
    'eventType', te.event_type
  ) as metadata,
  1 as priority
FROM timeline_events te
JOIN vehicles v ON te.vehicle_id = v.id
LEFT JOIN profiles p ON v.user_id = p.id
WHERE v.is_public = true 
  AND v.source != 'Bring a Trailer'
  AND v.user_id != '00000000-0000-0000-0000-000000000000'

UNION ALL

SELECT 
  'image_' || vi.id as id,
  'new_images' as type,
  CONCAT('New ', COALESCE(vi.image_category, vi.category, 'image'), ' uploaded') as title,
  CONCAT(v.year, ' ', v.make, ' ', v.model) as description,
  vi.image_url,
  vi.created_at as timestamp,
  v.user_id,
  p.username,
  vi.vehicle_id,
  jsonb_build_object(
    'imageCategory', COALESCE(vi.image_category, vi.category),
    'vehicleName', CONCAT(v.year, ' ', v.make, ' ', v.model)
  ) as metadata,
  1 as priority
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
LEFT JOIN profiles p ON v.user_id = p.id
WHERE v.is_public = true 
  AND v.source != 'Bring a Trailer'
  AND v.user_id != '00000000-0000-0000-0000-000000000000';

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_feed_items_view_timestamp ON feed_items_view (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_view_type ON feed_items_view (type);
CREATE INDEX IF NOT EXISTS idx_feed_items_view_user_id ON feed_items_view (user_id);
CREATE INDEX IF NOT EXISTS idx_feed_items_view_vehicle_id ON feed_items_view (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_feed_items_view_priority ON feed_items_view (priority DESC);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_feed_items_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW feed_items_view;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to auto-refresh materialized view
CREATE OR REPLACE FUNCTION trigger_refresh_feed_items_view()
RETURNS trigger AS $$
BEGIN
  -- Use pg_notify to signal that the view needs refreshing
  PERFORM pg_notify('feed_refresh', 'refresh_needed');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create triggers on source tables
DROP TRIGGER IF EXISTS trigger_vehicles_feed_refresh ON vehicles;
CREATE TRIGGER trigger_vehicles_feed_refresh
  AFTER INSERT OR UPDATE OR DELETE ON vehicles
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_feed_items_view();

DROP TRIGGER IF EXISTS trigger_timeline_events_feed_refresh ON timeline_events;
CREATE TRIGGER trigger_timeline_events_feed_refresh
  AFTER INSERT OR UPDATE OR DELETE ON timeline_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_feed_items_view();

DROP TRIGGER IF EXISTS trigger_vehicle_images_feed_refresh ON vehicle_images;
CREATE TRIGGER trigger_vehicle_images_feed_refresh
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_images
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_feed_items_view();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'skynalysis_analyses'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trigger_skynalysis_analyses_feed_refresh ON skynalysis_analyses';
    EXECUTE 'CREATE TRIGGER trigger_skynalysis_analyses_feed_refresh
  AFTER INSERT OR UPDATE OR DELETE ON skynalysis_analyses
  FOR EACH STATEMENT
      EXECUTE FUNCTION trigger_refresh_feed_items_view()';
  END IF;
END;
$$;

-- Initial refresh of the materialized view
SELECT refresh_feed_items_view();
