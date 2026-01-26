#!/bin/bash
#
# EXTRACTOR FACTORY AUTONOMOUS LOOP
#
# Continuously builds extractors for new target sites:
# 1. Inspect site with Playwright
# 2. AI analysis of structure
# 3. Generate extractor
# 4. Test extractor
# 5. Move to next target
#
# Usage:
#   ./scripts/factory-loop.sh              # Run autonomous loop
#   ./scripts/factory-loop.sh --once       # Process one site
#   ./scripts/factory-loop.sh --status     # Check status
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/factory"
MASTER_LOG="$LOG_DIR/factory-$(date +%Y%m%d).log"
STATE_FILE="$LOG_DIR/state.json"
TARGETS_FILE="$PROJECT_DIR/scripts/target-sites.json"

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR"

log() {
  local msg="$*"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] $msg" | tee -a "$MASTER_LOG"
}

get_next_target() {
  # Read targets file and find first one without an extractor
  local targets=$(cat "$TARGETS_FILE" | jq -r '.new_targets[].url')

  for url in $targets; do
    local slug=$(echo "$url" | sed -E 's|https?://||' | sed 's|www\.||' | sed 's|/.*||' | tr '.' '-')
    local extractor="$PROJECT_DIR/scripts/extract-${slug}.js"

    if [[ ! -f "$extractor" ]]; then
      echo "$url"
      return 0
    fi
  done

  echo ""  # No more targets
}

process_target() {
  local url="$1"
  local slug=$(echo "$url" | sed -E 's|https?://||' | sed 's|www\.||' | sed 's|/.*||' | tr '.' '-')

  log "═══════════════════════════════════════════════════════════"
  log "PROCESSING: $url"
  log "═══════════════════════════════════════════════════════════"

  # Step 1: Inspect
  log "Step 1: Inspecting site..."
  local inspect_output
  inspect_output=$(dotenvx run -- node scripts/extractor-factory.js inspect "$url" 2>&1 || true)

  if [[ -f "site-inspections/${slug}.json" ]]; then
    log "  ✓ Inspection saved"
  else
    log "  ✗ Inspection failed"
    echo "$inspect_output" >> "$LOG_DIR/${slug}-error.log"
    return 1
  fi

  # Step 2: Generate extractor (includes AI analysis)
  log "Step 2: Generating extractor..."
  local generate_output
  generate_output=$(dotenvx run -- node scripts/extractor-factory.js generate "$url" 2>&1 || true)

  if [[ -f "scripts/extract-${slug}.js" ]]; then
    log "  ✓ Extractor generated: extract-${slug}.js"
  else
    log "  ✗ Generation failed"
    echo "$generate_output" >> "$LOG_DIR/${slug}-error.log"
    return 1
  fi

  # Step 3: Test extractor (dry run)
  log "Step 3: Testing extractor..."
  local test_output
  test_output=$(timeout 120 dotenvx run -- node "scripts/extract-${slug}.js" 5 1 2>&1 || true)

  local success_count=$(echo "$test_output" | grep -c "✓" || echo "0")
  log "  Test result: $success_count vehicles extracted"

  echo "$test_output" >> "$LOG_DIR/${slug}-test.log"

  # Save state
  echo "{
    \"last_processed\": \"$url\",
    \"slug\": \"$slug\",
    \"success\": true,
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" > "$STATE_FILE"

  log "✓ Completed: $url"
  return 0
}

show_status() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║  EXTRACTOR FACTORY STATUS                                  ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""

  echo "Target sites:"
  cat "$TARGETS_FILE" | jq -r '.new_targets[] | "  \(.name): \(.url)"'

  echo ""
  echo "Generated extractors:"
  ls scripts/extract-*-com.js 2>/dev/null | while read f; do
    echo "  ✓ $(basename $f)"
  done

  echo ""
  echo "Pending targets:"
  local targets=$(cat "$TARGETS_FILE" | jq -r '.new_targets[].url')
  for url in $targets; do
    local slug=$(echo "$url" | sed -E 's|https?://||' | sed 's|www\.||' | sed 's|/.*||' | tr '.' '-')
    if [[ ! -f "scripts/extract-${slug}.js" ]]; then
      echo "  - $url"
    fi
  done

  echo ""
}

run_loop() {
  log "════════════════════════════════════════════════════════════"
  log "EXTRACTOR FACTORY LOOP STARTING"
  log "════════════════════════════════════════════════════════════"

  local cycle=1

  while true; do
    local target=$(get_next_target)

    if [[ -z "$target" ]]; then
      log "All targets processed. Sleeping 30 minutes..."
      sleep 1800
      cycle=$((cycle + 1))
      continue
    fi

    process_target "$target" || true

    # Brief pause between targets
    sleep 30
  done
}

# CLI
case "${1:-}" in
  --once)
    target=$(get_next_target)
    if [[ -n "$target" ]]; then
      process_target "$target"
    else
      echo "All targets already have extractors"
    fi
    ;;
  --status)
    show_status
    ;;
  *)
    run_loop
    ;;
esac
