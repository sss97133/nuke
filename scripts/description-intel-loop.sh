#!/bin/bash
#
# DESCRIPTION INTELLIGENCE LOOP
# Extracts structured data from vehicle descriptions
#
# Similar to ralph-wiggum.sh but for description analysis
#
# Usage:
#   ./scripts/description-intel-loop.sh --status      # Show stats
#   ./scripts/description-intel-loop.sh --tier1       # Run Tier 1 regex only
#   ./scripts/description-intel-loop.sh --hybrid      # Run Tier 1 + Tier 2 LLM
#   ./scripts/description-intel-loop.sh --loop        # Continuous loop
#   ./scripts/description-intel-loop.sh --test        # Test on 10 vehicles
#
# Environment:
#   INTEL_BATCH_SIZE=100     # Vehicles per batch
#   INTEL_MIN_PRICE=0        # Only analyze vehicles above this price
#   INTEL_DELAY=1            # Seconds between vehicles
#   INTEL_LLM_MODEL=haiku    # LLM model (haiku/sonnet)
#

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/description-intel"
LOG_FILE="$LOG_DIR/intel-$(date +%Y%m%d).log"
STATE_FILE="$LOG_DIR/state.json"

# Config
BATCH_SIZE=${INTEL_BATCH_SIZE:-100}
MIN_PRICE=${INTEL_MIN_PRICE:-0}
DELAY=${INTEL_DELAY:-1}
LLM_MODEL=${INTEL_LLM_MODEL:-haiku}

# Load environment
cd "$PROJECT_DIR"
if [[ -f "$PROJECT_DIR/.env" ]]; then
  export $(grep -E "^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_URL|SERVICE_ROLE_KEY|ANTHROPIC_API_KEY)=" "$PROJECT_DIR/.env" 2>/dev/null | xargs)
fi

SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"

mkdir -p "$LOG_DIR"

# Logging
log() {
  local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

# Database helpers
db_query() {
  local endpoint="$1"
  curl -sS "${SUPABASE_URL}/rest/v1/${endpoint}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    2>/dev/null
}

get_count() {
  local filter="$1"
  curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id&${filter}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: count=exact" \
    -H "Range: 0-0" 2>/dev/null | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n '
}

# Stats
show_status() {
  echo ""
  echo "=========================================="
  echo "DESCRIPTION INTELLIGENCE STATUS"
  echo "=========================================="
  echo ""

  # Vehicles with descriptions
  local with_desc=$(get_count "description=not.is.null")
  echo "Vehicles with descriptions: $with_desc"

  # Check if vehicle_intelligence table exists
  local intel_count=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicle_intelligence?select=id" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: count=exact" \
    -H "Range: 0-0" 2>/dev/null | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ')

  if [[ -z "$intel_count" ]] || [[ "$intel_count" == "0" ]]; then
    echo "Analyzed (vehicle_intelligence): 0 (table may not exist)"
    echo ""
    echo "⚠️  Run this SQL to create the table:"
    echo "   See: docs/DESCRIPTION_INTELLIGENCE_SPEC.md"
  else
    echo "Analyzed (vehicle_intelligence): $intel_count"
    local remaining=$((with_desc - intel_count))
    echo "Remaining to analyze: $remaining"
    local pct=$(echo "scale=1; $intel_count * 100 / $with_desc" | bc 2>/dev/null || echo "?")
    echo "Coverage: ${pct}%"
  fi

  echo ""
  echo "Config:"
  echo "  Batch size: $BATCH_SIZE"
  echo "  Min price filter: \$$MIN_PRICE"
  echo "  LLM model: $LLM_MODEL"
  echo ""
  echo "RLM Context: scripts/rlm/description_intelligence_context.md"
  echo "Log file: $LOG_FILE"
  echo ""
}

# Tier 1 regex extraction
run_tier1() {
  log "Starting Tier 1 regex extraction (batch: $BATCH_SIZE)..."

  local result=$(curl -s -X POST \
    "${SUPABASE_URL}/functions/v1/analyze-vehicle-description" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": ${BATCH_SIZE}, \"use_llm\": false, \"min_price\": ${MIN_PRICE}}" 2>/dev/null)

  local analyzed=$(echo "$result" | jq -r '.analyzed // 0')
  local errors=$(echo "$result" | jq -r '.errors // 0')

  log "Tier 1 complete: $analyzed analyzed, $errors errors"
}

# Tier 2 LLM extraction
run_tier2() {
  log "Starting Tier 2 LLM extraction (batch: $BATCH_SIZE, min_price: $MIN_PRICE)..."

  local result=$(curl -s -X POST \
    "${SUPABASE_URL}/functions/v1/analyze-vehicle-description" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": ${BATCH_SIZE}, \"use_llm\": true, \"min_price\": ${MIN_PRICE}}" 2>/dev/null)

  local analyzed=$(echo "$result" | jq -r '.analyzed // 0')
  local tier2=$(echo "$result" | jq -r '.tier2_used // 0')
  local errors=$(echo "$result" | jq -r '.errors // 0')

  log "Tier 2 complete: $analyzed analyzed, $tier2 used LLM, $errors errors"
}

# Hybrid extraction
run_hybrid() {
  log "Starting hybrid extraction (Tier 1 + Tier 2)..."
  run_tier1
  run_tier2
}

# Test on small batch
run_test() {
  log "Testing on 10 vehicles..."

  local result=$(curl -s -X POST \
    "${SUPABASE_URL}/functions/v1/analyze-vehicle-description" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"batch_size": 10, "use_llm": false}' 2>/dev/null)

  echo "$result" | jq '.'

  log ""
  log "Test complete."
}

# Continuous loop
run_loop() {
  log "=========================================="
  log "DESCRIPTION INTELLIGENCE LOOP STARTING"
  log "=========================================="

  while true; do
    log "Running extraction cycle..."
    run_hybrid

    log "Sleeping 60s before next cycle..."
    sleep 60
  done
}

# Main
case "${1:-}" in
  --status)
    show_status
    ;;
  --tier1)
    run_tier1
    ;;
  --tier2)
    run_tier2
    ;;
  --hybrid)
    run_hybrid
    ;;
  --loop)
    run_loop
    ;;
  --test)
    run_test
    ;;
  --help|*)
    echo "Description Intelligence Loop"
    echo ""
    echo "Usage:"
    echo "  $0 --status    Show analysis stats"
    echo "  $0 --tier1     Run Tier 1 regex extraction"
    echo "  $0 --tier2     Run Tier 2 LLM extraction"
    echo "  $0 --hybrid    Run Tier 1 + Tier 2"
    echo "  $0 --loop      Continuous loop"
    echo "  $0 --test      Test on 10 vehicles"
    echo ""
    echo "Environment:"
    echo "  INTEL_BATCH_SIZE=100   Vehicles per batch"
    echo "  INTEL_MIN_PRICE=0      Min sale price filter"
    echo "  INTEL_LLM_MODEL=haiku  LLM model"
    echo ""
    echo "Context: scripts/rlm/description_intelligence_context.md"
    echo ""
    ;;
esac
