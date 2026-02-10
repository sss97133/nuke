#!/bin/bash
# worker-bj.sh — Barrett-Jackson Worker
# Uses local Playwright via bj-docket-extractor.ts

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [BJ-WORKER] $*"; }

log "Starting Barrett-Jackson extraction"

# Check if bj-docket-extractor exists
if [ ! -f "scripts/bj-docket-extractor.ts" ]; then
  log "ERROR: scripts/bj-docket-extractor.ts not found"
  exit 1
fi

# Run the Playwright-based docket extractor
log "Running BJ docket extractor (Playwright)..."
dotenvx run -- npx tsx scripts/bj-docket-extractor.ts 2>&1 | while read -r line; do
  log "  $line"
done

log "BJ docket extractor finished."

# Now process pending BJ URLs from queue via process-import-queue
# Process in batches of 5 to avoid overwhelming
log "Processing queued BJ URLs..."
BATCH=0
while [ "$(date +%s)" -lt "$END_TIME" ]; do
  BATCH=$((BATCH + 1))
  log "  Batch $BATCH (5 URLs)..."

  RESULT=$(dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/process-import-queue\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"batch_size\": 5, \"source_id\": null}'" 2>/dev/null)

  PROCESSED=$(echo "$RESULT" | jq -r '.processed // 0' 2>/dev/null)
  log "  Batch $BATCH: processed $PROCESSED"

  # If nothing to process, check remaining
  if [ "${PROCESSED:-0}" -eq 0 ]; then
    REMAINING=$(dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c \"SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%barrett-jackson%' AND status='pending';\"" 2>/dev/null | grep -v 'dotenvx' | grep -v 'injecting' | tr -d ' \n')
    log "  Remaining BJ pending: $REMAINING"
    if [ -z "$REMAINING" ] || { [ "$REMAINING" -eq "$REMAINING" ] 2>/dev/null && [ "${REMAINING:-0}" -eq 0 ]; }; then
      log "  No more BJ URLs to process"
      break
    fi
    sleep 30
  else
    sleep 5
  fi

  # Cap at 1000 batches to avoid infinite loops
  [ "$BATCH" -ge 1000 ] && break
done

log "Barrett-Jackson worker complete."
