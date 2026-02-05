#!/bin/bash
#
# Live Extraction Monitor - Shows real-time progress
#

cd "$(dirname "$0")/.."

echo "🔥 LIVE EXTRACTION MONITOR"
echo "=========================="
echo ""

# Worker count
WORKERS=$(ps aux | grep "[a]utonomous-bat-processor" | wc -l | xargs)
echo "⚡ Active Workers: $WORKERS"
echo ""

# Sample current activity
echo "📋 Current Processing (sample):"
tail -50 /tmp/worker-*.log 2>/dev/null | grep "Processing:" | tail -10
echo ""

# Recent successes
echo "✅ Recent Successes:"
tail -100 /tmp/worker-*.log 2>/dev/null | grep "Success" | tail -5
echo ""

# Recent failures
echo "❌ Recent Failures:"
tail -100 /tmp/worker-*.log 2>/dev/null | grep "Failed" | tail -3
echo ""

# Queue stats
echo "📊 Queue Status:"
PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
  -h aws-0-us-west-1.pooler.supabase.com \
  -p 6543 \
  -U postgres.qkgaybvrernstplzjaam \
  -d postgres \
  -t -A \
  -c "SELECT 'Pending: ' || COUNT(*) FROM import_queue WHERE listing_url LIKE '%bringatrailer.com%' AND status = 'pending' AND attempts < max_attempts;" 2>&1

echo ""
echo "🔄 This batch capacity: $WORKERS workers × ~50 listings = ~$((WORKERS * 50 / 3)) listings"
echo ""
echo "Refreshing every 10s..."
