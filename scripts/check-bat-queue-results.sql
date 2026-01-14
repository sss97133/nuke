-- ============================================================================
-- Check BaT Queue Processing Results
-- Run this in Supabase SQL Editor to see what was processed
-- ============================================================================

-- 1. Queue Status Summary
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percentage
FROM bat_extraction_queue
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'pending' THEN 1
    WHEN 'processing' THEN 2
    WHEN 'complete' THEN 3
    WHEN 'failed' THEN 4
  END;

-- 2. Recently Processed Items (Last Hour)
SELECT 
  id,
  status,
  bat_url,
  attempts,
  error_message,
  processed_at,
  EXTRACT(EPOCH FROM (processed_at - last_attempt_at)) / 60 as processing_minutes
FROM bat_extraction_queue
WHERE processed_at > NOW() - INTERVAL '1 hour'
   OR status = 'processing'
ORDER BY processed_at DESC NULLS LAST, last_attempt_at DESC
LIMIT 20;

-- 3. Recently Created/Updated Vehicles (Last Hour)
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.created_at,
  v.updated_at,
  el.listing_url,
  el.current_bid,
  el.bid_count
FROM vehicles v
LEFT JOIN LATERAL (
  SELECT
    el.listing_url,
    el.current_bid,
    el.bid_count
  FROM external_listings el
  WHERE el.vehicle_id = v.id
  ORDER BY COALESCE(el.sold_at, el.end_date, el.updated_at) DESC NULLS LAST, el.updated_at DESC
  LIMIT 1
) el ON true
WHERE v.created_at > NOW() - INTERVAL '1 hour'
   OR v.updated_at > NOW() - INTERVAL '1 hour'
ORDER BY v.created_at DESC, v.updated_at DESC
LIMIT 20;

-- 4. Items Currently Processing (Stuck?)
SELECT 
  id,
  bat_url,
  status,
  attempts,
  locked_at,
  locked_by,
  EXTRACT(EPOCH FROM (NOW() - locked_at)) / 60 as locked_minutes
FROM bat_extraction_queue
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '30 minutes'  -- Stuck for > 30 min
ORDER BY locked_at ASC;

-- 5. Next Items to Process (Pending Queue)
SELECT 
  id,
  bat_url,
  priority,
  attempts,
  created_at,
  next_attempt_at
FROM bat_extraction_queue
WHERE status = 'pending'
ORDER BY COALESCE(priority, 0) DESC, created_at ASC
LIMIT 10;

-- 6. Processing Speed (Last 24 Hours)
SELECT 
  DATE_TRUNC('hour', processed_at) as hour,
  COUNT(*) as items_completed,
  ROUND(AVG(EXTRACT(EPOCH FROM (processed_at - last_attempt_at)) / 60), 2) as avg_minutes_per_item
FROM bat_extraction_queue
WHERE status = 'complete'
  AND processed_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

