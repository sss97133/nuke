#!/bin/bash
#
# BAT BULK EXTRACTOR
# Processes pending BaT URLs from import_queue using the two-step workflow:
# 1. extract-bat-core (vehicle + specs + images)
# 2. extract-auction-comments (comments + bids)
#
# Features:
# - Resumable (tracks progress in state file)
# - Failure tolerant (logs errors, continues processing)
# - Rate limited (configurable delay between requests)
# - Progress tracking with ETA
#
# Usage:
#   ./scripts/bat-bulk-extract.sh              # Process pending queue
#   ./scripts/bat-bulk-extract.sh --status     # Show progress
#   ./scripts/bat-bulk-extract.sh --reset      # Reset state (start over)
#   ./scripts/bat-bulk-extract.sh --dry-run    # Show what would be processed
#

set -uo pipefail

# Config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/bat-bulk-extract"
LOG_FILE="$LOG_DIR/extract-$(date +%Y%m%d).log"
STATE_FILE="$LOG_DIR/state.json"
ERRORS_FILE="$LOG_DIR/errors-$(date +%Y%m%d).jsonl"

# Tuning
BATCH_SIZE=${BAT_BATCH_SIZE:-50}           # URLs to fetch per batch from DB
DELAY_BETWEEN_URLS=${BAT_DELAY:-2}          # Seconds between URL extractions
DELAY_BETWEEN_BATCHES=${BAT_BATCH_DELAY:-5} # Seconds between batches
MAX_RETRIES=${BAT_MAX_RETRIES:-2}           # Retries per URL on failure
EXTRACT_COMMENTS=${BAT_EXTRACT_COMMENTS:-1} # Set to 0 to skip comment extraction

# Load environment
cd "$PROJECT_DIR"
if [[ -f "$PROJECT_DIR/.env" ]]; then
  export $(grep -E "^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_URL|SERVICE_ROLE_KEY)=" "$PROJECT_DIR/.env" 2>/dev/null | xargs)
fi

# Normalize env
SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"

if [[ -z "$SUPABASE_URL" ]] || [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

mkdir -p "$LOG_DIR"

# Logging
log() {
  local level="$1"
  shift
  local msg="$*"
  local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$ts] [$level] $msg" | tee -a "$LOG_FILE"
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }
log_success() { log "SUCCESS" "$@"; }

# State management
init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo '{
      "started_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "processed": 0,
      "succeeded": 0,
      "failed": 0,
      "skipped": 0,
      "last_processed_id": null,
      "last_url": null,
      "updated_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
    }' > "$STATE_FILE"
  fi
}

get_state() {
  local key="$1"
  jq -r ".$key // empty" "$STATE_FILE" 2>/dev/null
}

update_state() {
  local tmp=$(mktemp)
  jq "$1" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# API helpers
api_call() {
  local endpoint="$1"
  local data="$2"
  local timeout="${3:-120}"

  curl -sS -X POST \
    "${SUPABASE_URL}/functions/v1/${endpoint}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    --max-time "$timeout" \
    -d "$data" 2>/dev/null
}

db_query() {
  local endpoint="$1"
  curl -sS "${SUPABASE_URL}/rest/v1/${endpoint}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    2>/dev/null
}

db_update() {
  local table="$1"
  local filter="$2"
  local data="$3"

  curl -sS -X PATCH "${SUPABASE_URL}/rest/v1/${table}?${filter}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$data" 2>/dev/null
}

get_pending_count() {
  local result=$(curl -sS -I "${SUPABASE_URL}/rest/v1/import_queue?select=id&status=eq.pending&listing_url=ilike.%25bringatrailer.com%2Flisting%2F%25" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: count=exact" \
    -H "Range: 0-0" 2>/dev/null | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ')
  echo "${result:-0}"
}

get_complete_count() {
  local result=$(curl -sS -I "${SUPABASE_URL}/rest/v1/import_queue?select=id&status=eq.complete&listing_url=ilike.%25bringatrailer.com%2Flisting%2F%25" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: count=exact" \
    -H "Range: 0-0" 2>/dev/null | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ')
  echo "${result:-0}"
}

# Fetch batch of pending URLs
fetch_pending_batch() {
  local limit="${1:-$BATCH_SIZE}"
  db_query "import_queue?select=id,listing_url&status=eq.pending&listing_url=ilike.%25bringatrailer.com%2Flisting%2F%25&order=created_at.asc&limit=$limit"
}

# Extract single URL
extract_url() {
  local queue_id="$1"
  local url="$2"
  local attempt="${3:-1}"

  log_info "[$queue_id] Extracting: $url (attempt $attempt)"

  # Mark as processing
  db_update "import_queue" "id=eq.$queue_id" '{"status":"processing","updated_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'

  # Step 1: extract-bat-core
  local core_result
  core_result=$(api_call "extract-bat-core" "{\"url\":\"$url\",\"max_vehicles\":1}" 180)

  local core_success=$(echo "$core_result" | jq -r '.success // false')
  local vehicle_id=$(echo "$core_result" | jq -r '.created_vehicle_ids[0] // .updated_vehicle_ids[0] // empty')

  if [[ "$core_success" != "true" ]] || [[ -z "$vehicle_id" ]]; then
    local error_msg=$(echo "$core_result" | jq -r '.error // .message // "extract-bat-core failed"')
    log_error "[$queue_id] Core extraction failed: $error_msg"

    if [[ "$attempt" -lt "$MAX_RETRIES" ]]; then
      log_info "[$queue_id] Retrying..."
      sleep 5
      extract_url "$queue_id" "$url" $((attempt + 1))
      return $?
    fi

    # Mark as failed
    db_update "import_queue" "id=eq.$queue_id" '{"status":"failed","error_message":"'"$error_msg"'","updated_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
    echo "{\"queue_id\":\"$queue_id\",\"url\":\"$url\",\"error\":\"$error_msg\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> "$ERRORS_FILE"
    return 1
  fi

  log_info "[$queue_id] Core extraction succeeded: vehicle_id=$vehicle_id"

  # Step 2: extract-auction-comments (if enabled)
  if [[ "$EXTRACT_COMMENTS" == "1" ]]; then
    local comments_result
    comments_result=$(api_call "extract-auction-comments" "{\"auction_url\":\"$url\",\"vehicle_id\":\"$vehicle_id\"}" 120)

    local comments_count=$(echo "$comments_result" | jq -r '.comments_extracted // 0')
    log_info "[$queue_id] Comments extracted: $comments_count"
  fi

  # Mark as complete
  db_update "import_queue" "id=eq.$queue_id" '{"status":"complete","vehicle_id":"'"$vehicle_id"'","updated_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'

  log_success "[$queue_id] Complete: $url -> $vehicle_id"
  return 0
}

# Show status
show_status() {
  echo ""
  echo "=========================================="
  echo "BAT BULK EXTRACTOR STATUS"
  echo "=========================================="
  echo ""

  local pending=$(get_pending_count)
  local complete=$(get_complete_count)
  local total=$((pending + complete))

  echo "Queue Status:"
  echo "  Pending:   $pending"
  echo "  Complete:  $complete"
  echo "  Total BaT: $total"
  echo ""

  if [[ -f "$STATE_FILE" ]]; then
    echo "Session Stats:"
    echo "  Started:   $(get_state started_at)"
    echo "  Processed: $(get_state processed)"
    echo "  Succeeded: $(get_state succeeded)"
    echo "  Failed:    $(get_state failed)"
    echo "  Last URL:  $(get_state last_url)"
    echo "  Updated:   $(get_state updated_at)"
  else
    echo "No session state (run extractor to start)"
  fi

  echo ""
  echo "Log file: $LOG_FILE"
  echo "Errors:   $ERRORS_FILE"
  echo ""
}

# Main extraction loop
run_extraction() {
  init_state

  local pending=$(get_pending_count)
  log_info "=========================================="
  log_info "BAT BULK EXTRACTOR STARTING"
  log_info "=========================================="
  log_info "Pending URLs: $pending"
  log_info "Batch size: $BATCH_SIZE"
  log_info "Delay between URLs: ${DELAY_BETWEEN_URLS}s"
  log_info "Extract comments: $EXTRACT_COMMENTS"
  log_info ""

  local total_processed=0
  local total_succeeded=0
  local total_failed=0
  local start_time=$(date +%s)

  while true; do
    # Fetch batch
    local batch=$(fetch_pending_batch)
    local batch_count=$(echo "$batch" | jq 'length')

    if [[ "$batch_count" == "0" ]] || [[ -z "$batch_count" ]]; then
      log_info "No more pending URLs. Extraction complete!"
      break
    fi

    log_info "Processing batch of $batch_count URLs..."

    # Process each URL in batch
    for row in $(echo "$batch" | jq -c '.[]'); do
      local queue_id=$(echo "$row" | jq -r '.id')
      local url=$(echo "$row" | jq -r '.listing_url')

      if extract_url "$queue_id" "$url"; then
        ((total_succeeded++))
      else
        ((total_failed++))
      fi
      ((total_processed++))

      # Update state
      update_state ".processed = $total_processed | .succeeded = $total_succeeded | .failed = $total_failed | .last_processed_id = \"$queue_id\" | .last_url = \"$url\" | .updated_at = \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""

      # Progress report every 10 URLs
      if [[ $((total_processed % 10)) -eq 0 ]]; then
        local elapsed=$(($(date +%s) - start_time))
        local rate=$(echo "scale=2; $total_processed / $elapsed" | bc 2>/dev/null || echo "?")
        local remaining=$((pending - total_processed))
        local eta_secs=$(echo "scale=0; $remaining / $rate" | bc 2>/dev/null || echo "?")
        log_info "Progress: $total_processed processed ($total_succeeded ok, $total_failed failed) | Rate: ${rate}/s | ETA: ${eta_secs}s"
      fi

      # Rate limit
      sleep "$DELAY_BETWEEN_URLS"
    done

    log_info "Batch complete. Sleeping ${DELAY_BETWEEN_BATCHES}s before next batch..."
    sleep "$DELAY_BETWEEN_BATCHES"
  done

  local elapsed=$(($(date +%s) - start_time))
  log_info ""
  log_info "=========================================="
  log_info "EXTRACTION COMPLETE"
  log_info "=========================================="
  log_info "Total processed: $total_processed"
  log_info "Succeeded: $total_succeeded"
  log_info "Failed: $total_failed"
  log_info "Time elapsed: ${elapsed}s"
  log_info "=========================================="
}

# Dry run
dry_run() {
  echo ""
  echo "DRY RUN - Would process these URLs:"
  echo ""

  local batch=$(fetch_pending_batch 10)
  echo "$batch" | jq -r '.[] | "  \(.id): \(.listing_url)"'

  local pending=$(get_pending_count)
  echo ""
  echo "... and $((pending - 10)) more"
  echo ""
}

# Reset state
reset_state() {
  rm -f "$STATE_FILE"
  echo "State reset. Next run will start fresh."
}

# Main
case "${1:-}" in
  --status)
    show_status
    ;;
  --reset)
    reset_state
    ;;
  --dry-run)
    dry_run
    ;;
  --help)
    echo "BAT Bulk Extractor"
    echo ""
    echo "Usage:"
    echo "  $0              Run extraction"
    echo "  $0 --status     Show progress"
    echo "  $0 --reset      Reset state"
    echo "  $0 --dry-run    Preview what would be processed"
    echo ""
    echo "Environment variables:"
    echo "  BAT_BATCH_SIZE=50        URLs per batch"
    echo "  BAT_DELAY=2              Seconds between URLs"
    echo "  BAT_BATCH_DELAY=5        Seconds between batches"
    echo "  BAT_MAX_RETRIES=2        Retries on failure"
    echo "  BAT_EXTRACT_COMMENTS=1   Set to 0 to skip comments"
    echo ""
    ;;
  *)
    run_extraction
    ;;
esac
