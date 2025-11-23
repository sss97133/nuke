-- ==========================================================================
-- INVENTORY CURRENT FILTER & VIEWS
-- ==========================================================================
-- Purpose: Prioritize "current" inventory over "all" (hide sold by default)
-- ==========================================================================

-- ==========================================================================
-- 1. MATERIALIZED VIEW: Organization Current Inventory
-- ==========================================================================
-- Fast view of current (non-sold) inventory for organizations
-- ==========================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS organization_current_inventory AS
SELECT 
  ov.id,
  ov.organization_id,
  ov.vehicle_id,
  ov.relationship_type,
  ov.listing_status,
  ov.asking_price,
  ov.cost_basis,
  ov.days_on_lot,
  ov.featured,
  ov.responsible_party_user_id,
  ov.responsibility_type,
  ov.status,
  ov.created_at,
  ov.updated_at,
  
  -- Vehicle details
  v.year,
  v.make,
  v.model,
  v.trim,
  v.vin,
  v.vin_is_valid,
  v.current_value,
  v.mileage,
  v.is_public,
  
  -- Metrics
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  (SELECT MIN(captured_at) FROM vehicle_images WHERE vehicle_id = v.id) as first_photo_date,
  (SELECT MAX(captured_at) FROM vehicle_images WHERE vehicle_id = v.id) as last_photo_date,
  
  -- Primary image
  (
    SELECT thumbnail_url 
    FROM vehicle_images 
    WHERE vehicle_id = v.id 
    ORDER BY is_primary DESC NULLS LAST, confidence_score DESC NULLS LAST, captured_at ASC 
    LIMIT 1
  ) as thumbnail_url,
  
  -- Organization
  b.business_name,
  b.city,
  b.state,
  
  -- Flags
  CASE 
    WHEN v.vin IS NULL OR v.vin = '' THEN true
    ELSE false
  END as missing_vin,
  
  CASE
    WHEN v.vin_is_valid = false THEN true
    ELSE false
  END as invalid_vin,
  
  CASE
    WHEN ov.responsible_party_user_id IS NULL THEN true
    ELSE false
  END as needs_assignment

FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
JOIN businesses b ON b.id = ov.organization_id
WHERE 
  ov.status = 'active'
  AND ov.sale_date IS NULL  -- Not sold
  AND (v.sale_status IS NULL OR v.sale_status != 'sold')  -- Not marked as sold
;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_current_inventory_id ON organization_current_inventory(id);
CREATE INDEX IF NOT EXISTS idx_org_current_inventory_org ON organization_current_inventory(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_current_inventory_vehicle ON organization_current_inventory(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_org_current_inventory_needs_assignment ON organization_current_inventory(organization_id) 
  WHERE needs_assignment = true;
CREATE INDEX IF NOT EXISTS idx_org_current_inventory_invalid_vin ON organization_current_inventory(organization_id)
  WHERE invalid_vin = true;

COMMENT ON MATERIALIZED VIEW organization_current_inventory IS 'Fast view of current (non-sold) inventory for organizations';

-- ==========================================================================
-- 2. FUNCTION: Refresh Current Inventory View
-- ==========================================================================

CREATE OR REPLACE FUNCTION refresh_current_inventory()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY organization_current_inventory;
END;
$$ LANGUAGE plpgsql;

-- ==========================================================================
-- 3. TRIGGER: Auto-refresh on changes
-- ==========================================================================

CREATE OR REPLACE FUNCTION notify_inventory_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify that inventory changed (can be picked up by application layer)
  PERFORM pg_notify('inventory_changed', json_build_object(
    'organization_id', COALESCE(NEW.organization_id, OLD.organization_id),
    'vehicle_id', COALESCE(NEW.vehicle_id, OLD.vehicle_id),
    'operation', TG_OP
  )::text);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_inventory_change ON organization_vehicles;
CREATE TRIGGER trigger_notify_inventory_change
  AFTER INSERT OR UPDATE OR DELETE ON organization_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION notify_inventory_change();

-- ==========================================================================
-- 4. VIEW: Inventory Summary by Organization
-- ==========================================================================

CREATE OR REPLACE VIEW organization_inventory_summary AS
SELECT
  organization_id,
  business_name,
  
  -- Current inventory counts
  COUNT(*) FILTER (WHERE sale_date IS NULL) as current_count,
  COUNT(*) FILTER (WHERE listing_status = 'for_sale') as for_sale_count,
  COUNT(*) FILTER (WHERE listing_status = 'reserved') as reserved_count,
  COUNT(*) FILTER (WHERE relationship_type = 'consigner') as consignment_count,
  
  -- Sold this month
  COUNT(*) FILTER (WHERE sale_date >= DATE_TRUNC('month', CURRENT_DATE)) as sold_this_month,
  
  -- Values
  SUM(asking_price) FILTER (WHERE listing_status = 'for_sale') as total_asking_value,
  SUM(cost_basis) FILTER (WHERE sale_date IS NULL) as total_cost_basis,
  
  -- Quality flags
  COUNT(*) FILTER (WHERE missing_vin = true) as missing_vin_count,
  COUNT(*) FILTER (WHERE invalid_vin = true) as invalid_vin_count,
  COUNT(*) FILTER (WHERE needs_assignment = true) as needs_assignment_count,
  COUNT(*) FILTER (WHERE days_on_lot > 90) as aged_inventory_count,
  
  -- Averages
  AVG(days_on_lot) FILTER (WHERE sale_date IS NULL) as avg_days_on_lot,
  AVG(image_count) as avg_images_per_vehicle

FROM organization_current_inventory
GROUP BY organization_id, business_name;

COMMENT ON VIEW organization_inventory_summary IS 'Summary metrics for each organizations current inventory';

-- ==========================================================================
-- 5. VIEW: Vehicles Needing Attention
-- ==========================================================================

CREATE OR REPLACE VIEW vehicles_needing_attention AS
SELECT
  oci.*,
  
  -- Priority score (higher = more urgent)
  (
    CASE WHEN invalid_vin THEN 100 ELSE 0 END +
    CASE WHEN missing_vin AND is_public THEN 80 ELSE 0 END +
    CASE WHEN needs_assignment THEN 50 ELSE 0 END +
    CASE WHEN days_on_lot > 180 THEN 30 ELSE 0 END +
    CASE WHEN days_on_lot > 90 THEN 15 ELSE 0 END +
    CASE WHEN image_count < 3 THEN 20 ELSE 0 END +
    CASE WHEN responsible_party_user_id IS NULL THEN 40 ELSE 0 END
  ) as priority_score,
  
  -- Issues
  ARRAY_REMOVE(ARRAY[
    CASE WHEN invalid_vin THEN 'Invalid VIN' END,
    CASE WHEN missing_vin AND is_public THEN 'Public vehicle missing VIN' END,
    CASE WHEN missing_vin AND NOT is_public THEN 'Missing VIN' END,
    CASE WHEN needs_assignment THEN 'No responsible party' END,
    CASE WHEN days_on_lot > 180 THEN 'Aged inventory (180+ days)' END,
    CASE WHEN days_on_lot > 90 THEN 'Aged inventory (90+ days)' END,
    CASE WHEN image_count < 3 THEN 'Low image count' END,
    CASE WHEN asking_price IS NULL AND listing_status = 'for_sale' THEN 'Missing price' END
  ], NULL) as issues

FROM organization_current_inventory oci
WHERE 
  invalid_vin = true OR
  (missing_vin = true AND is_public = true) OR
  needs_assignment = true OR
  days_on_lot > 90 OR
  image_count < 3 OR
  (asking_price IS NULL AND listing_status = 'for_sale')
ORDER BY priority_score DESC;

COMMENT ON VIEW vehicles_needing_attention IS 'Vehicles that need immediate attention (data quality, assignment, etc.)';

-- ==========================================================================
-- 6. GRANT ACCESS
-- ==========================================================================

GRANT SELECT ON organization_current_inventory TO authenticated;
GRANT SELECT ON organization_inventory_summary TO authenticated;
GRANT SELECT ON vehicles_needing_attention TO authenticated;

-- ==========================================================================
-- 7. INITIAL REFRESH
-- ==========================================================================

REFRESH MATERIALIZED VIEW organization_current_inventory;

