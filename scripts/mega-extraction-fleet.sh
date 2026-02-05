#!/bin/bash
#
# MEGA EXTRACTION FLEET
# Launches multiple parallel extractors to process the queue at scale
#

set -euo pipefail

cd "$(dirname "$0")/.."

NUM_WORKERS="${1:-5}"
BATCH_SIZE="${2:-50}"

echo "🚢 MEGA EXTRACTION FLEET"
echo "========================"
echo "Workers: $NUM_WORKERS"
echo "Batch size per worker: $BATCH_SIZE"
echo "Total capacity: $((NUM_WORKERS * BATCH_SIZE)) listings"
echo ""

# Launch workers
for i in $(seq 1 $NUM_WORKERS); do
  echo "🚀 Launching Worker #$i..."

  nohup ./scripts/autonomous-bat-processor.sh $BATCH_SIZE \
    > "/tmp/worker-$i-$(date +%s).log" 2>&1 &

  WORKER_PID=$!
  echo "  PID: $WORKER_PID"

  # Stagger launches
  sleep 2
done

echo ""
echo "✅ Fleet launched!"
echo ""
echo "Monitor with:"
echo "  tail -f /tmp/worker-*.log"
echo ""
echo "Check progress:"
echo "  watch 'ps aux | grep autonomous-bat-processor'"
