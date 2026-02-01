#!/bin/bash
# CONTINUOUS DISCOVERY - Runs all extraction/discovery jobs in a loop
# Run this on any machine with .env to keep data growing

cd "$(dirname "$0")/.."
source .env 2>/dev/null || { echo "Need .env"; exit 1; }

LOG_FILE="continuous-discovery.log"
STOP_FILE=".stop-discovery"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

call_function() {
  local name=$1
  local body=${2:-"{}"}
  curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/$name" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$body"
}

log "=========================================="
log "CONTINUOUS DISCOVERY STARTED"
log "Stop: touch $STOP_FILE"
log "=========================================="

rm -f "$STOP_FILE"

while true; do
  if [[ -f "$STOP_FILE" ]]; then
    log "Stop signal received."
    rm -f "$STOP_FILE"
    break
  fi

  # 1. Villa Discovery (St Barth concierge) - every 2 hours
  log "Running villa discovery..."
  result=$(call_function "concierge-discovery-cron")
  villas=$(echo "$result" | grep -o '"total_villas":[0-9]*' | cut -d: -f2)
  log "Villa discovery: $villas villas in DB"

  # 2. Comment Sentiment Discovery - batches of 10
  log "Running comment sentiment discovery..."
  for i in {1..5}; do
    result=$(call_function "discover-comment-data" '{"batch_size": 10}')
    processed=$(echo "$result" | grep -o '"processed":[0-9]*' | cut -d: -f2)
    [ -z "$processed" ] || [ "$processed" == "0" ] && break
    log "  Sentiment batch $i: $processed processed"
    sleep 2
  done

  # 3. BaT Comment Extraction - if there are pending
  log "Checking BaT extraction queue..."
  result=$(call_function "backfill-comments" '{"batch_size": 5}')
  log "  BaT: $result"

  # 4. Discovery Snowball - find new leads
  log "Running discovery snowball..."
  result=$(call_function "discovery-snowball" '{"limit": 10}')
  leads=$(echo "$result" | grep -o '"new_leads":[0-9]*' | cut -d: -f2)
  log "  Snowball: ${leads:-0} new leads"

  log "Cycle complete. Sleeping 30 minutes..."

  # Sleep in chunks to check stop file
  for i in {1..60}; do
    [ -f "$STOP_FILE" ] && break
    sleep 30
  done
done

log "CONTINUOUS DISCOVERY STOPPED"
