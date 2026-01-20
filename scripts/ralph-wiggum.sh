#!/bin/bash
#
# RALPH WIGGUM - Autonomous Source Extraction Manager
#
# "I'm helping!"
#
# This script runs autonomously to:
# 1. Check source health
# 2. Identify broken extractors
# 3. Attempt fixes
# 4. Track progress toward 100% source coverage
# 5. Log everything for human review
#
# Usage:
#   ./ralph-wiggum.sh              # Run once
#   ./ralph-wiggum.sh --loop       # Run continuously
#   ./ralph-wiggum.sh --status     # Check current status
#   ./ralph-wiggum.sh --watch      # Watch logs in real-time
#

set -euo pipefail

# Config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/ralph-wiggum"
LOG_FILE="$LOG_DIR/ralph-$(date +%Y%m%d).log"
STATE_FILE="$LOG_DIR/state.json"
LOOP_INTERVAL=1800  # 30 minutes between cycles

# Load environment
if [[ -f "$PROJECT_DIR/.env" ]]; then
  export $(grep -E "^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=" "$PROJECT_DIR/.env" | xargs)
fi

# Ensure we have credentials
if [[ -z "${SUPABASE_URL:-}" ]] || [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

# Create log directory
mkdir -p "$LOG_DIR"

# Logging
log() {
  local level="$1"
  shift
  local msg="$*"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] [$level] $msg" | tee -a "$LOG_FILE"
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }
log_success() { log "SUCCESS" "$@"; }

# API helper
api_call() {
  local endpoint="$1"
  local data="${2:-{}}"

  curl -sS -X POST \
    "${SUPABASE_URL}/functions/v1/${endpoint}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    --max-time 120 \
    -d "$data" 2>/dev/null
}

# Get count from Supabase REST API
get_count() {
  local table="$1"
  local filter="${2:-}"

  local url="${SUPABASE_URL}/rest/v1/${table}?select=id${filter:+&$filter}"

  curl -sS "$url" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: count=exact" \
    -H "Range: 0-0" \
    -w "%{header}" \
    -o /dev/null 2>/dev/null | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n'
}

# Get current health metrics
get_health() {
  local total_sources=$(get_count "scrape_sources" "is_active=eq.true")
  local ever_worked=$(get_count "scrape_sources" "is_active=eq.true&last_successful_scrape=not.is.null")
  local pending_queue=$(get_count "import_queue" "status=eq.pending")
  local failed_queue=$(get_count "import_queue" "status=eq.failed")
  local total_vehicles=$(get_count "vehicles")

  # Calculate working today (approximate - within 24h)
  local working_today=$(get_count "scrape_sources" "is_active=eq.true&last_successful_scrape=gte.$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)")

  echo "{
    \"total_sources\": ${total_sources:-0},
    \"ever_worked\": ${ever_worked:-0},
    \"working_today\": ${working_today:-0},
    \"pending_queue\": ${pending_queue:-0},
    \"failed_queue\": ${failed_queue:-0},
    \"total_vehicles\": ${total_vehicles:-0},
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }"
}

# Save state
save_state() {
  local health="$1"
  local cycle_num="${2:-0}"
  local last_action="${3:-none}"

  echo "{
    \"cycle\": $cycle_num,
    \"last_action\": \"$last_action\",
    \"health\": $health,
    \"updated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > "$STATE_FILE"
}

# Display status
show_status() {
  echo ""
  echo "=========================================="
  echo "RALPH WIGGUM STATUS"
  echo "=========================================="
  echo ""

  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE" | jq -r '
      "Cycle: \(.cycle)",
      "Last Action: \(.last_action)",
      "Updated: \(.updated_at)",
      "",
      "HEALTH:",
      "  Sources: \(.health.working_today // 0)/\(.health.total_sources // 0) working today",
      "  Ever worked: \(.health.ever_worked // 0)",
      "  Queue pending: \(.health.pending_queue // 0)",
      "  Queue failed: \(.health.failed_queue // 0)",
      "  Total vehicles: \(.health.total_vehicles // 0)"
    ' 2>/dev/null || echo "State file exists but couldn't parse"
  else
    echo "No state file yet. Run ralph-wiggum.sh first."
  fi

  echo ""
  echo "Log file: $LOG_FILE"
  echo "State file: $STATE_FILE"
  echo ""
}

# Watch logs
watch_logs() {
  echo "Watching Ralph Wiggum logs (Ctrl+C to stop)..."
  echo "Log file: $LOG_FILE"
  echo ""
  tail -f "$LOG_FILE" 2>/dev/null || echo "No log file yet"
}

# Main cycle
run_cycle() {
  local cycle_num="${1:-1}"

  log_info "=========================================="
  log_info "RALPH WIGGUM CYCLE $cycle_num"
  log_info "=========================================="

  # Step 1: Get current health
  log_info "Step 1: Checking source health..."
  local health=$(get_health)
  local total=$(echo "$health" | jq -r '.total_sources')
  local working=$(echo "$health" | jq -r '.working_today')
  local pending=$(echo "$health" | jq -r '.pending_queue')

  log_info "  Sources: $working/$total working today"
  log_info "  Queue: $pending pending"

  save_state "$health" "$cycle_num" "health_check"

  # Step 2: Register extractors for sources without one
  log_info "Step 2: Registering extractors for new sources..."
  local register_result=$(api_call "source-extractor-manager" '{"action": "register_all"}')
  local registered=$(echo "$register_result" | jq -r '.registered_count // 0')
  log_info "  Registered $registered new extractors"

  # Step 3: Run unified scraper orchestrator
  log_info "Step 3: Running unified scraper orchestrator..."
  local scrape_result=$(api_call "unified-scraper-orchestrator" '{"action": "run_cycle"}')
  local scraped=$(echo "$scrape_result" | jq -r '.sources_scraped // 0')
  local queued=$(echo "$scrape_result" | jq -r '.queue_processed // 0')
  log_info "  Scraped $scraped sources, processed $queued queue items"

  # Step 4: Process import queue
  log_info "Step 4: Processing import queue..."
  local queue_result=$(api_call "process-import-queue" '{"batch_size": 50}')
  local processed=$(echo "$queue_result" | jq -r '.processed // 0')
  log_info "  Processed $processed items"

  # Step 5: Check for broken extractors
  log_info "Step 5: Checking for broken extractors..."
  local broken_result=$(api_call "source-extractor-manager" '{"action": "get_broken"}')
  local broken_count=$(echo "$broken_result" | jq -r '.broken_count // 0')

  if [[ "$broken_count" -gt 0 ]]; then
    log_warn "  Found $broken_count broken extractors - need attention"
    echo "$broken_result" | jq -r '.extractors[:5][] | "    - \(.source_name): \(.success_rate * 100 | floor)% success"' 2>/dev/null || true
  else
    log_success "  No broken extractors"
  fi

  # Step 6: Final health check
  log_info "Step 6: Final health check..."
  local final_health=$(get_health)
  local final_working=$(echo "$final_health" | jq -r '.working_today')
  local final_vehicles=$(echo "$final_health" | jq -r '.total_vehicles')

  save_state "$final_health" "$cycle_num" "cycle_complete"

  # Summary
  log_info ""
  log_info "CYCLE $cycle_num COMPLETE"
  log_info "  Sources working: $final_working/$total"
  log_info "  Total vehicles: $final_vehicles"
  log_info "  Coverage: $(echo "scale=1; $final_working * 100 / $total" | bc 2>/dev/null || echo "?")%"
  log_info ""

  # Return health for chaining
  echo "$final_health"
}

# Loop mode
run_loop() {
  local cycle=1

  log_info "Starting Ralph Wiggum in LOOP mode"
  log_info "Interval: ${LOOP_INTERVAL}s between cycles"
  log_info "Press Ctrl+C to stop"
  log_info ""

  while true; do
    run_cycle "$cycle"

    log_info "Sleeping ${LOOP_INTERVAL}s until next cycle..."
    sleep "$LOOP_INTERVAL"

    ((cycle++))
  done
}

# Main
main() {
  case "${1:-}" in
    --loop)
      run_loop
      ;;
    --status)
      show_status
      ;;
    --watch)
      watch_logs
      ;;
    --help)
      echo "Ralph Wiggum - Autonomous Source Extraction Manager"
      echo ""
      echo "Usage:"
      echo "  $0              Run single cycle"
      echo "  $0 --loop       Run continuously"
      echo "  $0 --status     Show current status"
      echo "  $0 --watch      Watch logs in real-time"
      echo ""
      ;;
    *)
      run_cycle 1
      ;;
  esac
}

main "$@"
