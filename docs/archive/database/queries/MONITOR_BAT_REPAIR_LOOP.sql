-- =====================================================
-- BaT REPAIR LOOP MONITORING QUERIES
-- =====================================================
-- Use these queries to monitor the health and progress
-- of the BaT "make profiles correct" repair loop.

-- =====================================================
-- 1. RECENT REPAIR ATTEMPTS
-- =====================================================
-- Shows vehicles that have been processed by the repair loop
-- with their last attempt status, timing, and results.

SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.profile_origin,
  v.listing_url,
  v.updated_at as vehicle_updated_at,
  (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp as last_repair_attempt,
  (v.origin_metadata->'bat_repair'->>'attempts')::int as repair_attempts,
  (v.origin_metadata->'bat_repair'->>'last_ok')::boolean as last_repair_success,
  (v.origin_metadata->'bat_repair'->>'last_error')::text as last_repair_error,
  (v.origin_metadata->'bat_repair'->>'last_result_at')::timestamp as last_result_time,
  -- Current completeness status
  (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) as image_count,
  LENGTH(COALESCE(v.description, '')) as description_length,
  CASE WHEN v.listing_location IS NULL OR v.listing_location = '' THEN false ELSE true END as has_location,
  (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) as comment_count,
  -- Time since last attempt
  EXTRACT(EPOCH FROM (NOW() - (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp)) / 3600 as hours_since_last_attempt
FROM vehicles v
WHERE v.origin_metadata->'bat_repair' IS NOT NULL
ORDER BY (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp DESC NULLS LAST
LIMIT 100;

-- =====================================================
-- 2. REPAIR SUCCESS RATE SUMMARY
-- =====================================================
-- Overall statistics on repair attempts and success rates

SELECT 
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) as successful_repairs,
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = false) as failed_repairs,
  COUNT(*) FILTER (WHERE v.origin_metadata->'bat_repair'->>'last_ok' IS NULL) as in_progress_or_unknown,
  COUNT(*) as total_vehicles_attempted,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) / 
    NULLIF(COUNT(*) FILTER (WHERE v.origin_metadata->'bat_repair'->>'last_ok' IS NOT NULL), 0),
    2
  ) as success_rate_pct,
  AVG((v.origin_metadata->'bat_repair'->>'attempts')::int) FILTER (WHERE v.origin_metadata->'bat_repair'->>'attempts' IS NOT NULL) as avg_attempts_per_vehicle,
  MAX((v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp) as most_recent_repair_attempt
FROM vehicles v
WHERE v.origin_metadata->'bat_repair' IS NOT NULL;

-- =====================================================
-- 3. CURRENTLY INCOMPLETE VEHICLES (REPAIR CANDIDATES)
-- =====================================================
-- Vehicles that need repair based on the same criteria
-- used by the orchestrator function

SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.profile_origin,
  v.listing_url,
  v.updated_at,
  -- Completeness signals
  (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) as image_count,
  LENGTH(COALESCE(v.description, '')) as description_length,
  CASE WHEN v.listing_location IS NULL OR v.listing_location = '' THEN false ELSE true END as has_location,
  (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) as comment_count,
  -- Missing fields
  CASE WHEN (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) = 0 THEN 'missing_images' ELSE NULL END as missing_images,
  CASE WHEN LENGTH(COALESCE(v.description, '')) < 80 THEN 'short_description' ELSE NULL END as short_description,
  CASE WHEN v.listing_location IS NULL OR v.listing_location = '' THEN 'missing_location' ELSE NULL END as missing_location,
  CASE WHEN (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) = 0 THEN 'missing_comments' ELSE NULL END as missing_comments,
  -- Rate limiting status
  (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp as last_repair_attempt,
  EXTRACT(EPOCH FROM (NOW() - (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp)) / 3600 as hours_since_last_attempt,
  CASE 
    WHEN (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp IS NULL THEN true
    WHEN EXTRACT(EPOCH FROM (NOW() - (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp)) / 3600 >= 6 THEN true
    ELSE false
  END as can_repair_now,
  -- Repair history
  (v.origin_metadata->'bat_repair'->>'attempts')::int as previous_attempts
FROM vehicles v
WHERE 
  (
    v.profile_origin = 'bat_import'
    OR v.discovery_source = 'bat_import'
    OR v.listing_url ILIKE '%bringatrailer.com/listing/%'
    OR v.discovery_url ILIKE '%bringatrailer.com/listing/%'
    OR v.bat_auction_url ILIKE '%bringatrailer.com/listing/%'
  )
  AND v.updated_at <= NOW() - INTERVAL '6 hours'  -- Only older vehicles (same as orchestrator)
HAVING 
  -- Incomplete criteria (same as orchestrator logic)
  (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) = 0
  OR LENGTH(COALESCE(v.description, '')) < 80
  OR v.listing_location IS NULL
  OR v.listing_location = ''
  OR (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) = 0
ORDER BY 
  v.updated_at ASC,  -- Oldest first (prioritize stale vehicles)
  (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp ASC NULLS FIRST  -- Never attempted first
LIMIT 100;

-- =====================================================
-- 4. REPAIR FAILURES (NEEDS ATTENTION)
-- =====================================================
-- Vehicles where the last repair attempt failed
-- with error messages for debugging

SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.listing_url,
  (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp as last_attempt,
  (v.origin_metadata->'bat_repair'->>'attempts')::int as total_attempts,
  (v.origin_metadata->'bat_repair'->>'last_error')::text as error_message,
  -- Current status (to see if manual fix helped)
  (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) as current_image_count,
  LENGTH(COALESCE(v.description, '')) as current_description_length,
  CASE WHEN v.listing_location IS NULL OR v.listing_location = '' THEN false ELSE true END as current_has_location,
  (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) as current_comment_count
FROM vehicles v
WHERE 
  v.origin_metadata->'bat_repair'->>'last_ok' = 'false'
  AND (v.origin_metadata->'bat_repair'->>'last_error')::text IS NOT NULL
ORDER BY (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp DESC
LIMIT 50;

-- =====================================================
-- 5. IMAGE ORDERING STATUS
-- =====================================================
-- Check if images have position fields set correctly
-- (should be 0, 1, 2, ... for each vehicle)

SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  COUNT(vi.id) as total_images,
  COUNT(vi.position) as positioned_images,
  COUNT(vi.id) - COUNT(vi.position) as unpositioned_images,
  MIN(vi.position) FILTER (WHERE vi.position IS NOT NULL) as min_position,
  MAX(vi.position) FILTER (WHERE vi.position IS NOT NULL) as max_position,
  CASE 
    WHEN COUNT(vi.id) = 0 THEN 'no_images'
    WHEN COUNT(vi.position) = COUNT(vi.id) THEN 'fully_positioned'
    WHEN COUNT(vi.position) > 0 THEN 'partially_positioned'
    ELSE 'not_positioned'
  END as positioning_status
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE 
  (
    v.profile_origin = 'bat_import'
    OR v.discovery_source = 'bat_import'
    OR v.listing_url ILIKE '%bringatrailer.com/listing/%'
  )
  AND EXISTS (SELECT 1 FROM vehicle_images vi2 WHERE vi2.vehicle_id = v.id)  -- Only vehicles with images
GROUP BY v.id, v.year, v.make, v.model
ORDER BY unpositioned_images DESC, v.updated_at DESC
LIMIT 50;

-- =====================================================
-- 6. REPAIR ACTIVITY TIMELINE
-- =====================================================
-- Shows repair attempts over time (useful for monitoring
-- scheduled runs and manual triggers)

SELECT 
  DATE_TRUNC('hour', (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp) as repair_hour,
  COUNT(*) as vehicles_repaired,
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) as successful,
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = false) as failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) / 
    NULLIF(COUNT(*), 0),
    2
  ) as success_rate_pct
FROM vehicles v
WHERE 
  v.origin_metadata->'bat_repair'->>'last_attempt_at' IS NOT NULL
  AND (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp)
ORDER BY repair_hour DESC;

-- =====================================================
-- 7. QUICK HEALTH CHECK
-- =====================================================
-- One-liner to see overall repair loop health

SELECT 
  'BaT Repair Loop Health' as metric,
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) || ' successful' as successful_repairs,
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = false) || ' failed' as failed_repairs,
  (SELECT COUNT(*) FROM vehicles v2 
   WHERE (v2.profile_origin = 'bat_import' OR v2.discovery_source = 'bat_import')
     AND (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v2.id) = 0
  ) || ' need images' as incomplete_count,
  MAX((v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp) || '' as most_recent_run
FROM vehicles v
WHERE v.origin_metadata->'bat_repair' IS NOT NULL;

