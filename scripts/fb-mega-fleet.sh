#!/bin/bash
#
# Facebook Marketplace Mega Fleet
# Launches multiple FB processors in parallel
#

set -euo pipefail

cd "$(dirname "$0")/.."

NUM_WORKERS="${1:-10}"
BATCH_SIZE="${2:-50}"

echo "🏬 FACEBOOK MARKETPLACE MEGA FLEET"
echo "==================================="
echo "Workers: $NUM_WORKERS"
echo "Batch size per worker: $BATCH_SIZE"
echo "Total capacity: $((NUM_WORKERS * BATCH_SIZE)) listings"
echo ""

# Launch workers
for i in $(seq 1 $NUM_WORKERS); do
  echo "🚀 Launching FB Worker #$i..."

  nohup ./scripts/autonomous-fb-processor.sh $BATCH_SIZE \
    > "/tmp/fb-worker-$i-$(date +%s).log" 2>&1 &

  WORKER_PID=$!
  echo "  PID: $WORKER_PID"

  # Stagger launches
  sleep 2
done

echo ""
echo "✅ FB Fleet launched!"
echo ""
echo "Monitor with:"
echo "  tail -f /tmp/fb-worker-*.log"
echo ""
echo "Check progress:"
echo "  watch 'ps aux | grep autonomous-fb-processor'"
