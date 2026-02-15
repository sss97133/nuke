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

BATCH_SIZE=25
for code in "${AUCTIONS[@]}"; do
  [ "$(date +%s)" -ge "$END_TIME" ] && break

  OFFSET=0
  TOTAL_CREATED=0
  TOTAL_PROCESSED=0
  AUCTION_TOTAL_LOTS=0

  while true; do
    [ "$(date +%s)" -ge "$END_TIME" ] && break

    log "Processing $code (offset=$OFFSET, limit=$BATCH_SIZE)"
    RESULT=$(call_fn "{\"action\": \"process\", \"auction\": \"$code\", \"save_to_db\": true, \"limit\": $BATCH_SIZE, \"offset\": $OFFSET}")

    # Check for HTTP error (empty or HTML response)
    if [ -z "$RESULT" ] || echo "$RESULT" | grep -q "<!DOCTYPE"; then
      log "  $code offset=$OFFSET: edge function error, moving to next auction"
      break
    fi

    PROCESSED=$(echo "$RESULT" | jq -r '.processed // 0' 2>/dev/null)
    CREATED=$(echo "$RESULT" | jq -r '(.created // 0) + (.updated // 0)' 2>/dev/null)
    API_TOTAL=$(echo "$RESULT" | jq -r '.total_lots // 0' 2>/dev/null)

    PROCESSED=${PROCESSED:-0}
    CREATED=${CREATED:-0}
    API_TOTAL=${API_TOTAL:-0}

    # Set auction total from first response
    if [ "$AUCTION_TOTAL_LOTS" = "0" ] && [ "$API_TOTAL" != "0" ]; then
      AUCTION_TOTAL_LOTS=$API_TOTAL
      log "  $code: API reports $AUCTION_TOTAL_LOTS total lots"
    fi

    TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))
    TOTAL_CREATED=$((TOTAL_CREATED + CREATED))

    log "  $code offset=$OFFSET: processed=$PROCESSED created=$CREATED (total so far: $TOTAL_PROCESSED/$AUCTION_TOTAL_LOTS)"

    # Stop if we've processed all lots OR offset exceeds total
    OFFSET=$((OFFSET + BATCH_SIZE))
    if [ "$AUCTION_TOTAL_LOTS" != "0" ] && [ "$OFFSET" -ge "$AUCTION_TOTAL_LOTS" ]; then
      log "  $code: reached total_lots=$AUCTION_TOTAL_LOTS, moving to next auction"
      break
    fi

    # Fallback: stop if processed < batch size (shouldn't happen with offset cap but just in case)
    if [ "$PROCESSED" -lt "$BATCH_SIZE" ] || [ "$PROCESSED" = "0" ]; then
      break
    fi

    sleep 2
  done

  log "  $code TOTAL: processed=$TOTAL_PROCESSED created=$TOTAL_CREATED"
  sleep 3
done

log "RM Sotheby's worker complete."
