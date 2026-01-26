#!/bin/bash
#
# OVERNIGHT EXTRACTION RUNNER
#
# Runs extraction for ~8 hours with auto-restart and monitoring
#
# Pipelines:
#   1. Mecum: Uses local node scripts (already running, will restart if dead)
#   2. Cars & Bids: Uses edge function (via Firecrawl, not blocked)
#
# Usage: ./scripts/overnight-extraction.sh
#

cd /Users/skylar/nuke
mkdir -p .ralph/logs

LOG_FILE=".ralph/logs/overnight_$(date +%Y%m%d_%H%M%S).log"

log() {
  echo "[$(date +%H:%M:%S)] $1" | tee -a "$LOG_FILE"
}

# Duration: ~8 hours (with buffer)
END_TIME=$(($(date +%s) + 28800))

log "═══════════════════════════════════════════════════════════════"
log "  OVERNIGHT EXTRACTION STARTED"
log "  Will run until: $(date -r $END_TIME '+%Y-%m-%d %H:%M:%S')"
log "═══════════════════════════════════════════════════════════════"
log ""

ensure_mecum_running() {
  if ! pgrep -f "mecum-proper-extract" > /dev/null; then
    log "Mecum extraction not running, starting..."
    nohup dotenvx run -- node scripts/mecum-proper-extract.js 100 3 >> .ralph/logs/mecum_extraction.log 2>&1 &
    log "Mecum started (PID $!)"
  fi
}

extract_carsandbids_batch() {
  # Get a pending C&B vehicle URL
  local VEHICLE=$(dotenvx run -- bash -c 'curl -sS "$VITE_SUPABASE_URL/rest/v1/vehicles?discovery_source=eq.carsandbids&status=eq.pending&select=id,discovery_url&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null | grep -o '{[^}]*}' | head -1)

  if [ -z "$VEHICLE" ]; then
    return 1
  fi

  local URL=$(echo "$VEHICLE" | grep -o '"discovery_url":"[^"]*"' | cut -d'"' -f4)
  local ID=$(echo "$VEHICLE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$URL" ]; then
    return 1
  fi

  # Call edge function with the URL
  local RESULT=$(dotenvx run -- bash -c "curl -sS -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-cars-and-bids-core\" \
    -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
    -H \"Content-Type: application/json\" \
    -d '{\"url\": \"$URL\", \"vehicle_id\": \"$ID\"}'" 2>/dev/null)

  # Check result
  if echo "$RESULT" | grep -q '"success":true'; then
    log "C&B ✓ $URL"
    return 0
  else
    log "C&B ✗ $URL"
    # Mark as failed to avoid retry loop
    dotenvx run -- bash -c "curl -sS -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/vehicles?id=eq.$ID\" \
      -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"status\": \"failed\", \"notes\": \"Edge function extraction failed\"}'" 2>/dev/null
    return 1
  fi
}

# Main loop
MECUM_CHECK_INTERVAL=300  # Check Mecum every 5 min
CAB_DELAY=5  # Delay between C&B extractions (rate limit friendly)
LAST_MECUM_CHECK=0
CAB_SUCCESS=0
CAB_FAIL=0

while [ $(date +%s) -lt $END_TIME ]; do
  NOW=$(date +%s)

  # Check/restart Mecum periodically
  if [ $((NOW - LAST_MECUM_CHECK)) -ge $MECUM_CHECK_INTERVAL ]; then
    ensure_mecum_running
    LAST_MECUM_CHECK=$NOW

    # Log stats
    MECUM_PENDING=$(dotenvx run -- bash -c 'curl -sS "$VITE_SUPABASE_URL/rest/v1/vehicles?discovery_source=eq.mecum&status=eq.pending&select=id" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -I' 2>/dev/null | grep -i content-range | grep -o '/[0-9]*' | tr -d '/')
    CAB_PENDING=$(dotenvx run -- bash -c 'curl -sS "$VITE_SUPABASE_URL/rest/v1/vehicles?discovery_source=eq.carsandbids&status=eq.pending&select=id" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -I' 2>/dev/null | grep -i content-range | grep -o '/[0-9]*' | tr -d '/')

    log "STATUS: Mecum pending=$MECUM_PENDING | C&B pending=$CAB_PENDING | C&B this session: ✓$CAB_SUCCESS ✗$CAB_FAIL"
  fi

  # Extract one C&B vehicle
  if extract_carsandbids_batch; then
    ((CAB_SUCCESS++))
  else
    ((CAB_FAIL++))
    # If we're getting continuous failures, slow down
    if [ $CAB_FAIL -gt 10 ] && [ $((CAB_FAIL % 10)) -eq 0 ]; then
      log "Multiple C&B failures, pausing 60s..."
      sleep 60
    fi
  fi

  sleep $CAB_DELAY
done

log ""
log "═══════════════════════════════════════════════════════════════"
log "  OVERNIGHT EXTRACTION COMPLETE"
log "  C&B Results: ✓$CAB_SUCCESS ✗$CAB_FAIL"
log "═══════════════════════════════════════════════════════════════"
