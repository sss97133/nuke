#!/bin/bash
# overnight-extraction.sh — Long-running BaT extraction pipeline
# Budget cap: $60 total
set -euo pipefail
cd /Users/skylar/nuke

LOG="/Users/skylar/nuke/data/overnight-extraction-$(date +%Y%m%d).log"
echo "=== OVERNIGHT EXTRACTION STARTED $(date) ===" | tee "$LOG"

# Wait for current batch to finish
echo "Waiting for current v3 batch..." | tee -a "$LOG"
while pgrep -f "extract-bat-v3.mjs --run" > /dev/null 2>&1; do
  sleep 30
done
echo "Current batch completed at $(date)" | tee -a "$LOG"

# Process in chunks of 500
for i in $(seq 1 20); do
  echo "" | tee -a "$LOG"
  echo "=== Chunk $i ($(date)) ===" | tee -a "$LOG"

  OUTPUT=$(dotenvx run -- node scripts/extract-bat-v3.mjs --run 500 2>&1)
  echo "$OUTPUT" | tee -a "$LOG"

  # Check if no more vehicles
  if echo "$OUTPUT" | grep -q "No more vehicles"; then
    echo "ALL VEHICLES PROCESSED." | tee -a "$LOG"
    break
  fi

  sleep 5
done

echo "=== OVERNIGHT EXTRACTION FINISHED $(date) ===" | tee -a "$LOG"
dotenvx run -- node scripts/extract-bat-v3.mjs --stats 2>&1 | tee -a "$LOG"
