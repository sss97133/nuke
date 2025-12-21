-- Fix stale external_listings: mark as sold/ended when vehicle is sold
-- This addresses 422 stale "active" listings for vehicles that are already sold
-- Note: Temporarily disables trigger to avoid trigger errors

-- Temporarily disable trigger
ALTER TABLE external_listings DISABLE TRIGGER track_auction_transitions;

UPDATE external_listings el
SET 
  listing_status = CASE 
    WHEN v.sale_status = 'sold' OR v.auction_outcome = 'sold' THEN 'sold'
    ELSE 'ended'
  END,
  final_price = COALESCE(el.final_price, v.sale_price),
  updated_at = NOW()
FROM vehicles v
WHERE v.id = el.vehicle_id
  AND el.listing_status IN ('active', 'live')
  AND (
    v.sale_status = 'sold' OR
    v.auction_outcome = 'sold' OR
    (v.sale_price IS NOT NULL AND v.sale_price > 0)
  );

-- Re-enable trigger
ALTER TABLE external_listings ENABLE TRIGGER track_auction_transitions;

