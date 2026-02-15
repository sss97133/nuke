#!/bin/bash
# Parallel Enrichment Runner
# Runs multiple workstreams concurrently for maximum throughput
#
# Usage: cd /Users/skylar/nuke && dotenvx run -- bash scripts/parallel-enrichment.sh
# Kill:  kill $(cat /tmp/nuke-enrichment.pid) && pkill -f parallel-enrichment
set -uo pipefail

API_BASE="$VITE_SUPABASE_URL/functions/v1"
KEY="$SUPABASE_SERVICE_ROLE_KEY"
LOG="/tmp/nuke-overnight/main.log"
mkdir -p /tmp/nuke-overnight
echo $$ > /tmp/nuke-enrichment.pid

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }
alive() { [ -f /tmp/nuke-enrichment.pid ]; }

log "=== PARALLEL ENRICHMENT STARTED (PID $$) ==="

# ─── Workstream 1: VIN Batch Decode (NHTSA, 50/call) ───
bash "$(dirname "$0")/batch-vin-decode.sh" &
VIN_PID=$!
log "VIN batch decode PID: $VIN_PID"

# ─── Workstream 2: Parallel Queue Drain (10 workers) ───
queue_worker() {
  local worker_id=$1
  local total=0
  while alive; do
    local result
    result=$(curl -s -m 120 -X POST "$API_BASE/continuous-queue-processor" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"continuous\": true, \"batch_size\": 5, \"max_runtime_seconds\": 55}" 2>&1)

    local items=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total_processed',0))" 2>/dev/null || echo "0")
    total=$((total + items))

    if [ "$items" = "0" ]; then
      sleep 30
    else
      sleep 2
    fi
  done
  log "[QUEUE-W$worker_id] Stopped. Processed: $total"
}

QUEUE_PIDS=""
for i in $(seq 1 5); do
  queue_worker $i &
  QUEUE_PIDS="$QUEUE_PIDS $!"
  sleep 2  # Stagger starts
done
log "Queue drain: 5 workers started"

# ─── Workstream 3: BaT Snapshot Re-extraction (5 parallel) ───
bat_worker() {
  local worker_id=$1
  local total=0
  local success=0

  while alive; do
    local row
    row=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
      -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -F'|' -c "
      SELECT DISTINCT ON (v.id) v.id, v.bat_auction_url
      FROM vehicles v
      JOIN listing_page_snapshots s ON s.listing_url = v.bat_auction_url
        AND s.platform = 'bat' AND s.success = true AND s.http_status = 200
      WHERE v.is_public = true
        AND v.bat_auction_url IS NOT NULL AND v.bat_auction_url != ''
        AND ((v.vin IS NULL OR v.vin = '') OR v.mileage IS NULL OR (v.color IS NULL OR v.color = ''))
      ORDER BY v.id, s.fetched_at DESC
      OFFSET $((RANDOM % 100))
      LIMIT 1;" 2>/dev/null)

    [ -z "$row" ] && { sleep 60; continue; }

    local vid=$(echo "$row" | cut -d'|' -f1)
    local url=$(echo "$row" | cut -d'|' -f2)
    [ -z "$url" ] && continue

    total=$((total + 1))
    local result
    result=$(curl -s -m 90 -X POST "$API_BASE/extract-bat-core" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"url\": \"$url\", \"vehicle_id\": \"$vid\", \"save_to_db\": true, \"update_existing\": true, \"prefer_snapshot\": true}" 2>&1)

    if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') or d.get('vehicle_id') else 1)" 2>/dev/null; then
      success=$((success + 1))
    fi

    sleep 1
  done
  log "[BAT-W$worker_id] Stopped. $success/$total success"
}

BAT_PIDS=""
for i in $(seq 1 3); do
  bat_worker $i &
  BAT_PIDS="$BAT_PIDS $!"
  sleep 2
done
log "BaT snapshot: 3 workers started"

# ─── Progress Reporter ───
REPORT_INTERVAL=300  # Every 5 minutes
while alive; do
  sleep $REPORT_INTERVAL

  # Quick stats from DB
  STATS=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
    -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -c "
    SELECT
      COUNT(*) FILTER (WHERE engine_size IS NOT NULL AND engine_size != 'N/A') as has_engine,
      COUNT(*) FILTER (WHERE vin IS NOT NULL AND vin != '') as has_vin,
      COUNT(*) FILTER (WHERE mileage > 0) as has_mileage,
      COUNT(*) FILTER (WHERE color IS NOT NULL AND color != '') as has_color
    FROM vehicles WHERE is_public = true;" 2>/dev/null)

  log "[STATS] Engine: $(echo $STATS | cut -d'|' -f1) | VIN: $(echo $STATS | cut -d'|' -f2) | Mileage: $(echo $STATS | cut -d'|' -f3) | Color: $(echo $STATS | cut -d'|' -f4)"
done &
REPORT_PID=$!

# Wait for VIN decode to finish (the finite workstream)
wait $VIN_PID 2>/dev/null
log "VIN batch decode complete"

# Keep running queue + BaT workers until stopped
log "Queue drain + BaT workers continuing. Kill with: kill \$(cat /tmp/nuke-enrichment.pid)"
wait $QUEUE_PIDS $BAT_PIDS $REPORT_PID 2>/dev/null

log "=== PARALLEL ENRICHMENT STOPPED ==="
rm -f /tmp/nuke-enrichment.pid
