#!/bin/bash
#
# CONTINUOUS EXTRACTION LOOP
#
# Runs all extractors in a continuous loop:
# - Mecum (Playwright)
# - Hagerty (Playwright)
# - PCarMarket (Playwright)
# - BaT via Wayback (Firecrawl)
# - New site extractors (factory-generated)
#
# Usage:
#   ./scripts/continuous-extraction.sh              # Run continuous loop
#   ./scripts/continuous-extraction.sh --once       # Run one cycle
#   ./scripts/continuous-extraction.sh --status     # Check status
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/continuous"
MASTER_LOG="$LOG_DIR/continuous-$(date +%Y%m%d).log"
PID_FILE="$LOG_DIR/continuous.pid"

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR"

# Load environment
if [[ -f "$PROJECT_DIR/.env" ]]; then
  export $(grep -E "^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|FIRECRAWL_API_KEY|ANTHROPIC_API_KEY)=" "$PROJECT_DIR/.env" 2>/dev/null | xargs)
fi

SUPABASE_URL="${VITE_SUPABASE_URL:-}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

log() {
  local msg="$*"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] $msg" | tee -a "$MASTER_LOG"
}

get_pending_count() {
  local source="$1"
  curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id&discovery_source=eq.${source}&status=eq.pending" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null \
    | grep -i content-range | sed 's/.*\///' | tr -d '\r\n ' || echo "0"
}

get_total_vehicles() {
  curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null \
    | grep -i content-range | sed 's/.*\///' | tr -d '\r\n ' || echo "0"
}

run_extractor() {
  local name="$1"
  local script="$2"
  local batch="${3:-50}"
  local workers="${4:-2}"

  log "  Running $name (batch=$batch, workers=$workers)..."

  local output
  output=$(dotenvx run -- node "$script" "$batch" "$workers" 2>&1 || true)

  local success=$(echo "$output" | grep -c "✓" || echo "0")
  local errors=$(echo "$output" | grep -c "✗" || echo "0")

  log "    $name: $success success, $errors errors"
  echo "$output" >> "$LOG_DIR/${name}-$(date +%Y%m%d).log"
}

show_status() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║  CONTINUOUS EXTRACTION STATUS                              ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""

  local total=$(get_total_vehicles)
  echo "Total vehicles: $total"
  echo ""

  echo "Pending by source:"
  for src in mecum hagerty pcarmarket bat carsandbids PCARMARKET; do
    local count=$(get_pending_count "$src")
    if [[ "${count:-0}" != "0" ]]; then
      echo "  $src: $count"
    fi
  done

  echo ""
  echo "Log directory: $LOG_DIR"
  echo "Recent logs:"
  ls -lt "$LOG_DIR"/*.log 2>/dev/null | head -5 || echo "  No logs yet"

  if [[ -f "$PID_FILE" ]]; then
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo ""
      echo "Continuous loop running (PID: $pid)"
    fi
  fi

  echo ""
}

run_cycle() {
  local cycle_num="$1"

  log ""
  log "═══════════════════════════════════════════════════════════"
  log "EXTRACTION CYCLE $cycle_num - $(date)"
  log "═══════════════════════════════════════════════════════════"

  # Check pending counts
  local mecum_pending=$(get_pending_count "mecum")
  local hagerty_pending=$(get_pending_count "hagerty")
  local pcarmarket_pending=$(get_pending_count "PCARMARKET")
  local bat_pending=$(get_pending_count "bat")

  log "Pending: Mecum=$mecum_pending, Hagerty=$hagerty_pending, PCarMarket=$pcarmarket_pending, BaT=$bat_pending"

  # Run extractors for sources with pending work
  if [[ "${mecum_pending:-0}" -gt 0 ]]; then
    run_extractor "mecum" "scripts/mecum-proper-extract.js" 100 3
  fi

  if [[ "${hagerty_pending:-0}" -gt 0 ]]; then
    run_extractor "hagerty" "scripts/hagerty-proper-extract.js" 50 2
  fi

  if [[ "${pcarmarket_pending:-0}" -gt 0 ]]; then
    run_extractor "pcarmarket" "scripts/pcarmarket-proper-extract.js" 50 2
  fi

  # BaT via wayback (uses Firecrawl budget)
  if [[ "${bat_pending:-0}" -gt 0 ]] && [[ -n "${FIRECRAWL_API_KEY:-}" ]]; then
    run_extractor "bat-wayback" "scripts/bat-wayback-batch-extract.js" 25 2
  fi

  # Run new site extractors if they exist
  for extractor in scripts/extract-kindredmotorworks-com.js scripts/extract-streetsideclassics-com.js scripts/extract-vanguardmotorsales-com.js; do
    if [[ -f "$extractor" ]]; then
      local name=$(basename "$extractor" .js)
      log "  Running new extractor: $name"
      dotenvx run -- node "$extractor" 20 1 >> "$LOG_DIR/${name}-$(date +%Y%m%d).log" 2>&1 || true
    fi
  done

  # Summary
  local total=$(get_total_vehicles)
  log ""
  log "CYCLE $cycle_num COMPLETE - Total vehicles: $total"
}

run_loop() {
  local cycle=1
  local cycle_interval=${CYCLE_INTERVAL:-600}  # 10 minutes default

  log "════════════════════════════════════════════════════════════"
  log "CONTINUOUS EXTRACTION LOOP STARTING"
  log "════════════════════════════════════════════════════════════"
  log "PID: $$"
  log "Interval: ${cycle_interval}s"
  log "Log: $MASTER_LOG"
  log "════════════════════════════════════════════════════════════"

  echo $$ > "$PID_FILE"

  trap "rm -f $PID_FILE; exit 0" SIGTERM SIGINT

  while true; do
    run_cycle "$cycle"

    log ""
    log "Sleeping ${cycle_interval}s until next cycle..."
    sleep "$cycle_interval"

    cycle=$((cycle + 1))
  done
}

# CLI
case "${1:-}" in
  --once)
    run_cycle 1
    ;;
  --status)
    show_status
    ;;
  --stop)
    if [[ -f "$PID_FILE" ]]; then
      kill $(cat "$PID_FILE") 2>/dev/null || true
      rm -f "$PID_FILE"
      echo "Stopped continuous extraction"
    fi
    ;;
  *)
    run_loop
    ;;
esac
