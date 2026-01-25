#!/bin/bash
cd /Users/skylar/nuke

echo "Starting PCarMarket extraction loop..."
echo "Processing until all pending vehicles are done"

BATCH=0
while true; do
  BATCH=$((BATCH + 1))
  echo ""
  echo "=========================================="
  echo "BATCH $BATCH - $(date)"
  echo "=========================================="

  # Run extraction
  dotenvx run -- node scripts/pcarmarket-proper-extract.js 50 2 2>&1

  # Check exit status
  if [ $? -ne 0 ]; then
    echo "Error in batch $BATCH, waiting 30s before retry..."
    sleep 30
    continue
  fi

  # Check if we got "Found 0 pending" in output
  RESULT=$(dotenvx run -- node scripts/pcarmarket-proper-extract.js 1 1 2>&1 | grep "Found 0 pending")
  if [ -n "$RESULT" ]; then
    echo ""
    echo "All PCarMarket vehicles processed!"
    break
  fi

  # Brief pause between batches
  sleep 5
done

echo ""
echo "PCarMarket extraction loop complete at $(date)"
