-- CURATOR DASHBOARD
-- Quick queries for managing autonomous agents and curated sources

-- ===========================================
-- DAILY CURATION CHECKS (5 minutes)
-- ===========================================

-- 1. Agent performance last 24 hours
SELECT 
  'AGENT PERFORMANCE LAST 24H' as metric,
  agent_name,
  COUNT(*) as runs,
  SUM(vehicles_processed) as vehicles,
  ROUND(AVG(CASE WHEN success THEN 100 ELSE 0 END), 1) as success_rate,
  MAX(started_at) as last_run
FROM agent_execution_logs 
WHERE started_at >= NOW() - INTERVAL '24 hours'
GROUP BY agent_name
ORDER BY vehicles DESC;

-- 2. Are we on track for 1M profiles in 30 days?
SELECT 
  'PROGRESS TO 1M GOAL' as metric,
  COUNT(*) as vehicles_last_24h,
  COUNT(*) * 30 as projected_monthly,
  CASE WHEN COUNT(*) * 30 >= 1000000 THEN '✅ ON TRACK' ELSE '❌ BEHIND SCHEDULE' END as status
FROM vehicles 
WHERE created_at >= NOW() - INTERVAL '24 hours';

-- 3. Source performance ranking
SELECT 
  'SOURCE PERFORMANCE' as metric,
  cs.source_name,
  cs.priority,
  cs.expected_daily_vehicles,
  COALESCE(recent.actual_vehicles, 0) as actual_vehicles_24h,
  CASE 
    WHEN recent.actual_vehicles >= cs.expected_daily_vehicles THEN '✅ EXCEEDING'
    WHEN recent.actual_vehicles >= cs.expected_daily_vehicles * 0.8 THEN '⚠️ CLOSE'
    ELSE '❌ UNDERPERFORMING'
  END as performance
FROM curated_sources cs
LEFT JOIN (
  SELECT 
    ss.url,
    COUNT(v.id) as actual_vehicles
  FROM scrape_sources ss
  JOIN import_queue iq ON iq.source_id = ss.id
  JOIN vehicles v ON v.discovery_url = iq.listing_url
  WHERE v.created_at >= NOW() - INTERVAL '24 hours'
  GROUP BY ss.url
) recent ON recent.url = cs.source_url
WHERE cs.is_active = true
ORDER BY cs.priority DESC, actual_vehicles_24h DESC;

-- ===========================================
-- CURATION ACTIONS
-- ===========================================

-- Boost high-performing sources
-- UPDATE curated_sources SET priority = priority + 1 WHERE source_name = 'Cars & Bids';

-- Demote underperforming sources  
-- UPDATE curated_sources SET priority = priority - 1 WHERE source_name = 'Slow Site';

-- Disable failing sources
-- UPDATE curated_sources SET is_active = false WHERE source_name = 'Broken Site';

-- Add new premium source
-- INSERT INTO curated_sources (source_name, source_url, source_type, priority, expected_daily_vehicles, curation_notes)
-- VALUES ('New Premium Site', 'https://example.com', 'auction_house', 8, 20, 'High-value classics');

-- ===========================================
-- WEEKLY CURATION REVIEW (15 minutes)
-- ===========================================

-- 1. Agent success rates over time
SELECT 
  'WEEKLY AGENT TRENDS' as metric,
  agent_name,
  DATE_TRUNC('day', started_at) as day,
  COUNT(*) as executions,
  AVG(vehicles_processed) as avg_vehicles,
  ROUND(AVG(CASE WHEN success THEN 100 ELSE 0 END), 1) as success_rate
FROM agent_execution_logs 
WHERE started_at >= NOW() - INTERVAL '7 days'
GROUP BY agent_name, DATE_TRUNC('day', started_at)
ORDER BY day DESC, avg_vehicles DESC;

-- 2. Discover high-potential sources to curate
SELECT 
  'POTENTIAL NEW SOURCES' as metric,
  ss.name,
  ss.url,
  ss.total_listings_found,
  COUNT(v.id) as vehicles_created,
  ROUND(COUNT(v.id)::FLOAT / NULLIF(ss.total_listings_found, 0) * 100, 1) as conversion_rate
FROM scrape_sources ss
LEFT JOIN import_queue iq ON iq.source_id = ss.id
LEFT JOIN vehicles v ON v.discovery_url = iq.listing_url
WHERE ss.created_at >= NOW() - INTERVAL '7 days'
  AND ss.url NOT IN (SELECT source_url FROM curated_sources)
  AND ss.total_listings_found > 10
GROUP BY ss.name, ss.url, ss.total_listings_found
HAVING COUNT(v.id) > 5
ORDER BY conversion_rate DESC, vehicles_created DESC;

-- ===========================================
-- MONTHLY STRATEGIC CURATION (30 minutes)
-- ===========================================

-- 1. Top performing curated sources (promote these)
SELECT 
  'TOP PERFORMERS LAST MONTH' as metric,
  cs.source_name,
  SUM(monthly.vehicles) as total_vehicles,
  AVG(monthly.vehicles) as avg_daily,
  cs.expected_daily_vehicles,
  ROUND(AVG(monthly.vehicles) / cs.expected_daily_vehicles * 100, 1) as efficiency
FROM curated_sources cs
JOIN (
  SELECT 
    ss.url,
    DATE(v.created_at) as day,
    COUNT(v.id) as vehicles
  FROM scrape_sources ss
  JOIN import_queue iq ON iq.source_id = ss.id  
  JOIN vehicles v ON v.discovery_url = iq.listing_url
  WHERE v.created_at >= NOW() - INTERVAL '30 days'
  GROUP BY ss.url, DATE(v.created_at)
) monthly ON monthly.url = cs.source_url
GROUP BY cs.source_name, cs.expected_daily_vehicles
ORDER BY total_vehicles DESC;

-- 2. Underperforming sources (review/remove these)
SELECT 
  'UNDERPERFORMERS LAST MONTH' as metric,
  source_name,
  priority,
  expected_daily_vehicles,
  'Consider reducing priority or investigating issues' as action
FROM curated_sources cs
WHERE NOT EXISTS (
  SELECT 1 FROM scrape_sources ss
  JOIN import_queue iq ON iq.source_id = ss.id
  JOIN vehicles v ON v.discovery_url = iq.listing_url  
  WHERE ss.url = cs.source_url
    AND v.created_at >= NOW() - INTERVAL '7 days'
)
AND is_active = true
ORDER BY priority DESC;

-- ===========================================
-- AGENT CONTROL COMMANDS
-- ===========================================

-- Manually trigger agent (for testing)
-- SELECT trigger_agent_execution('premium-auction-extractor');

-- Pause all agents (maintenance mode)
-- UPDATE agent_configs SET is_active = false;

-- Resume all agents
-- UPDATE agent_configs SET is_active = true;

-- View current cron schedules
SELECT 
  'CURRENT SCHEDULES' as info,
  jobname,
  schedule,
  command,
  active
FROM cron.job
WHERE jobname LIKE '%auction%' OR jobname LIKE '%agent%';
