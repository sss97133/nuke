-- Query PCarMarket Auction Countdowns
-- Shows all time parameters and countdowns for PCarMarket auctions

-- 1. All active auctions with countdown
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.auction_end_date,
  calculate_auction_countdown(v.auction_end_date)->>'formatted' as time_remaining,
  calculate_auction_countdown(v.auction_end_date)->>'formatted_short' as time_remaining_short,
  calculate_auction_countdown(v.auction_end_date)->>'is_expired' as is_expired,
  calculate_auction_countdown(v.auction_end_date)->>'days' as days_remaining,
  calculate_auction_countdown(v.auction_end_date)->>'hours' as hours_remaining,
  calculate_auction_countdown(v.auction_end_date)->>'minutes' as minutes_remaining,
  v.discovery_url
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.auction_end_date IS NOT NULL
  AND v.auction_end_date > NOW()
ORDER BY v.auction_end_date ASC;

-- 2. Get complete time parameters for a specific vehicle
SELECT get_vehicle_auction_times('e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8');

-- 3. View all auctions with status
SELECT 
  vehicle_id,
  year || ' ' || make || ' ' || model as vehicle,
  auction_end_date,
  countdown->>'formatted' as time_remaining,
  countdown->>'is_expired' as is_expired,
  auction_status,
  time_remaining_seconds
FROM vehicle_auction_times
ORDER BY 
  CASE auction_status
    WHEN 'active' THEN 1
    WHEN 'upcoming' THEN 2
    WHEN 'ended' THEN 3
    ELSE 4
  END,
  time_remaining_seconds ASC NULLS LAST;

-- 4. Auctions ending in next 24 hours
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.auction_end_date,
  calculate_auction_countdown(v.auction_end_date)->>'formatted' as time_remaining,
  v.discovery_url
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.auction_end_date IS NOT NULL
  AND v.auction_end_date > NOW()
  AND v.auction_end_date <= NOW() + INTERVAL '24 hours'
ORDER BY v.auction_end_date ASC;

-- 5. Recently ended auctions (last 7 days)
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.auction_end_date,
  v.sale_price,
  v.auction_outcome,
  EXTRACT(EPOCH FROM (NOW() - v.auction_end_date)) / 86400 as days_ago,
  v.discovery_url
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.auction_end_date IS NOT NULL
  AND v.auction_end_date <= NOW()
  AND v.auction_end_date >= NOW() - INTERVAL '7 days'
ORDER BY v.auction_end_date DESC;

-- 6. Countdown details with metadata
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.auction_end_date,
  v.origin_metadata->>'auction_times'->>'auction_start_date' as start_date,
  calculate_auction_countdown(v.auction_end_date) as countdown,
  v.origin_metadata->>'auction_times'->>'time_remaining_formatted' as time_remaining_from_metadata,
  v.origin_metadata->>'auction_times'->>'time_since_start_formatted' as time_since_start,
  v.origin_metadata->>'auction_times'->>'total_duration_days' as duration_days
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.auction_end_date IS NOT NULL
ORDER BY v.auction_end_date ASC;

