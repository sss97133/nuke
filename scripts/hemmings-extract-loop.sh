#!/bin/bash
cd /Users/skylar/nuke

echo "Starting Hemmings extraction loop..."
echo "Processing until all pending vehicles are done"
echo "Note: Using conservative settings due to rate limiting"

BATCH=0
while true; do
  BATCH=$((BATCH + 1))
  echo ""
  echo "=========================================="
  echo "BATCH $BATCH - $(date)"
  echo "=========================================="

  # Run extraction - conservative batch size and single worker
  dotenvx run -- node scripts/hemmings-proper-extract.js 30 1 2>&1

  # Check exit status
  if [ $? -ne 0 ]; then
    echo "Error in batch $BATCH, waiting 60s before retry..."
    sleep 60
    continue
  fi

  # Check if we got "Found 0 pending" in output
  RESULT=$(dotenvx run -- node scripts/hemmings-proper-extract.js 1 1 2>&1 | grep "Found 0 pending")
  if [ -n "$RESULT" ]; then
    echo ""
    echo "All Hemmings vehicles processed!"
    break
  fi

  # Longer pause between batches for rate limiting
  sleep 10
done

echo ""
echo "Hemmings extraction loop complete at $(date)"
