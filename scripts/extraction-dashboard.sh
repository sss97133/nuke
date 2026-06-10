#!/bin/bash
#
# Live Extraction Dashboard
# Shows real-time stats on extraction progress
#

cd "$(dirname "$0")/.."

while true; do
  clear
  echo "🎯 EXTRACTION DASHBOARD"
  echo "======================="
  date
  echo ""

  # Queue stats
  echo "📊 QUEUE STATUS"
  echo "---------------"
  PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql \
    -h aws-0-us-west-1.pooler.supabase.com \
    -p 6543 \
    -U postgres.qkgaybvrernstplzjaam \
    -d postgres \
    -c "
SELECT
  status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM import_queue
WHERE listing_url LIKE '%bringatrailer.com%'
GROUP BY status
ORDER BY count DESC;
" 2>/dev/null || echo "Query failed"

  echo ""
  echo "📈 RECENT EXTRACTIONS (last 5 min)"
  echo "-----------------------------------"
  PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql \
    -h aws-0-us-west-1.pooler.supabase.com \
    -p 6543 \
    -U postgres.qkgaybvrernstplzjaam \
    -d postgres \
    -c "
SELECT
  COUNT(*) as extracted_last_5min
FROM import_queue
WHERE listing_url LIKE '%bringatrailer.com%'
  AND processed_at > NOW() - INTERVAL '5 minutes';
" 2>/dev/null || echo "Query failed"

  echo ""
  echo "🔄 ACTIVE WORKERS"
  echo "-----------------"
  ps aux | grep "[a]utonomous-bat-processor" | wc -l | xargs echo "Workers running:"

  echo ""
  echo "Refreshing in 10s... (Ctrl+C to exit)"
  sleep 10
done
