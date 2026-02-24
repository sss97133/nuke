-- Bid velocity comparison: 1983 GMC K2500 (current auction) vs recent GM truck sales
-- Run in Supabase SQL editor. Velocity = bids_per_hour (same as bid-curve-analysis / predict-hammer-price).

WITH target_listing AS (
  SELECT el.vehicle_id, el.listing_url, el.current_bid, el.bid_count
  FROM external_listings el
  WHERE el.platform = 'bat'
    AND el.listing_status = 'active'
    AND (el.listing_url ILIKE '%1983-gmc-k2500-2%' OR el.listing_url ILIKE '%1983-gmc-k2500%')
  LIMIT 1
),
target_velocity AS (
  SELECT
    (COUNT(*) FILTER (WHERE b.bat_username != 'bid_snapshot') / GREATEST(
      EXTRACT(EPOCH FROM (
        MAX(b.bid_timestamp) FILTER (WHERE b.bat_username != 'bid_snapshot') -
        MIN(b.bid_timestamp) FILTER (WHERE b.bat_username != 'bid_snapshot')
      )) / 3600.0, 0.1
    ))::numeric AS velocity_bids_per_hr,
    COUNT(*) FILTER (WHERE b.bat_username != 'bid_snapshot') AS bid_count,
    EXTRACT(EPOCH FROM (MAX(b.bid_timestamp) - MIN(b.bid_timestamp))) / 3600.0 AS duration_hours
  FROM bat_bids b
  JOIN target_listing t ON t.vehicle_id = b.vehicle_id
  WHERE b.bid_amount > 0
),
gm_truck_velocity AS (
  SELECT
    (COUNT(*) FILTER (WHERE b.bat_username != 'bid_snapshot') / GREATEST(
      EXTRACT(EPOCH FROM (MAX(b.bid_timestamp) - MIN(b.bid_timestamp))) / 3600.0, 0.1
    ))::numeric AS bids_per_hour
  FROM bat_bids b
  JOIN vehicles v ON v.id = b.vehicle_id
  JOIN external_listings el ON el.vehicle_id = v.id AND el.platform = 'bat' AND el.listing_status = 'sold'
  WHERE UPPER(v.make) = 'GMC'
    AND (v.model ILIKE '%C/K%' OR v.model ILIKE '%K2500%' OR v.model ILIKE '%K1500%' OR v.model ILIKE '%K10%' OR v.model ILIKE '%K20%'
         OR v.model ILIKE '%Sierra%' OR v.model ILIKE '%C2500%' OR v.model ILIKE '%C1500%')
    AND v.year BETWEEN 1973 AND 1991
    AND el.end_date >= NOW() - INTERVAL '24 months'
  GROUP BY b.vehicle_id
  HAVING COUNT(*) >= 3
)
SELECT
  ROUND(tv.velocity_bids_per_hr, 2) AS this_auction_velocity_bids_per_hr,
  tv.bid_count AS this_auction_bid_count,
  ROUND(tv.duration_hours::numeric, 1) AS this_auction_duration_hrs,
  ROUND(AVG(g.bids_per_hour)::numeric, 2) AS gm_trucks_avg_velocity_bids_per_hr,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY g.bids_per_hour)::numeric, 2) AS gm_trucks_median_velocity,
  COUNT(g.bids_per_hour) AS gm_truck_auctions_in_sample
FROM target_velocity tv
CROSS JOIN gm_truck_velocity g
GROUP BY tv.velocity_bids_per_hr, tv.bid_count, tv.duration_hours;

-- If no row above (listing not in DB yet), run this to get segment-only comparison:
-- GMC C/K 1973–1991 sold in last 24 months: avg and median velocity (bids/hr)
/*
SELECT
  COUNT(*) AS auction_count,
  ROUND(AVG(bids_per_hour)::numeric, 2) AS avg_velocity_bids_per_hr,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bids_per_hour)::numeric, 2) AS median_velocity_bids_per_hr
FROM (
  SELECT
    (COUNT(*) FILTER (WHERE b.bat_username != 'bid_snapshot') / GREATEST(EXTRACT(EPOCH FROM (MAX(b.bid_timestamp) - MIN(b.bid_timestamp))) / 3600.0, 0.1))::numeric AS bids_per_hour
  FROM bat_bids b
  JOIN vehicles v ON v.id = b.vehicle_id
  JOIN external_listings el ON el.vehicle_id = v.id AND el.platform = 'bat' AND el.listing_status = 'sold'
  WHERE UPPER(v.make) = 'GMC'
    AND (v.model ILIKE '%C/K%' OR v.model ILIKE '%K2500%' OR v.model ILIKE '%K1500%' OR v.model ILIKE '%K10%' OR v.model ILIKE '%K20%' OR v.model ILIKE '%Sierra%' OR v.model ILIKE '%C2500%' OR v.model ILIKE '%C1500%')
    AND v.year BETWEEN 1973 AND 1991
    AND el.end_date >= NOW() - INTERVAL '24 months'
  GROUP BY b.vehicle_id
  HAVING COUNT(*) >= 3
) x;
*/
