-- Unified Listings View
-- Materialized view combining all listing sources (native, external, export)

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS unified_listings_view;

-- Note: This view is complex and may be slow. Consider using the service layer approach instead.
-- Keeping this for reference but the service layer (myAuctionsService) handles the union logic.

-- For now, we'll create a simpler view that can be used for quick queries
CREATE MATERIALIZED VIEW unified_listings_view AS
-- Native n-zero listings
SELECT 
  'native' as listing_source,
  vl.id::TEXT as listing_id,
  vl.vehicle_id,
  vl.seller_id as user_id,
  'nzero' as platform,
  vl.status as listing_status,
  vl.current_high_bid_cents / 100.0 as current_bid,
  vl.reserve_price_cents / 100.0 as reserve_price,
  vl.bid_count,
  NULL::INTEGER as view_count,
  NULL::INTEGER as watcher_count,
  vl.auction_end_time as end_date,
  NULL::TIMESTAMPTZ as sold_at,
  NULL::NUMERIC as final_price,
  NULL::TEXT as external_url,
  vl.created_at as listed_at,
  vl.updated_at as last_updated
FROM vehicle_listings vl
WHERE vl.status IN ('active', 'ended', 'sold')

UNION ALL

-- External listings (from external_listings)
SELECT 
  'external' as listing_source,
  el.id::TEXT as listing_id,
  el.vehicle_id,
  (SELECT user_id FROM vehicles WHERE id = el.vehicle_id) as user_id,
  el.platform,
  el.listing_status as listing_status,
  el.current_bid,
  el.reserve_price,
  el.bid_count,
  el.view_count,
  el.watcher_count,
  el.end_date,
  el.sold_at,
  el.final_price,
  el.listing_url as external_url,
  el.created_at as listed_at,
  el.updated_at as last_updated
FROM external_listings el
WHERE el.listing_status IN ('active', 'ended', 'sold')

UNION ALL

-- Export listings (from listing_exports)
SELECT 
  'export' as listing_source,
  le.id::TEXT as listing_id,
  le.vehicle_id,
  le.user_id,
  le.platform,
  le.status as listing_status,
  NULL::NUMERIC as current_bid,
  le.reserve_price_cents / 100.0 as reserve_price,
  NULL::INTEGER as bid_count,
  NULL::INTEGER as view_count,
  NULL::INTEGER as watcher_count,
  le.ended_at as end_date,
  le.sold_at,
  le.sold_price_cents / 100.0 as final_price,
  le.external_listing_url as external_url,
  le.created_at as listed_at,
  le.updated_at as last_updated
FROM listing_exports le
WHERE le.status IN ('active', 'sold', 'expired');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_unified_listings_user ON unified_listings_view(user_id);
CREATE INDEX IF NOT EXISTS idx_unified_listings_platform ON unified_listings_view(platform);
CREATE INDEX IF NOT EXISTS idx_unified_listings_status ON unified_listings_view(listing_status);
CREATE INDEX IF NOT EXISTS idx_unified_listings_vehicle ON unified_listings_view(vehicle_id);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_unified_listings_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW unified_listings_view;
END;
$$ LANGUAGE plpgsql;

COMMENT ON MATERIALIZED VIEW unified_listings_view IS 'Unified view of all listings from native, external, and export sources';
COMMENT ON FUNCTION refresh_unified_listings_view IS 'Refresh the unified listings materialized view';

