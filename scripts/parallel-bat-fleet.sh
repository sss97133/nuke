#!/bin/bash
# Parallel BaT extraction fleet
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs

NUM_WORKERS="${1:-4}"
BATCH_SIZE="${2:-50}"

echo "🚀 Launching $NUM_WORKERS parallel BaT workers (batch=$BATCH_SIZE each)"

for i in $(seq 1 $NUM_WORKERS); do
  echo "Starting worker $i..."
  nohup dotenvx run -- bash scripts/autonomous-bat-processor.sh $BATCH_SIZE > logs/bat-fleet-$i.log 2>&1 &
  echo "  PID: $!"
  sleep 2
done

echo ""
echo "All workers launched. Monitor with:"
echo "  tail -f logs/bat-fleet-*.log"
