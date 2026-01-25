#!/bin/bash
cd /Users/skylar/nuke

echo "Starting Mecum extraction loop..."
echo "Processing until all pending vehicles are done"

BATCH=0
while true; do
  BATCH=$((BATCH + 1))
  echo ""
  echo "=========================================="
  echo "BATCH $BATCH - $(date)"
  echo "=========================================="
  
  # Run extraction - script will exit when no more pending
  dotenvx run -- node scripts/mecum-proper-extract.js 500 3 2>&1
  
  # Check exit status
  if [ $? -ne 0 ]; then
    echo "Error in batch $BATCH, waiting 30s before retry..."
    sleep 30
    continue
  fi
  
  # Check if we got "Found 0 pending" in output
  RESULT=$(dotenvx run -- node scripts/mecum-proper-extract.js 1 1 2>&1 | grep "Found 0 pending")
  if [ -n "$RESULT" ]; then
    echo ""
    echo "All Mecum vehicles processed!"
    break
  fi
  
  # Brief pause between batches
  sleep 3
done

echo ""
echo "Mecum extraction loop complete at $(date)"
