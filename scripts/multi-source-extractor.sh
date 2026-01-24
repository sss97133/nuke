#!/bin/bash
# MULTI-SOURCE EXTRACTION LOOP WITH ERROR MONITORING AND SELF-REPAIR
# Priority sources: BaT, Cars & Bids, PCarMarket, Hagerty, RM Sotheby's

cd /Users/skylar/nuke

# Config
LOG_FILE="logs/multi-source-extractor.log"
ERROR_LOG="logs/extraction-errors.log"
CHECK_INTERVAL=60  # seconds between health checks
REPAIR_INTERVAL=300  # seconds between repair attempts

# Initialize
mkdir -p logs
: > "$ERROR_LOG"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" | tee -a "$LOG_FILE" >> "$ERROR_LOG"
}

log "=== MULTI-SOURCE EXTRACTOR STARTING ==="
log "Priority sources: bat, cab, pcarmarket, hagerty, rm-sothebys, bonhams"

# Health check function - test if an edge function responds
check_extractor_health() {
  local extractor=$1
  local result

  result=$(dotenvx run --quiet -- bash -c "curl -s -w '%{http_code}' -o /dev/null -m 10 \
    \"\$VITE_SUPABASE_URL/functions/v1/$extractor\" \
    -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
    -H \"Content-Type: application/json\" \
    -d '{\"test\": true}'" 2>/dev/null || echo "000")

  # 200=ok, 400/422=bad input but function works, 500=error but alive
  if [[ "$result" =~ ^[245][0-9][0-9]$ ]]; then
    return 0
  else
    return 1
  fi
}

# Get queue stats
get_queue_stats() {
  dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?select=status" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null | \
    jq -r 'group_by(.status) | map({status: .[0].status, count: length}) | .[] | "\(.status): \(.count)"' 2>/dev/null || echo "queue: unavailable"
}

# Retry failed extractions
retry_failed_extractions() {
  log "Checking for failed extractions to retry..."

  local failed
  failed=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.error&select=id&limit=10" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

  local count
  count=$(echo "$failed" | jq 'length' 2>/dev/null || echo "0")

  if [[ "$count" -gt 0 && "$count" != "null" ]]; then
    log "Resetting $count failed items to pending"

    # Reset in batch
    dotenvx run --quiet -- bash -c 'curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.error" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"status\": \"pending\", \"error_message\": null}" \
      -H "Prefer: count=exact"' 2>/dev/null
  fi
}

# Check for data quality issues
check_data_quality() {
  log "Checking data quality..."

  # Bad prices (<$100 for BaT vehicles)
  local bad_prices
  bad_prices=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?sale_price=gt.0&sale_price=lt.100&bat_auction_url=not.is.null&select=count" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Prefer: count=exact"' 2>/dev/null | jq '.[0].count // 0' 2>/dev/null || echo "0")

  if [[ "$bad_prices" -gt 0 ]]; then
    log "Found $bad_prices vehicles with suspicious prices - triggering auto-fix"
    dotenvx run --quiet -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/auto-fix-bat-prices" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"limit\": 10}"' 2>/dev/null || true
  else
    log "Data quality: OK (no suspicious prices)"
  fi
}

# Process import queue
process_queue() {
  log "Processing import queue..."

  local result
  result=$(dotenvx run --quiet -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/process-import-queue" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": 5}"' 2>/dev/null)

  local processed
  processed=$(echo "$result" | jq '.processed // 0' 2>/dev/null || echo "?")
  log "Queue processed: $processed items"
}

# Trigger BaT active crawler
trigger_bat_crawler() {
  log "Triggering BaT active listings crawler..."

  local result
  result=$(dotenvx run --quiet -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/crawl-bat-active" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"limit\": 20}"' 2>/dev/null)

  local found
  found=$(echo "$result" | jq '.listings_found // .count // 0' 2>/dev/null || echo "?")
  log "BaT crawler: found $found listings"
}

# Main health check loop
main_loop() {
  local loop_count=0
  local last_repair=0

  while true; do
    loop_count=$((loop_count + 1))
    local now
    now=$(date +%s)

    log "=== Health Check #$loop_count ==="

    # Check priority extractors
    for extractor in bat-simple-extract extract-cars-and-bids-core import-pcarmarket-listing extract-hagerty-listing; do
      if check_extractor_health "$extractor"; then
        log "[$extractor] ✓ OK"
      else
        log_error "[$extractor] ✗ FAILED"
      fi
    done

    # Get queue stats
    log "Queue status:"
    while IFS= read -r line; do
      log "  $line"
    done < <(get_queue_stats)

    # Process queue
    process_queue

    # Periodic repair (every REPAIR_INTERVAL seconds)
    if [[ $((now - last_repair)) -ge $REPAIR_INTERVAL ]]; then
      log "=== Running periodic maintenance ==="
      retry_failed_extractions
      check_data_quality
      last_repair=$now
    fi

    # Trigger BaT crawler every 5 loops
    if [[ $((loop_count % 5)) -eq 0 ]]; then
      trigger_bat_crawler
    fi

    log "Sleeping ${CHECK_INTERVAL}s..."
    sleep $CHECK_INTERVAL
  done
}

# Trap for clean shutdown
cleanup() {
  log "=== SHUTTING DOWN ==="
  exit 0
}
trap cleanup SIGINT SIGTERM

# Start the loop
main_loop
