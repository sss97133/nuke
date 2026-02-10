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

# Discover sitemap
log "Discovering lots..."
RESULT=$(call_fn '{"action": "discover"}')
log "Discover: $(echo "$RESULT" | jq -c '{success: .success, total: .total_lots}' 2>/dev/null)"

sleep 3

# Batch process in pages of 100
OFFSET=0
while [ "$(date +%s)" -lt "$END_TIME" ]; do
  log "Batch: offset=$OFFSET limit=100"
  RESULT=$(call_fn "{\"action\": \"batch\", \"limit\": 100, \"offset\": $OFFSET}")
  PROCESSED=$(echo "$RESULT" | jq -r '.processed // 0' 2>/dev/null)
  NEW=$(echo "$RESULT" | jq -r '.new_vehicles // 0' 2>/dev/null)
  log "  Processed: $PROCESSED, New: $NEW"

  # Stop if no more to process
  [ "${PROCESSED:-0}" -eq 0 ] && break

  OFFSET=$((OFFSET + 100))
  sleep 3
done

# Backfill pass
log "Running backfill..."
RESULT=$(call_fn '{"action": "backfill", "limit": 200}')
log "Backfill: $(echo "$RESULT" | jq -c '{success: .success, updated: .updated}' 2>/dev/null)"

log "Gooding worker complete."
