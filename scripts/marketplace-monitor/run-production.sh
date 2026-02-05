#!/bin/bash
# Production FB Marketplace Monitor - runs continuously

cd /Users/skylar/nuke

echo "🚀 Starting FB Marketplace production system..."
echo "📍 145 markets, 15-min cycles, auto-import"

# Kill any existing monitors
pkill -f "marketplace-monitor/monitor.ts" 2>/dev/null || true
sleep 2
rm -f fb-session/SingletonLock 2>/dev/null || true

# Start the monitor
echo "Starting monitor..."
nohup dotenvx run -- npx tsx scripts/marketplace-monitor/monitor.ts > logs/marketplace-monitor.log 2>&1 &
MONITOR_PID=$!
echo "Monitor PID: $MONITOR_PID"

# Run auto-import every 10 minutes
echo "Starting auto-import loop..."
while true; do
  sleep 600  # 10 minutes
  
  # Import new listings to vehicles
  echo "[$(date)] Running auto-import..."
  dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/import-fb-marketplace" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": 100}"' 2>/dev/null | jq -r '"Imported: \(.created // 0) vehicles"'
  
done
