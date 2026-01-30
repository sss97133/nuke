#!/bin/bash
#
# Contact Discovery Runner
# Automatically cycles through contact sources for extraction
#
# Usage: ./contact-discovery-runner.sh [hours]
#
# Runs for specified hours (default: 4), cycling through sources
#

set -e
cd /Users/skylar/nuke

HOURS=${1:-4}
END_TIME=$(($(date +%s) + HOURS * 3600))
LOG_DIR="logs/contact-discovery-$(date +%Y%m%d-%H%M)"

mkdir -p "$LOG_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  CONTACT DISCOVERY RUNNER                                    ║"
echo "║  Runtime: ${HOURS} hours                                           ║"
echo "║  Log dir: $LOG_DIR"
echo "╚══════════════════════════════════════════════════════════════╝"

# Source priority queue
CLUBS=(
  "ccca"
  "pca"
  "aaca"
  "nccc"
  "mca"
  "fca"
  "vmcca"
  "mafca"
  "acd"
  "packard"
)

HEMMINGS_CATS=(
  "restoration"
  "dealers"
  "parts"
  "appraisers"
)

# Track what we've processed
CLUB_IDX=0
HEMMINGS_IDX=0
CYCLE=1

log() {
  echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_DIR/runner.log"
}

run_club_extraction() {
  local club=$1
  log "Starting club extraction: $club"

  dotenvx run -- node scripts/contacts/extract-car-club.js "$club" \
    >> "$LOG_DIR/${club}.log" 2>&1 || true

  log "Completed: $club"
}

run_hemmings_extraction() {
  local category=$1
  log "Starting Hemmings extraction: $category"

  dotenvx run -- node scripts/contacts/extract-hemmings-directory.js "$category" \
    >> "$LOG_DIR/hemmings-${category}.log" 2>&1 || true

  log "Completed: Hemmings $category"
}

get_contact_count() {
  dotenvx run -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/discovery_leads?lead_type=eq.person&select=count" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"' 2>/dev/null | grep -o '[0-9]*' || echo "0"
}

# Main loop
log "Starting contact discovery..."
INITIAL_COUNT=$(get_contact_count)
log "Initial contact count: $INITIAL_COUNT"

while [ $(date +%s) -lt $END_TIME ]; do
  log "=== Cycle $CYCLE ==="

  # Run 2 club extractions
  for i in 1 2; do
    if [ $CLUB_IDX -lt ${#CLUBS[@]} ]; then
      run_club_extraction "${CLUBS[$CLUB_IDX]}"
      CLUB_IDX=$((CLUB_IDX + 1))
    fi
  done

  # Run 1 Hemmings category
  if [ $HEMMINGS_IDX -lt ${#HEMMINGS_CATS[@]} ]; then
    run_hemmings_extraction "${HEMMINGS_CATS[$HEMMINGS_IDX]}"
    HEMMINGS_IDX=$((HEMMINGS_IDX + 1))
  fi

  # Check progress
  CURRENT_COUNT=$(get_contact_count)
  ADDED=$((CURRENT_COUNT - INITIAL_COUNT))
  log "Progress: $CURRENT_COUNT contacts (+$ADDED new)"

  # Reset indices if we've gone through all sources
  if [ $CLUB_IDX -ge ${#CLUBS[@]} ] && [ $HEMMINGS_IDX -ge ${#HEMMINGS_CATS[@]} ]; then
    log "Completed full cycle through all sources"
    break
  fi

  CYCLE=$((CYCLE + 1))

  # Brief pause between cycles
  sleep 30
done

# Final summary
FINAL_COUNT=$(get_contact_count)
TOTAL_ADDED=$((FINAL_COUNT - INITIAL_COUNT))

echo ""
echo "════════════════════════════════════════"
echo "CONTACT DISCOVERY COMPLETE"
echo "  Runtime: $HOURS hours"
echo "  Initial contacts: $INITIAL_COUNT"
echo "  Final contacts: $FINAL_COUNT"
echo "  New contacts added: $TOTAL_ADDED"
echo "  Logs: $LOG_DIR"
echo "════════════════════════════════════════"

log "Runner complete. Added $TOTAL_ADDED contacts."
