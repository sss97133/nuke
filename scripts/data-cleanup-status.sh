#!/bin/bash
# data-cleanup-status.sh — Run anytime to check progress of all cleanup scripts
set -e
cd /Users/skylar/nuke

echo "=== RUNNING PROCESSES ==="
ps aux | grep -E "(fix-model|fix-auction|dedupe|location-agent|classify-blank|geocode)" | grep node | grep -v grep | awk '{printf "  PID %-6s CPU %-4s %s\n", $2, $3, $11" "$12" "$13}' || echo "  None running"

echo ""
echo "=== DATABASE STATS ==="
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "
SELECT
  'Active vehicles: ' || COUNT(*)::text ||
  ' | With GPS: ' || COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::text ||
  ' (' || ROUND(100.0 * COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END) / COUNT(*), 1)::text || '%)' ||
  ' | Soft-deleted: ' || (SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NOT NULL)::text
FROM vehicles WHERE deleted_at IS NULL;
"

echo ""
echo "=== PLATFORM BREAKDOWN ==="
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
SELECT
  COALESCE(NULLIF(auction_source,''), '(blank)') as platform,
  COUNT(*)::int as total,
  COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as gps,
  ROUND(100.0 * COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END) / NULLIF(COUNT(*),0), 1) as pct_gps
FROM vehicles WHERE deleted_at IS NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
"

echo ""
echo "=== GPS BY SOURCE ==="
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
SELECT listing_location_source, COUNT(*)::int as count
FROM vehicles WHERE deleted_at IS NULL AND gps_latitude IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;
"
