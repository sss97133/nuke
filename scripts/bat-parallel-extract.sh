#!/bin/bash
#
# BAT Parallel Extraction
# Runs multiple workers in parallel for ~800/hour throughput
#
# Usage:
#   ./scripts/bat-parallel-extract.sh           # Run 3 workers, 20 per batch
#   ./scripts/bat-parallel-extract.sh --status  # Show queue status
#   ./scripts/bat-parallel-extract.sh --workers 5 --batch 15  # Custom
#   ./scripts/bat-parallel-extract.sh --loop    # Continuous loop
#

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/bat-parallel"
LOG_FILE="$LOG_DIR/extract-$(date +%Y%m%d).log"

# Defaults
WORKERS=${BAT_WORKERS:-3}
BATCH_SIZE=${BAT_BATCH_SIZE:-20}
LOOP_DELAY=${BAT_LOOP_DELAY:-30}  # seconds between rounds

# Load environment
cd "$PROJECT_DIR"
if [[ -f "$PROJECT_DIR/.env" ]]; then
  export $(grep -E "^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_URL|SERVICE_ROLE_KEY)=" "$PROJECT_DIR/.env" 2>/dev/null | xargs)
fi

SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"

mkdir -p "$LOG_DIR"

log() {
  local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

show_status() {
  echo ""
  echo "=========================================="
  echo "BAT EXTRACTION STATUS"
  echo "=========================================="

  pending=$(curl -sS -I "${SUPABASE_URL}/rest/v1/import_queue?select=id&status=eq.pending" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null | grep -i content-range | sed 's/.*\///' | tr -d '\r\n ')
  complete=$(curl -sS -I "${SUPABASE_URL}/rest/v1/import_queue?select=id&status=eq.complete" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null | grep -i content-range | sed 's/.*\///' | tr -d '\r\n ')
  failed=$(curl -sS -I "${SUPABASE_URL}/rest/v1/import_queue?select=id&status=eq.failed" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null | grep -i content-range | sed 's/.*\///' | tr -d '\r\n ')

  echo ""
  echo "Queue:"
  echo "  Pending:  $pending"
  echo "  Complete: $complete"
  echo "  Failed:   $failed"
  echo ""

  vehicles=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null | grep -i content-range | sed 's/.*\///' | tr -d '\r\n ')
  echo "Total Vehicles: $vehicles"
  echo ""

  if [[ -n "$pending" ]] && [[ "$pending" -gt 0 ]]; then
    hours=$(echo "scale=1; $pending / 800" | bc 2>/dev/null || echo "?")
    days=$(echo "scale=1; $pending / 800 / 24" | bc 2>/dev/null || echo "?")
    echo "Estimated time remaining (at 800/hour):"
    echo "  Hours: $hours"
    echo "  Days:  $days"
  fi
  echo ""
}

run_worker() {
  local worker_id=$1
  local result=$(curl -s -X POST \
    "${SUPABASE_URL}/functions/v1/bat-queue-worker" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": ${BATCH_SIZE}}" 2>/dev/null)

  local succeeded=$(echo "$result" | jq -r '.succeeded // 0')
  local failed=$(echo "$result" | jq -r '.failed // 0')
  local rate=$(echo "$result" | jq -r '.rate_per_minute // 0')

  echo "Worker $worker_id: ${succeeded} ok, ${failed} fail @ ${rate}/min"
  echo "$result"
}

run_parallel() {
  log "Starting $WORKERS parallel workers (batch size: $BATCH_SIZE)"

  local pids=()
  local results=()

  # Launch workers in parallel
  for i in $(seq 1 $WORKERS); do
    run_worker $i &
    pids+=($!)
  done

  # Wait for all
  local total_succeeded=0
  local total_failed=0
  for pid in "${pids[@]}"; do
    wait $pid
  done

  log "Round complete"
}

run_loop() {
  log "=========================================="
  log "BAT PARALLEL EXTRACTION LOOP"
  log "Workers: $WORKERS | Batch: $BATCH_SIZE | Delay: ${LOOP_DELAY}s"
  log "=========================================="

  local round=0
  while true; do
    ((round++))
    log ""
    log "=== Round $round ==="

    run_parallel

    log "Sleeping ${LOOP_DELAY}s..."
    sleep $LOOP_DELAY
  done
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --status)
      show_status
      exit 0
      ;;
    --workers)
      WORKERS=$2
      shift 2
      ;;
    --batch)
      BATCH_SIZE=$2
      shift 2
      ;;
    --loop)
      run_loop
      exit 0
      ;;
    --help)
      echo "BAT Parallel Extraction"
      echo ""
      echo "Usage:"
      echo "  $0                      Run once with 3 workers"
      echo "  $0 --status             Show queue status"
      echo "  $0 --workers N          Use N parallel workers"
      echo "  $0 --batch N            Process N URLs per worker"
      echo "  $0 --loop               Run continuously"
      echo ""
      echo "Environment:"
      echo "  BAT_WORKERS=3           Number of parallel workers"
      echo "  BAT_BATCH_SIZE=20       URLs per worker per round"
      echo "  BAT_LOOP_DELAY=30       Seconds between rounds"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

# Default: run once
run_parallel
