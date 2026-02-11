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

# Use process_with_fallback for HTML fallback coverage
for code in "${AUCTIONS[@]}"; do
  [ "$(date +%s)" -ge "$END_TIME" ] && break

  log "Processing auction (with fallback): $code"
  RESULT=$(call_fn "{\"action\": \"process_with_fallback\", \"auction\": \"$code\", \"save_to_db\": true}")
  API_LOTS=$(echo "$RESULT" | jq -r '.api_lots // 0' 2>/dev/null)
  HTML_EXTRA=$(echo "$RESULT" | jq -r '.html_extra_lots // 0' 2>/dev/null)
  CREATED=$(echo "$RESULT" | jq -r '.created // 0' 2>/dev/null)
  log "  $code: api=$API_LOTS html_extra=$HTML_EXTRA created=$CREATED"
  sleep 3
done

log "RM Sotheby's worker complete."
