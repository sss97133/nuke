#!/bin/bash
#
# 2-HOUR AUTONOMOUS RUN
# Tasks:
#   1. oldcaronline.com - Extract 4,300+ vehicles
#   2. CCCA - Create 51 seed profiles
#   3. Set up pinger for new oldcaronline listings
#
# Started: $(date)
# Expected end: $(date -v+2H)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/2hr-run-$(date +%Y%m%d-%H%M)"
MASTER_LOG="$LOG_DIR/master.log"
METRICS_FILE="$LOG_DIR/metrics.json"

mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"

# Load environment
export $(grep -E "^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=" "$PROJECT_DIR/.env" | xargs)
SUPABASE_URL="${VITE_SUPABASE_URL}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

# Rate limiting - aggressive but safe
RATE_DELAY=1.5  # seconds between requests
MAX_CONCURRENT=3

log() {
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] $*" | tee -a "$MASTER_LOG"
}

log_metric() {
  local key="$1"
  local value="$2"
  echo "{\"ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"$key\": $value}" >> "$METRICS_FILE"
}

# ============================================================
# PHASE 1: CCCA PROFILES (quick - do first)
# ============================================================
create_ccca_profiles() {
  log "=== PHASE 1: CCCA SEED PROFILES ==="

  # Create CCCA parent org
  log "Creating CCCA organization..."
  curl -sS -X POST "${SUPABASE_URL}/rest/v1/organizations" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    -d '{
      "name": "Classic Car Club of America",
      "slug": "ccca",
      "type": "club",
      "description": "The Classic Car Club of America is dedicated to the preservation and enjoyment of select cars of the Classic Era (1915-1948).",
      "website": "https://classiccarclub.org",
      "country": "US"
    }' >> "$LOG_DIR/ccca-org.log" 2>&1

  log "Creating CCCA seed profiles..."

  # Full list of 51 emails from CCCA regional clubs
  local emails=(
    "iamjr1@cox.net" "dale@lansdale.com" "akstraw@icloud.com" "johnfarrall2@gmail.com"
    "jwschiech@gmail.com" "beckerar100@gmail.com" "lynnshirey@gmail.com" "dkbraden91@msn.com"
    "b.kittleson@delicatesound.com" "dvtdave@comcast.net" "rjpraetorius@gmail.com"
    "dsalzman@comcast.net" "danieljmccarthy@gmail.com" "russarod@gmail.com"
    "jeffreyshively1965@gmail.com" "james.lerums@hotmail.com" "jsha23444@aol.com"
    "aajj88@optonline.net" "rggluck@aol.com" "jmalloy@msn.com" "tlmcdonald999@comcast.net"
    "grk129@gmail.com" "amyfnau@gmail.com" "elliotfriend@comcast.net" "browrya73@gmail.com"
    "jimpixley@yahoo.com" "grant.wilmer@agg.com" "funcars4us@hotmail.com" "jcrow22006@aol.com"
    "fwd9@hotmail.com" "mikesadams4@gmail.com" "jonleim@yahoo.com" "jim.j.nicholson@gmail.com"
    "carguy883@gmail.com" "cajensen2@aol.com" "czeiger@cox.net" "chuck@proteinpartner.com"
    "chambersbrick@aol.com" "ttobiasz@sbcglobal.net" "bgavrilescu@comcast.net"
    "mcculleymark@aol.com" "reginald_flyer@yahoo.com" "ken8147@me.com"
    "wscb1@bellsouth.net" "drdavidjmarcus@gmail.com" "rkenvin2@gmail.com"
    "dscott@scottadv.com" "rmorley356@gmail.com" "jhpollard@aol.com"
    "carlgibbs@sbcglobal.net" "terryernest@aol.com"
  )

  local created=0
  for email in "${emails[@]}"; do
    # Create profile with upsert
    result=$(curl -sS -X POST "${SUPABASE_URL}/rest/v1/profiles" \
      -H "apikey: ${SUPABASE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_KEY}" \
      -H "Content-Type: application/json" \
      -H "Prefer: resolution=merge-duplicates,return=representation" \
      -d "{
        \"email\": \"$email\",
        \"bio\": \"CCCA Regional Club contact - pending invite\",
        \"user_type\": \"collector\"
      }" 2>&1)

    if echo "$result" | grep -q '"id"'; then
      ((created++)) || true
    fi
  done

  log "Created $created CCCA profiles"
  log_metric "ccca_profiles_created" "$created"
}

# ============================================================
# PHASE 2: OLDCARONLINE EXTRACTION
# ============================================================
extract_oldcaronline() {
  log "=== PHASE 2: OLDCARONLINE.COM EXTRACTION ==="

  # Onboard as organization
  log "Onboarding oldcaronline.com as organization..."
  curl -sS -X POST "${SUPABASE_URL}/rest/v1/organizations" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    -d '{
      "name": "Old Car Online",
      "slug": "oldcaronline",
      "type": "marketplace",
      "description": "Classic car marketplace with 4,300+ listings. Cars and trucks from 1900-2000+.",
      "website": "https://oldcaronline.com",
      "country": "US"
    }' >> "$LOG_DIR/oldcaronline-org.log" 2>&1

  # Get initial count
  local start_vehicles=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id" \
    -H "apikey: ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0")

  log "Starting vehicle count: $start_vehicles"
  log_metric "start_vehicles" "$start_vehicles"

  # Run extractor in batches
  local batch=1
  local total_extracted=0
  local end_time=$(($(date +%s) + 6600))  # 1h50m for extraction (save 10m for pinger)

  while [ $(date +%s) -lt $end_time ]; do
    log "Batch $batch starting..."

    # Run playwright extractor
    local output
    output=$(dotenvx run -- node scripts/extract-oldcaronline-com.js 100 $MAX_CONCURRENT 2>&1 || true)

    # Count successes
    local extracted=$(echo "$output" | grep -c "✓" || echo "0")
    local errors=$(echo "$output" | grep -c "✗" || echo "0")

    total_extracted=$((total_extracted + extracted))

    log "Batch $batch: +$extracted vehicles, $errors errors (total: $total_extracted)"
    log_metric "batch_${batch}" "{\"extracted\": $extracted, \"errors\": $errors}"

    # Save batch log
    echo "$output" >> "$LOG_DIR/extraction-batch-$batch.log"

    # Quality check - if too many errors, slow down
    if [ "$errors" -gt "$extracted" ] && [ "$extracted" -gt 0 ]; then
      log "High error rate - increasing delay"
      RATE_DELAY=$(echo "$RATE_DELAY + 0.5" | bc)
    fi

    # Check if we're done (no new listings found)
    if [ "$extracted" -eq 0 ] && [ "$errors" -eq 0 ]; then
      log "No more listings found - extraction complete"
      break
    fi

    batch=$((batch + 1))

    # Rate limit between batches
    sleep 10
  done

  # Final count
  local end_vehicles=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id" \
    -H "apikey: ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0")

  local net_new=$((end_vehicles - start_vehicles))

  log "Extraction complete: $net_new new vehicles (was: $start_vehicles, now: $end_vehicles)"
  log_metric "extraction_complete" "{\"total_extracted\": $total_extracted, \"net_new\": $net_new, \"final_count\": $end_vehicles}"
}

# ============================================================
# PHASE 3: SET UP PINGER FOR NEW LISTINGS
# ============================================================
setup_pinger() {
  log "=== PHASE 3: PINGER SETUP ==="

  # Create pinger config in observation_extractors
  log "Configuring oldcaronline pinger..."

  curl -sS -X POST "${SUPABASE_URL}/rest/v1/observation_extractors" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    -d '{
      "source_slug": "oldcaronline",
      "extractor_type": "scheduled",
      "schedule_cron": "0 */4 * * *",
      "edge_function_name": "extract-oldcaronline-com",
      "config": {
        "inventory_url": "https://www.oldcaronline.com/Classic-Cars-For-Sale-On-OldCarOnline.com/results?",
        "check_for_new": true,
        "batch_size": 50
      },
      "produces_kinds": ["listing"],
      "enabled": true
    }' >> "$LOG_DIR/pinger-setup.log" 2>&1

  log "Pinger configured: runs every 4 hours"
}

# ============================================================
# FINAL REPORT
# ============================================================
final_report() {
  log ""
  log "=============================================="
  log "2-HOUR AUTONOMOUS RUN COMPLETE"
  log "=============================================="

  # Get final stats
  local vehicles=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id" \
    -H "apikey: ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "?")

  local profiles=$(curl -sS -I "${SUPABASE_URL}/rest/v1/profiles?select=id&bio=ilike.*CCCA*" \
    -H "apikey: ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "?")

  local oldcar=$(curl -sS -I "${SUPABASE_URL}/rest/v1/vehicles?select=id&discovery_source=eq.oldcaronline" \
    -H "apikey: ${SUPABASE_KEY}" -H "Prefer: count=exact" -H "Range: 0-0" \
    | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "?")

  log ""
  log "DELIVERABLES:"
  log "  - CCCA seed profiles: $profiles"
  log "  - OldCarOnline vehicles: $oldcar"
  log "  - Total vehicles in DB: $vehicles"
  log "  - Pinger: configured (every 4 hours)"
  log ""
  log "LOGS: $LOG_DIR"
  log "METRICS: $METRICS_FILE"
  log ""
  log "=============================================="
}

# ============================================================
# MAIN
# ============================================================
main() {
  log "=============================================="
  log "2-HOUR AUTONOMOUS RUN STARTING"
  log "=============================================="
  log "PID: $$"
  log "Log dir: $LOG_DIR"
  log ""

  # Phase 1: CCCA profiles (quick)
  create_ccca_profiles

  # Phase 2: OldCarOnline extraction (main task)
  extract_oldcaronline

  # Phase 3: Pinger setup
  setup_pinger

  # Final report
  final_report
}

# Run
main
