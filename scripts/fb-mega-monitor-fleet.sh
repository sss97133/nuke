#!/bin/bash
#
# FB Marketplace Mega Monitor Fleet
# Launches multiple marketplace monitors in parallel to scale ingestion
#

set -euo pipefail

cd "$(dirname "$0")/.."

NUM_MONITORS="${1:-5}"

echo "🏬 FACEBOOK MARKETPLACE MEGA MONITOR FLEET"
echo "==========================================="
echo "Launching $NUM_MONITORS parallel monitors"
echo ""

# Check if marketplace-monitor exists
if [ ! -d "scripts/marketplace-monitor" ]; then
  echo "❌ marketplace-monitor directory not found"
  exit 1
fi

cd scripts/marketplace-monitor

# Launch monitors
for i in $(seq 1 $NUM_MONITORS); do
  echo "🚀 Launching Monitor #$i..."

  # Each monitor gets its own log file
  nohup npx tsx monitor.ts > "/tmp/fb-monitor-$i-$(date +%s).log" 2>&1 &

  MONITOR_PID=$!
  echo "  PID: $MONITOR_PID"
  echo "  Log: /tmp/fb-monitor-$i-*.log"

  # Stagger launches to avoid FB rate limits
  sleep 5
done

echo ""
echo "✅ Monitor fleet launched!"
echo ""
echo "Monitor progress:"
echo "  tail -f /tmp/fb-monitor-*.log"
echo ""
echo "Check marketplace_listings:"
echo "  SELECT COUNT(*) FROM marketplace_listings WHERE created_at > NOW() - INTERVAL '1 hour';"
