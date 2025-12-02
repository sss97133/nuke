-- Script to check and potentially add sample images for vehicle
-- Run this with: psql -h [host] -U [user] -d [db] -f add_sample_images.sql

-- Check current images
SELECT 
  COUNT(*) as image_count,
  COUNT(*) FILTER (WHERE is_primary = true) as primary_count,
  COUNT(*) FILTER (WHERE is_document = true) as document_count
FROM vehicle_images
WHERE vehicle_id = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b';

-- Show existing images
SELECT 
  id,
  image_url,
  is_primary,
  is_document,
  category,
  created_at
FROM vehicle_images
WHERE vehicle_id = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b'
ORDER BY is_primary DESC, created_at DESC
LIMIT 10;

-- Check vehicle info
SELECT 
  id,
  year,
  make,
  model,
  vin,
  profile_origin,
  bat_auction_url,
  discovery_url
FROM vehicles
WHERE id = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b';

-- Check for active auctions
SELECT 
  id,
  sale_type,
  status,
  current_high_bid_cents,
  bid_count,
  auction_end_time
FROM vehicle_listings
WHERE vehicle_id = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b'
  AND status = 'active'
  AND sale_type IN ('auction', 'live_auction');
