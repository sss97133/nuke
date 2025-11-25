-- ==========================================================================
-- AI ANALYSIS ACTIVITY REPORT
-- ==========================================================================
-- Comprehensive report on AI analysis status, table growth, and data storage
-- ==========================================================================

\echo '=========================================================================='
\echo 'AI ANALYSIS ACTIVITY REPORT'
\echo 'Generated: ' || NOW()
\echo '=========================================================================='
\echo ''

\echo '1. IMAGE AI PROCESSING STATUS'
\echo '----------------------------'
SELECT 
  ai_processing_status,
  COUNT(*) as image_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM vehicle_images
GROUP BY ai_processing_status
ORDER BY image_count DESC;

\echo ''
\echo '2. AI DATA STORAGE STATUS'
\echo '------------------------'
SELECT 
  COUNT(*) as total_images,
  COUNT(*) FILTER (WHERE ai_suggestions IS NOT NULL) as has_ai_suggestions,
  COUNT(*) FILTER (WHERE ai_detected_vehicle IS NOT NULL) as has_detected_vehicle,
  COUNT(*) FILTER (WHERE ai_detected_angle IS NOT NULL) as has_detected_angle,
  COUNT(*) FILTER (WHERE ai_processing_started_at IS NOT NULL) as processing_started,
  COUNT(*) FILTER (WHERE ai_processing_completed_at IS NOT NULL) as processing_completed,
  COUNT(*) FILTER (WHERE exif_data IS NOT NULL) as has_exif_data,
  COUNT(*) FILTER (WHERE taken_at IS NOT NULL) as has_taken_at
FROM vehicle_images;

\echo ''
\echo '3. TABLE SIZES (AI-RELATED)'
\echo '---------------------------'
SELECT 
  relname as table_name,
  pg_size_pretty(pg_total_relation_size('public.' || relname)) AS total_size,
  pg_size_pretty(pg_relation_size('public.' || relname)) AS table_size,
  n_live_tup as row_count,
  n_dead_tup as dead_rows,
  CASE 
    WHEN n_live_tup > 0 THEN ROUND(n_dead_tup * 100.0 / n_live_tup, 2)
    ELSE 0
  END as dead_row_percentage
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND (
    relname LIKE '%ai%' 
    OR relname LIKE '%image%'
    OR relname LIKE '%work%'
    OR relname LIKE '%extraction%'
    OR relname LIKE '%match%'
    OR relname LIKE '%tag%'
    OR relname LIKE '%suggestion%'
  )
ORDER BY pg_total_relation_size('public.' || relname) DESC;

\echo ''
\echo '4. RECENT IMAGE UPLOADS (Last 7 Days)'
\echo '--------------------------------------'
SELECT 
  DATE(created_at) as date,
  COUNT(*) as images_uploaded,
  COUNT(*) FILTER (WHERE ai_processing_status = 'complete') as ai_completed,
  COUNT(*) FILTER (WHERE ai_processing_status = 'pending') as ai_pending,
  COUNT(*) FILTER (WHERE ai_processing_status IS NULL) as ai_not_started,
  COUNT(*) FILTER (WHERE ai_suggestions IS NOT NULL) as has_suggestions
FROM vehicle_images
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

\echo ''
\echo '5. WORK EXTRACTION STATUS'
\echo '-------------------------'
SELECT 
  'image_work_extractions' as table_name,
  COUNT(*) as total_records,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'extracted') as extracted,
  COUNT(*) FILTER (WHERE status = 'matched') as matched,
  COUNT(*) FILTER (WHERE status = 'approved') as approved,
  COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
  MIN(created_at) as first_record,
  MAX(created_at) as last_record
FROM image_work_extractions
UNION ALL
SELECT 
  'work_organization_matches',
  COUNT(*),
  COUNT(*) FILTER (WHERE approval_status = 'pending'),
  NULL,
  NULL,
  COUNT(*) FILTER (WHERE approval_status = 'approved'),
  COUNT(*) FILTER (WHERE approval_status = 'rejected'),
  MIN(created_at),
  MAX(created_at)
FROM work_organization_matches;

\echo ''
\echo '6. AI SUGGESTIONS DATA SIZE'
\echo '---------------------------'
SELECT 
  COUNT(*) as images_with_suggestions,
  pg_size_pretty(SUM(pg_column_size(ai_suggestions))) as total_suggestions_size,
  pg_size_pretty(AVG(pg_column_size(ai_suggestions))) as avg_suggestions_size,
  MIN(pg_column_size(ai_suggestions)) as min_bytes,
  MAX(pg_column_size(ai_suggestions)) as max_bytes
FROM vehicle_images
WHERE ai_suggestions IS NOT NULL;

\echo ''
\echo '7. GROWTH TREND (Last 30 Days)'
\echo '------------------------------'
SELECT 
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as images_created,
  SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('day', created_at)) as cumulative_total
FROM vehicle_images
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

\echo ''
\echo '8. AI PROCESSING TIMELINE'
\echo '------------------------'
SELECT 
  DATE(ai_processing_started_at) as processing_date,
  COUNT(*) as images_processed,
  AVG(EXTRACT(EPOCH FROM (ai_processing_completed_at - ai_processing_started_at))) * 1000)::integer as avg_processing_time_ms
FROM vehicle_images
WHERE ai_processing_started_at IS NOT NULL
  AND ai_processing_started_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(ai_processing_started_at)
ORDER BY processing_date DESC;

\echo ''
\echo '=========================================================================='
\echo 'END OF REPORT'
\echo '=========================================================================='

