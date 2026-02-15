#!/bin/bash
# Overnight Enrichment Runner
#
# Two parallel workstreams:
# 1. Process pending queue items (99K waiting)
# 2. Re-extract BaT vehicles missing VIN/mileage/color (4.3K with cached snapshots)
#
# Usage: cd /Users/skylar/nuke && dotenvx run -- bash scripts/overnight-enrichment.sh
# Kill:  kill $(cat /tmp/nuke-overnight.pid)

set -euo pipefail

API_BASE="$VITE_SUPABASE_URL/functions/v1"
KEY="$SUPABASE_SERVICE_ROLE_KEY"
LOG_DIR="/tmp/nuke-overnight"
mkdir -p "$LOG_DIR"
echo $$ > /tmp/nuke-overnight.pid

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_DIR/main.log"; }

log "=== OVERNIGHT ENRICHMENT STARTED ==="
log "PID: $$"

# ─── Workstream 1: Drain the import queue ───
drain_queue() {
  local cycle=0
  local total_processed=0

  while true; do
    cycle=$((cycle + 1))
    log "[QUEUE] Cycle $cycle starting (total processed: $total_processed)"

    # Call continuous-queue-processor with 55s runtime (under Supabase 60s limit)
    local result
    result=$(curl -s -m 120 -X POST "$API_BASE/continuous-queue-processor" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d '{"continuous": true, "batch_size": 5, "max_runtime_seconds": 55}' 2>&1)

    local items=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total_processed', d.get('metrics',{}).get('total_processed',0)))" 2>/dev/null || echo "0")
    total_processed=$((total_processed + items))

    log "[QUEUE] Cycle $cycle done: $items items this cycle, $total_processed total"
    echo "$result" >> "$LOG_DIR/queue.log"

    # If nothing was processed, wait longer
    if [ "$items" = "0" ]; then
      log "[QUEUE] Nothing to process, waiting 60s..."
      sleep 60
    else
      sleep 5
    fi

    # Check if we should stop
    if [ ! -f /tmp/nuke-overnight.pid ]; then
      log "[QUEUE] PID file removed, stopping"
      break
    fi
  done
}

# ─── Workstream 2: BaT re-extraction from CACHED SNAPSHOTS only ───
# Only processes vehicles that already have HTML in listing_page_snapshots.
# extract-bat-core will find the snapshot and skip direct BaT fetch.
bat_reextract() {
  local total=0
  local success=0
  local failed=0
  local rate_limited=0

  log "[BAT-ENRICH] Starting BaT re-extraction (snapshot-only, ~4.3K records)"

  while true; do
    # Get batch: only vehicles with EXISTING snapshots
    local batch
    batch=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
      -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -F'|' -c "
      SELECT DISTINCT ON (v.id) v.id, v.bat_auction_url
      FROM vehicles v
      JOIN listing_page_snapshots s ON s.listing_url = v.bat_auction_url
        AND s.platform = 'bat' AND s.success = true AND s.http_status = 200
      WHERE v.is_public = true
        AND v.bat_auction_url IS NOT NULL AND v.bat_auction_url != ''
        AND ((v.vin IS NULL OR v.vin = '') OR v.mileage IS NULL OR (v.color IS NULL OR v.color = ''))
      ORDER BY v.id, s.fetched_at DESC
      LIMIT 10;" 2>/dev/null)

    if [ -z "$batch" ] || [ "$batch" = "" ]; then
      log "[BAT-ENRICH] No more snapshot-cached records to enrich. Total: $total, success: $success, failed: $failed, rate_limited: $rate_limited"
      break
    fi

    while IFS='|' read -r vehicle_id bat_url; do
      [ -z "$bat_url" ] && continue
      total=$((total + 1))

      local result
      result=$(curl -s -m 90 -X POST "$API_BASE/extract-bat-core" \
        -H "Authorization: Bearer $KEY" \
        -H "Content-Type: application/json" \
        -d "{\"url\": \"$bat_url\", \"vehicle_id\": \"$vehicle_id\", \"save_to_db\": true, \"update_existing\": true, \"prefer_snapshot\": true}" 2>&1)

      if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') or d.get('vehicle_id') else 1)" 2>/dev/null; then
        success=$((success + 1))
      elif echo "$result" | grep -qi "rate.limit\|302\|login"; then
        rate_limited=$((rate_limited + 1))
        echo "$vehicle_id|RATE_LIMITED|$bat_url" >> "$LOG_DIR/bat-errors.log"
        # If we're getting rate limited, snapshot wasn't found — skip faster
        sleep 1
        continue
      else
        failed=$((failed + 1))
        echo "$vehicle_id|$bat_url|$result" >> "$LOG_DIR/bat-errors.log"
      fi

      if [ $((total % 10)) -eq 0 ]; then
        log "[BAT-ENRICH] Progress: $total processed, $success ok, $failed err, $rate_limited rate-limited"
      fi

      # No need for long delays — using cached snapshots, not hitting BaT
      sleep 1

    done <<< "$batch"

    # Check if we should stop
    if [ ! -f /tmp/nuke-overnight.pid ]; then
      log "[BAT-ENRICH] PID file removed, stopping"
      break
    fi
  done

  log "[BAT-ENRICH] COMPLETE: $total processed, $success success, $failed failed, $rate_limited rate-limited"
}

# ─── Run both workstreams in parallel ───
drain_queue &
QUEUE_PID=$!

bat_reextract &
BAT_PID=$!

log "Queue PID: $QUEUE_PID, BaT PID: $BAT_PID"

# Wait for both
wait $QUEUE_PID $BAT_PID 2>/dev/null

log "=== OVERNIGHT ENRICHMENT COMPLETE ==="

# Final stats
log "=== FINAL DATA QUALITY ==="
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
  -U postgres.qkgaybvrernstplzjaam -d postgres -c "
SELECT
  COUNT(*) as total_public,
  COUNT(*) FILTER (WHERE vin IS NOT NULL AND vin != '') as has_vin,
  COUNT(*) FILTER (WHERE sale_price > 0) as has_price,
  COUNT(*) FILTER (WHERE mileage > 0) as has_mileage,
  COUNT(*) FILTER (WHERE color IS NOT NULL AND color != '') as has_color,
  COUNT(*) FILTER (WHERE engine_size IS NOT NULL) as has_engine
FROM vehicles WHERE is_public = true;" 2>/dev/null | tee -a "$LOG_DIR/main.log"

rm -f /tmp/nuke-overnight.pid
