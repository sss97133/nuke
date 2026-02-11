#!/bin/bash
# worker-gooding.sh — Gooding & Company Worker
# Gatsby JSON batch extraction

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [GOODING-WORKER] $*"; }

call_fn() {
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-gooding\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null
}

log "Starting Gooding extraction"

# Step 1: Discover and enqueue sitemap URLs (one-time, avoids re-fetching)
log "Discovering and enqueuing lots..."
RESULT=$(call_fn '{"action": "discover_and_enqueue"}')
TOTAL=$(echo "$RESULT" | jq -r '.total_in_sitemap // 0' 2>/dev/null)
ENQUEUED=$(echo "$RESULT" | jq -r '.enqueued // 0' 2>/dev/null)
log "Enqueued: $ENQUEUED of $TOTAL total"

sleep 3

# Step 2: Batch process from queue
BATCH=0
while [ "$(date +%s)" -lt "$END_TIME" ]; do
  BATCH=$((BATCH + 1))
  log "Batch $BATCH (limit=100)..."
  RESULT=$(call_fn '{"action": "batch_from_queue", "limit": 100}')
  CLAIMED=$(echo "$RESULT" | jq -r '.claimed // 0' 2>/dev/null)
  PROCESSED=$(echo "$RESULT" | jq -r '.results.processed // 0' 2>/dev/null)
  NEW=$(echo "$RESULT" | jq -r '.results.new_vehicles // 0' 2>/dev/null)
  log "  Claimed: $CLAIMED, Processed: $PROCESSED, New: $NEW"

  # Stop if nothing claimed
  [ "${CLAIMED:-0}" -eq 0 ] && break

  sleep 1
done

log "Gooding worker complete."
