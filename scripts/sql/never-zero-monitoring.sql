-- NUKE "NEVER ZERO" EXTRACTION MONITORING QUERIES
-- ================================================
-- Purpose: Track extraction rate to ensure the pipeline is always running
-- Primary table: bat_extraction_queue (active pipeline)
-- Secondary table: extraction_attempts (legacy, not currently active)

-- =============================================================================
-- 1. EXTRACTION RATE BY TIME WINDOW
-- =============================================================================
-- Quick health check: items completed in each time window with hourly rates
WITH time_windows AS (
    SELECT
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '30 minutes') as last_30m,
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '1 hour') as last_1h,
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '6 hours') as last_6h,
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '24 hours') as last_24h
    FROM bat_extraction_queue WHERE status = 'complete'
)
SELECT
    'EXTRACTION RATE' as metric,
    last_30m as "30m",
    ROUND(last_30m * 2.0, 1) as "30m_rate/hr",
    last_1h as "1h",
    last_6h as "6h",
    ROUND(last_6h / 6.0, 1) as "6h_rate/hr",
    last_24h as "24h",
    ROUND(last_24h / 24.0, 1) as "24h_rate/hr"
FROM time_windows;

-- =============================================================================
-- 2. STALL DETECTION (Critical for "Never Zero" monitoring)
-- =============================================================================
-- Alerts if no completions in 30 minutes (STALL) or 15 minutes (WARNING)
SELECT
    MAX(completed_at) as last_completion,
    NOW() as current_time,
    ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(completed_at)))/60, 1) as minutes_ago,
    CASE
        WHEN COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '30 minutes') = 0
            THEN 'STALL ALERT: Zero completions in 30 minutes!'
        WHEN COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '15 minutes') = 0
            THEN 'WARNING: No completions in 15 minutes'
        ELSE 'OK: Pipeline active'
    END as health_status,
    COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '30 minutes') as completions_30m
FROM bat_extraction_queue
WHERE status = 'complete';

-- =============================================================================
-- 3. TREND ANALYSIS (Is rate going up or down?)
-- =============================================================================
-- Compares recent 3-hour average to previous 9-hour average
WITH hourly_rates AS (
    SELECT
        DATE_TRUNC('hour', completed_at) as hour,
        COUNT(*) as completions
    FROM bat_extraction_queue
    WHERE status = 'complete'
    AND completed_at > NOW() - INTERVAL '12 hours'
    GROUP BY DATE_TRUNC('hour', completed_at)
    ORDER BY hour DESC
)
SELECT
    ROUND(AVG(completions) FILTER (WHERE hour > NOW() - INTERVAL '3 hours'), 1) as recent_3h_avg,
    ROUND(AVG(completions) FILTER (WHERE hour <= NOW() - INTERVAL '3 hours'), 1) as prev_9h_avg,
    CASE
        WHEN AVG(completions) FILTER (WHERE hour > NOW() - INTERVAL '3 hours') >
             AVG(completions) FILTER (WHERE hour <= NOW() - INTERVAL '3 hours') * 1.1
        THEN 'TRENDING UP (+10%)'
        WHEN AVG(completions) FILTER (WHERE hour > NOW() - INTERVAL '3 hours') <
             AVG(completions) FILTER (WHERE hour <= NOW() - INTERVAL '3 hours') * 0.9
        THEN 'TRENDING DOWN (-10%)'
        ELSE 'STABLE'
    END as trend_direction
FROM hourly_rates;

-- =============================================================================
-- 4. QUEUE HEALTH SUMMARY
-- =============================================================================
-- Overall status of the extraction queue
SELECT
    'QUEUE HEALTH' as metric,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'processing') as processing,
    COUNT(*) FILTER (WHERE status = 'complete') as complete,
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'complete') /
        NULLIF(COUNT(*) FILTER (WHERE status IN ('complete', 'failed')), 0)
    , 1) as success_rate_pct,
    ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending')))/3600, 1) as oldest_pending_hrs
FROM bat_extraction_queue;

-- =============================================================================
-- 5. HOURLY TREND (Last 24 hours)
-- =============================================================================
-- Visual of extraction rate per hour
SELECT
    DATE_TRUNC('hour', completed_at) as hour,
    COUNT(*) as completions,
    REPEAT('█', LEAST(COUNT(*)::int, 50)) as bar
FROM bat_extraction_queue
WHERE status = 'complete'
AND completed_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', completed_at)
ORDER BY hour DESC;

-- =============================================================================
-- 6. FAILURE BREAKDOWN
-- =============================================================================
-- Categorized errors for troubleshooting
SELECT
    CASE
        WHEN error_message LIKE '%out of range for type integer%' THEN 'Integer overflow (price too high)'
        WHEN error_message LIKE '%Partial extraction%' THEN 'Partial (missing VIN/specs)'
        WHEN error_message LIKE '%non-2xx status%' THEN 'Edge function error'
        WHEN error_message LIKE '%timeout%' OR error_message LIKE '%Timeout%' THEN 'Timeout'
        WHEN error_message LIKE '%rate limit%' THEN 'Rate limited'
        ELSE COALESCE(LEFT(error_message, 60), 'Unknown')
    END as error_category,
    COUNT(*) as count,
    MAX(updated_at) as last_occurrence
FROM bat_extraction_queue
WHERE status = 'failed'
GROUP BY 1
ORDER BY count DESC;

-- =============================================================================
-- 7. QUEUE DRAIN ESTIMATE
-- =============================================================================
-- How long to process all pending items at current rate
SELECT
    'QUEUE DRAIN ESTIMATE' as metric,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_items,
    (
        SELECT ROUND(COUNT(*) / 24.0, 0)
        FROM bat_extraction_queue
        WHERE status = 'complete'
        AND completed_at > NOW() - INTERVAL '24 hours'
    ) as current_rate_per_hour,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'pending') /
        NULLIF((
            SELECT COUNT(*) / 24.0
            FROM bat_extraction_queue
            WHERE status = 'complete'
            AND completed_at > NOW() - INTERVAL '24 hours'
        ), 0) / 24
    , 1) as days_to_drain
FROM bat_extraction_queue;

-- =============================================================================
-- 8. STUCK PROCESSING JOBS
-- =============================================================================
-- Jobs that have been "processing" for too long (potential worker crash)
SELECT
    id,
    bat_url,
    status,
    attempts,
    locked_at,
    locked_by,
    ROUND(EXTRACT(EPOCH FROM (NOW() - locked_at))/60, 1) as minutes_locked
FROM bat_extraction_queue
WHERE status = 'processing'
AND locked_at < NOW() - INTERVAL '10 minutes'
ORDER BY locked_at ASC
LIMIT 10;

-- =============================================================================
-- 9. COMBINED DASHBOARD (Single query for monitoring)
-- =============================================================================
-- All critical metrics in one query
SELECT
    (SELECT COUNT(*) FROM bat_extraction_queue WHERE status = 'complete' AND completed_at > NOW() - INTERVAL '30 minutes') as "completions_30m",
    (SELECT ROUND(COUNT(*) * 2.0, 1) FROM bat_extraction_queue WHERE status = 'complete' AND completed_at > NOW() - INTERVAL '30 minutes') as "rate_per_hour",
    (SELECT ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(completed_at)))/60, 1) FROM bat_extraction_queue WHERE status = 'complete') as "minutes_since_last",
    CASE
        WHEN (SELECT COUNT(*) FROM bat_extraction_queue WHERE status = 'complete' AND completed_at > NOW() - INTERVAL '30 minutes') = 0
        THEN 'STALL'
        ELSE 'OK'
    END as "stall_status",
    (SELECT COUNT(*) FROM bat_extraction_queue WHERE status = 'pending') as "pending_queue",
    (SELECT COUNT(*) FROM bat_extraction_queue WHERE status = 'processing') as "currently_processing",
    (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'complete') / NULLIF(COUNT(*) FILTER (WHERE status IN ('complete', 'failed')), 0), 1) FROM bat_extraction_queue) as "success_rate_pct";
