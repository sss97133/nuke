#!/bin/bash
#
# MASTER AUTONOMOUS RUNNER
#
# Combines all extraction systems into one continuous autonomous loop:
# 1. Run existing extractors (Mecum, Hagerty, PCarMarket)
# 2. Build new extractors via extractor-factory
# 3. Ralph Wiggum orchestration
# 4. Self-healing and monitoring
#
# Usage:
#   ./scripts/autonomous-runner.sh              # Start autonomous mode
#   ./scripts/autonomous-runner.sh --status     # Check status
#   ./scripts/autonomous-runner.sh --stop       # Stop all background jobs
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/autonomous"
MASTER_LOG="$LOG_DIR/master-$(date +%Y%m%d).log"
PID_FILE="$LOG_DIR/autonomous.pid"
STATE_FILE="$LOG_DIR/state.json"

mkdir -p "$LOG_DIR"

# Load environment
cd "$PROJECT_DIR"
if [[ -f "$PROJECT_DIR/.env" ]]; then
  export $(grep -E "^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY)=" "$PROJECT_DIR/.env" | xargs)
fi

# Normalize env
SUPABASE_URL="${VITE_SUPABASE_URL:-}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

# Target sites for new extractor development
TARGET_SITES=(
  "https://kindredmotorworks.com"
  "https://velocityrestorations.com"
  "https://vanguardmotorsales.com"
  "https://www.ottocar.com"
  "https://agcollection.com"
  "https://europeancollectibles.com"
  "https://streetsideclassics.com"
  "https://gatewayclassiccars.com"
  "https://classiccardeals.com"
)

log() {
  local level="$1"
  shift
  local msg="$*"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] [$level] $msg" | tee -a "$MASTER_LOG"
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }
log_success() { log "SUCCESS" "$@"; }

save_state() {
  local cycle="$1"
  local phase="$2"
  local stats="${3:-{}}"

  echo "{
    \"cycle\": $cycle,
    \"phase\": \"$phase\",
    \"last_updated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"stats\": $stats
  }" > "$STATE_FILE"
}

get_pending_counts() {
  # Use discovery_source field (not source) for pending counts
  local mecum=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id&discovery_source=eq.mecum&status=eq.pending" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0")

  local hagerty=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id&discovery_source=eq.hagerty&status=eq.pending" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0")

  local pcarmarket=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id&discovery_source=eq.PCARMARKET&status=eq.pending" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0")

  local bat=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id&discovery_source=eq.bat&status=eq.pending" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0")

  echo "{\"mecum\": ${mecum:-0}, \"hagerty\": ${hagerty:-0}, \"pcarmarket\": ${pcarmarket:-0}, \"bat\": ${bat:-0}}"
}

get_total_vehicles() {
  curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0"
}

run_mecum_extraction() {
  log_info "Running Mecum extraction batch..."
  cd "$PROJECT_DIR"

  local output
  output=$(dotenvx run -- node scripts/mecum-proper-extract.js 50 2 2>&1 || true)

  local processed=$(echo "$output" | grep -c "✓" || echo "0")
  local errors=$(echo "$output" | grep -c "✗" || echo "0")

  log_info "  Mecum: $processed processed, $errors errors"
  echo "$output" >> "$LOG_DIR/mecum-$(date +%Y%m%d).log"
}

run_hagerty_extraction() {
  log_info "Running Hagerty extraction batch..."
  cd "$PROJECT_DIR"

  local output
  output=$(dotenvx run -- node scripts/hagerty-proper-extract.js 30 2 2>&1 || true)

  local processed=$(echo "$output" | grep -c "✓" || echo "0")
  log_info "  Hagerty: $processed processed"
  echo "$output" >> "$LOG_DIR/hagerty-$(date +%Y%m%d).log"
}

run_pcarmarket_extraction() {
  log_info "Running PCarMarket extraction batch..."
  cd "$PROJECT_DIR"

  local output
  output=$(dotenvx run -- node scripts/pcarmarket-proper-extract.js 20 2 2>&1 || true)

  local processed=$(echo "$output" | grep -c "✓" || echo "0")
  log_info "  PCarMarket: $processed processed"
  echo "$output" >> "$LOG_DIR/pcarmarket-$(date +%Y%m%d).log"
}

build_new_extractor() {
  local url="$1"
  local slug=$(echo "$url" | sed 's|https\?://||' | sed 's|www\.||' | sed 's|/.*||' | sed 's|[^a-z0-9]|-|g')

  log_info "Building extractor for: $url"

  # Check if extractor already exists
  if [[ -f "$PROJECT_DIR/scripts/extract-${slug}.js" ]]; then
    log_info "  Extractor already exists: extract-${slug}.js"
    return 0
  fi

  # Check if inspection already exists
  if [[ -f "$PROJECT_DIR/site-inspections/${slug}.json" ]]; then
    log_info "  Using existing inspection"
  else
    log_info "  Inspecting site..."
    cd "$PROJECT_DIR"
    dotenvx run -- node scripts/extractor-factory.js inspect "$url" >> "$LOG_DIR/factory-$(date +%Y%m%d).log" 2>&1 || true
  fi

  # Generate extractor
  log_info "  Generating extractor..."
  cd "$PROJECT_DIR"
  dotenvx run -- node scripts/extractor-factory.js generate "$url" >> "$LOG_DIR/factory-$(date +%Y%m%d).log" 2>&1 || true

  if [[ -f "$PROJECT_DIR/scripts/extract-${slug}.js" ]]; then
    log_success "  Created: scripts/extract-${slug}.js"
    return 0
  else
    log_warn "  Failed to generate extractor for $url"
    return 1
  fi
}

run_ralph_wiggum_cycle() {
  log_info "Running Ralph Wiggum orchestration cycle..."
  cd "$PROJECT_DIR"

  "$SCRIPT_DIR/ralph-wiggum.sh" 2>&1 | tee -a "$LOG_DIR/ralph-$(date +%Y%m%d).log" || true
}

show_status() {
  echo ""
  echo "=============================================="
  echo "AUTONOMOUS RUNNER STATUS"
  echo "=============================================="
  echo ""

  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE" | jq -r '
      "Cycle: \(.cycle)",
      "Phase: \(.phase)",
      "Last Updated: \(.last_updated)"
    ' 2>/dev/null || echo "State file exists but couldn't parse"
  else
    echo "No state file - runner not started"
  fi

  echo ""
  echo "Pending extractions:"
  get_pending_counts | jq .

  echo ""
  echo "Total vehicles: $(get_total_vehicles)"

  echo ""
  echo "Log files:"
  ls -la "$LOG_DIR"/*.log 2>/dev/null | tail -5 || echo "No logs yet"

  echo ""
}

stop_runner() {
  if [[ -f "$PID_FILE" ]]; then
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      log_info "Stopped autonomous runner (PID: $pid)"
    fi
    rm -f "$PID_FILE"
  fi

  # Kill any background extraction processes
  pkill -f "mecum-proper-extract" 2>/dev/null || true
  pkill -f "hagerty-proper-extract" 2>/dev/null || true
  pkill -f "pcarmarket-proper-extract" 2>/dev/null || true
  pkill -f "extractor-factory" 2>/dev/null || true

  echo "Autonomous runner stopped"
}

run_main_loop() {
  local cycle=1
  local factory_cycle=0
  local current_target_index=0

  log_info "=============================================="
  log_info "AUTONOMOUS RUNNER STARTING"
  log_info "=============================================="
  log_info "PID: $$"
  log_info "Log: $MASTER_LOG"
  log_info "State: $STATE_FILE"
  log_info "=============================================="

  echo $$ > "$PID_FILE"

  while true; do
    log_info ""
    log_info "═══════════════════════════════════════════"
    log_info "CYCLE $cycle - $(date)"
    log_info "═══════════════════════════════════════════"

    # Get current pending counts
    local pending=$(get_pending_counts)
    local mecum_pending=$(echo "$pending" | jq -r '.mecum')
    local hagerty_pending=$(echo "$pending" | jq -r '.hagerty')
    local pcar_pending=$(echo "$pending" | jq -r '.pcarmarket')

    log_info "Pending: Mecum=$mecum_pending, Hagerty=$hagerty_pending, PCarMarket=$pcar_pending"
    save_state "$cycle" "checking_pending" "$pending"

    # Phase 1: Run existing extractors
    save_state "$cycle" "extracting"

    if [[ "$mecum_pending" -gt 0 ]]; then
      run_mecum_extraction
    fi

    if [[ "$hagerty_pending" -gt 0 ]]; then
      run_hagerty_extraction
    fi

    if [[ "$pcar_pending" -gt 0 ]]; then
      run_pcarmarket_extraction
    fi

    # Phase 2: Build new extractor every 5 cycles
    factory_cycle=$((factory_cycle + 1))
    if [[ $factory_cycle -ge 5 ]]; then
      factory_cycle=0

      if [[ $current_target_index -lt ${#TARGET_SITES[@]} ]]; then
        save_state "$cycle" "building_extractor"
        local target="${TARGET_SITES[$current_target_index]}"
        build_new_extractor "$target"
        current_target_index=$((current_target_index + 1))
      fi
    fi

    # Phase 3: Ralph Wiggum orchestration every 3 cycles
    if [[ $((cycle % 3)) -eq 0 ]]; then
      save_state "$cycle" "ralph_wiggum"
      run_ralph_wiggum_cycle
    fi

    # Summary
    local total=$(get_total_vehicles)
    local new_pending=$(get_pending_counts)

    log_info ""
    log_info "CYCLE $cycle COMPLETE"
    log_info "  Total vehicles: $total"
    log_info "  Remaining pending: $new_pending"

    save_state "$cycle" "complete" "{\"total_vehicles\": $total, \"pending\": $new_pending}"

    # Sleep between cycles (5 minutes)
    log_info ""
    log_info "Sleeping 5 minutes until next cycle..."
    sleep 300

    cycle=$((cycle + 1))
  done
}

# CLI
case "${1:-}" in
  --status)
    show_status
    ;;
  --stop)
    stop_runner
    ;;
  --help)
    echo "AUTONOMOUS RUNNER - Master extraction orchestrator"
    echo ""
    echo "Usage:"
    echo "  $0              Start autonomous mode (foreground)"
    echo "  $0 --status     Check current status"
    echo "  $0 --stop       Stop all background processes"
    echo ""
    ;;
  *)
    run_main_loop
    ;;
esac
