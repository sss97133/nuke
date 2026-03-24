#!/bin/bash
# batch-extract-loop.sh — Loops batch-extract-snapshots across platforms
# Extracts structured data from archived HTML snapshots (regex-based, no LLM cost)
# Designed for cron/scheduled execution every 10-15 minutes
#
# Usage: dotenvx run -- bash scripts/scheduled/batch-extract-loop.sh

set -euo pipefail
cd /Users/skylar/nuke

BATCH_SIZE=${1:-200}
SUPABASE_URL="$VITE_SUPABASE_URL"
AUTH="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

echo "=== Batch Extract Snapshots — $(date) ==="

for PLATFORM in bat mecum barrett-jackson cars-and-bids bonhams; do
  echo "--- $PLATFORM (batch_size=$BATCH_SIZE) ---"
  RESULT=$(curl -s -X POST "$SUPABASE_URL/functions/v1/batch-extract-snapshots" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": $BATCH_SIZE, \"platform\": \"$PLATFORM\", \"mode\": \"sparse\"}" 2>&1) || true
  echo "$RESULT" | jq -r '.extracted // .error // "no response"' 2>/dev/null || echo "$RESULT" | head -5
  sleep 2
done

echo "=== Done — $(date) ==="
