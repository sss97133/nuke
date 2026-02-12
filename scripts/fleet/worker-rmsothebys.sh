#!/bin/bash
# worker-rmsothebys.sh — RM Sotheby's API Worker
# Processes all 14 auction codes via internal API using batch 'process' action
# (process_with_fallback times out on large auctions)

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [RM-WORKER] $*"; }

call_fn() {
  local raw
  raw=$(dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-rmsothebys\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null)
  # Strip ANSI codes and dotenvx noise, extract JSON object
  echo "$raw" | sed 's/\x1b\[[0-9;]*m//g' | sed -n '/^{/,/^}/p'
}

AUCTIONS=(PA26 AZ26 CC26 MI26 S0226 PA25 AZ25 MO25 MI25 MT25 PA24 AZ24 MO24 MT24)

log "Starting RM Sotheby's extraction for ${#AUCTIONS[@]} auctions"

# Use 'process' action with limit/offset batching to stay under edge function timeout
BATCH_SIZE=25
for code in "${AUCTIONS[@]}"; do
  [ "$(date +%s)" -ge "$END_TIME" ] && break

  OFFSET=0
  TOTAL_CREATED=0
  TOTAL_LOTS=0

  while true; do
    [ "$(date +%s)" -ge "$END_TIME" ] && break

    log "Processing $code (offset=$OFFSET, limit=$BATCH_SIZE)"
    RESULT=$(call_fn "{\"action\": \"process\", \"auction\": \"$code\", \"save_to_db\": true, \"limit\": $BATCH_SIZE, \"offset\": $OFFSET}")

    # Check for HTTP error (empty or HTML response)
    if [ -z "$RESULT" ] || echo "$RESULT" | grep -q "<!DOCTYPE"; then
      log "  $code offset=$OFFSET: edge function error (timeout or crash), moving to next auction"
      break
    fi

    PROCESSED=$(echo "$RESULT" | jq -r '.processed // 0' 2>/dev/null)
    CREATED=$(echo "$RESULT" | jq -r '(.created // 0) + (.updated // 0)' 2>/dev/null)

    # Default to 0 if jq failed
    PROCESSED=${PROCESSED:-0}
    CREATED=${CREATED:-0}

    TOTAL_LOTS=$((TOTAL_LOTS + PROCESSED))
    TOTAL_CREATED=$((TOTAL_CREATED + CREATED))

    log "  $code offset=$OFFSET: processed=$PROCESSED created=$CREATED"

    # If we got fewer than BATCH_SIZE, we've exhausted this auction
    if [ "$PROCESSED" -lt "$BATCH_SIZE" ] || [ "$PROCESSED" = "0" ]; then
      break
    fi

    OFFSET=$((OFFSET + BATCH_SIZE))
    sleep 2
  done

  log "  $code TOTAL: lots=$TOTAL_LOTS created=$TOTAL_CREATED"
  sleep 3
done

log "RM Sotheby's worker complete."
