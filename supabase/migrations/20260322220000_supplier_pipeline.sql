-- Supplier Pipeline: expand organization_vehicles + fb_saved_items for inventory tracking
-- Applied manually 2026-03-22

-- 1. Expand relationship_type to include supplier types
ALTER TABLE organization_vehicles DROP CONSTRAINT IF EXISTS organization_vehicles_relationship_type_check;
ALTER TABLE organization_vehicles ADD CONSTRAINT organization_vehicles_relationship_type_check
  CHECK (relationship_type IN (
    'owner', 'consigner', 'service_provider', 'work_location',
    'sold_by', 'storage', 'auction_platform', 'buyer',
    'parts_supplier', 'fabricator', 'painter',
    'upholstery', 'transport', 'inspector', 'collaborator',
    'current_consignment', 'past_consignment', 'purchased_from',
    'supplier_inventory', 'supplier_sold', 'supplier_build'
  )) NOT VALID;

-- 2. Add supplier listing flag to fb_saved_items
ALTER TABLE fb_saved_items ADD COLUMN IF NOT EXISTS is_supplier_listing BOOLEAN DEFAULT false;

-- 3. Expand processing_status to include pipeline states
ALTER TABLE fb_saved_items DROP CONSTRAINT IF EXISTS fb_saved_items_processing_status_check;
ALTER TABLE fb_saved_items ADD CONSTRAINT fb_saved_items_processing_status_check
  CHECK (processing_status IN ('raw', 'parsed', 'matched', 'ignored', 'queued', 'imported')) NOT VALID;

-- 4. Create supplier vehicle readiness view
CREATE OR REPLACE VIEW supplier_vehicle_readiness AS
SELECT
  v.id as vehicle_id,
  v.year, v.make, v.model, v.vin,
  v.sale_price, v.listing_url,
  b.id as organization_id,
  b.business_name as supplier_name,
  b.website as supplier_website,
  b.city as supplier_city,
  b.state as supplier_state,
  ov.relationship_type,
  ov.status as relationship_status,
  ar.composite_score,
  ar.tier,
  ar.identity_score,
  ar.photo_score,
  ar.doc_score,
  ar.desc_score,
  ar.market_score,
  ar.condition_score,
  ar.top_gaps,
  ar.mvps_complete,
  ar.computed_at as ars_computed_at
FROM organization_vehicles ov
JOIN vehicles v ON ov.vehicle_id = v.id
JOIN businesses b ON ov.organization_id = b.id
LEFT JOIN auction_readiness ar ON v.id = ar.vehicle_id
WHERE ov.relationship_type IN ('supplier_inventory', 'supplier_build', 'supplier_sold')
  AND b.discovered_via = 'facebook_saved_reels'
ORDER BY ar.composite_score DESC NULLS LAST;
