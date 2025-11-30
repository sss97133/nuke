-- Fix timeline events that incorrectly show "Sold" when vehicle is actually on auction
-- Run this to update existing incorrect events

-- Update timeline events to "auction_listed" if there's an active auction
UPDATE timeline_events te
SET 
  event_type = 'auction_listed',
  title = CASE 
    WHEN te.title LIKE '%Sold%' THEN REPLACE(te.title, 'Sold', 'Listed for')
    WHEN te.title LIKE '%sold%' THEN REPLACE(te.title, 'sold', 'listed for')
    ELSE 'Listed for Auction'
  END,
  metadata = COALESCE(te.metadata, '{}'::jsonb) || jsonb_build_object('corrected_from_sale', true, 'correction_date', NOW())
FROM vehicle_listings vl
WHERE te.vehicle_id = vl.vehicle_id
  AND te.event_type = 'sale'
  AND te.metadata->>'source' IN ('bat_import', 'bat_listing')
  AND vl.status = 'active'
  AND vl.sale_type IN ('auction', 'live_auction')
  AND vl.auction_end_time > NOW();

-- Also check external_listings
UPDATE timeline_events te
SET 
  event_type = 'auction_listed',
  title = CASE 
    WHEN te.title LIKE '%Sold%' THEN REPLACE(te.title, 'Sold', 'Listed for')
    WHEN te.title LIKE '%sold%' THEN REPLACE(te.title, 'sold', 'listed for')
    ELSE 'Listed for Auction'
  END,
  metadata = COALESCE(te.metadata, '{}'::jsonb) || jsonb_build_object('corrected_from_sale', true, 'correction_date', NOW())
FROM external_listings el
WHERE te.vehicle_id = el.vehicle_id
  AND te.event_type = 'sale'
  AND te.metadata->>'source' IN ('bat_import', 'bat_listing')
  AND el.listing_status = 'active'
  AND el.platform = 'bat'
  AND el.end_date > NOW();

-- Show what was updated
SELECT 
  te.id,
  te.vehicle_id,
  te.title,
  te.event_type,
  te.metadata->>'source' as source,
  te.metadata->>'corrected_from_sale' as corrected
FROM timeline_events te
WHERE te.metadata->>'corrected_from_sale' = 'true'
ORDER BY te.created_at DESC
LIMIT 20;

