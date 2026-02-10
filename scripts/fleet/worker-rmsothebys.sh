#!/bin/bash
# worker-rmsothebys.sh — RM Sotheby's API Worker
# Processes all 14 auction codes via internal API

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [RM-WORKER] $*"; }

call_fn() {
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-rmsothebys\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null
}

AUCTIONS=(PA26 AZ26 CC26 MI26 S0226 PA25 AZ25 MO25 MI25 MT25 PA24 AZ24 MO24 MT24)

log "Starting RM Sotheby's extraction for ${#AUCTIONS[@]} auctions"

for code in "${AUCTIONS[@]}"; do
  [ "$(date +%s)" -ge "$END_TIME" ] && break

  log "Processing auction: $code"
  RESULT=$(call_fn "{\"action\": \"process\", \"auction\": \"$code\", \"save_to_db\": true}")
  SUCCESS=$(echo "$RESULT" | jq -r '.success' 2>/dev/null)
  LOTS=$(echo "$RESULT" | jq -r '.lots_processed // .count // 0' 2>/dev/null)
  NEW=$(echo "$RESULT" | jq -r '.new_vehicles // 0' 2>/dev/null)
  log "  $code: success=$SUCCESS lots=$LOTS new=$NEW"
  sleep 3
done

# Second pass: list_all for any missed lots
log "Second pass: list_all for comprehensive extraction"
RESULT=$(call_fn '{"action": "list_all", "save_to_db": true}')
log "list_all: $(echo "$RESULT" | jq -c '{success: .success, total: .total_lots}' 2>/dev/null)"

log "RM Sotheby's worker complete."
