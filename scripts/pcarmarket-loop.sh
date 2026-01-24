#!/bin/bash
#
# PCARMARKET EXTRACTION LOOP
# Discovers and extracts PCarMarket auction listings
#
# Usage:
#   ./scripts/pcarmarket-loop.sh --status      # Show queue stats
#   ./scripts/pcarmarket-loop.sh --discover    # Find new listings
#   ./scripts/pcarmarket-loop.sh --extract     # Process pending queue
#   ./scripts/pcarmarket-loop.sh --test        # Test single extraction
#   ./scripts/pcarmarket-loop.sh --loop        # Run continuous loop
#
# Environment:
#   PCAR_BATCH_SIZE=10       # URLs per batch
#   PCAR_DELAY=3             # Seconds between requests
#   PCAR_MAX_PAGES=5         # Max discovery pages
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_ROOT/logs/pcarmarket"
STATE_DIR="$PROJECT_ROOT/.pcarmarket-state"

# Defaults
BATCH_SIZE="${PCAR_BATCH_SIZE:-10}"
DELAY="${PCAR_DELAY:-3}"
MAX_PAGES="${PCAR_MAX_PAGES:-5}"

# Ensure directories exist
mkdir -p "$LOG_DIR" "$STATE_DIR"

# Load environment
cd "$PROJECT_ROOT"

log() {
  local level="$1"
  shift
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [$level] $*" | tee -a "$LOG_DIR/pcarmarket-$(date +%Y%m%d).log"
}

show_status() {
  echo "=========================================="
  echo "PCARMARKET EXTRACTION STATUS"
  echo "=========================================="
  echo ""

  # Get queue stats using dotenvx
  local pending complete failed total
  pending=$(dotenvx run --quiet -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/import_queue?select=id&listing_url=ilike.%25pcarmarket.com%25&status=eq.pending" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r"' 2>/dev/null || echo "0")
  complete=$(dotenvx run --quiet -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/import_queue?select=id&listing_url=ilike.%25pcarmarket.com%25&status=eq.complete" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r"' 2>/dev/null || echo "0")
  failed=$(dotenvx run --quiet -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/import_queue?select=id&listing_url=ilike.%25pcarmarket.com%25&status=eq.failed" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r"' 2>/dev/null || echo "0")

  # Get vehicle count
  local vehicles
  vehicles=$(dotenvx run --quiet -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/vehicles?select=id&discovery_source=ilike.%25pcarmarket%25" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r"' 2>/dev/null || echo "0")

  echo "Queue Status:"
  echo "  Pending:   ${pending:-0}"
  echo "  Complete:  ${complete:-0}"
  echo "  Failed:    ${failed:-0}"
  echo ""
  echo "Vehicles Extracted: ${vehicles:-0}"
  echo ""
  echo "Log file: $LOG_DIR/pcarmarket-$(date +%Y%m%d).log"
  echo ""
}

discover_listings() {
  log "INFO" "Starting PCarMarket discovery..."

  # Check for Firecrawl API key
  local has_firecrawl
  has_firecrawl=$(dotenvx run --quiet -- bash -c 'test -n "$FIRECRAWL_API_KEY" && echo "yes" || echo "no"' 2>/dev/null || echo "no")

  if [[ "$has_firecrawl" != "yes" ]]; then
    log "ERROR" "FIRECRAWL_API_KEY not set. PCarMarket requires JS rendering."
    log "INFO" "Options:"
    log "INFO" "  1. Add valid FIRECRAWL_API_KEY to .env"
    log "INFO" "  2. Use Firecrawl MCP in Claude Code"
    log "INFO" "  3. Manually add URLs to import_queue"
    echo ""
    echo "ERROR: Discovery requires FIRECRAWL_API_KEY for JS rendering."
    echo ""
    echo "Alternative: Manually add URLs to queue with:"
    echo "  INSERT INTO import_queue (listing_url, source, status)"
    echo "  VALUES ('https://www.pcarmarket.com/auction/...', 'pcarmarket', 'pending');"
    return 1
  fi

  local discovered=0
  local added=0

  # Discover from main page and results page
  local pages=(
    "https://www.pcarmarket.com/"
    "https://www.pcarmarket.com/results/"
  )

  for page_url in "${pages[@]}"; do
    log "INFO" "Discovering from: $page_url"

    # Use Firecrawl to scrape (via edge function or MCP)
    # For now, use the links extraction mode
    local links_json
    links_json=$(dotenvx run --quiet -- bash -c "
      curl -s 'https://api.firecrawl.dev/v1/scrape' \
        -H 'Authorization: Bearer \$FIRECRAWL_API_KEY' \
        -H 'Content-Type: application/json' \
        -d '{
          \"url\": \"$page_url\",
          \"formats\": [\"links\"],
          \"waitFor\": 10000
        }' 2>/dev/null
    " 2>/dev/null || echo '{}')

    # Extract auction URLs from the links
    local auction_urls
    auction_urls=$(echo "$links_json" | jq -r '.data.links[]? // empty' 2>/dev/null | grep -E '/auction/[0-9]{4}-[a-z0-9-]+-[0-9]+' | sort -u || true)

    if [[ -z "$auction_urls" ]]; then
      log "WARN" "No auction URLs found from $page_url"
      continue
    fi

    # Count discovered
    local count
    count=$(echo "$auction_urls" | wc -l | tr -d ' ')
    discovered=$((discovered + count))
    log "INFO" "Found $count auction URLs from $page_url"

    # Add to queue
    while IFS= read -r url; do
      [[ -z "$url" ]] && continue

      # Normalize URL
      local full_url="https://www.pcarmarket.com$url"
      if [[ "$url" == http* ]]; then
        full_url="$url"
      fi

      # Check if already in queue or vehicles
      local exists
      exists=$(dotenvx run --quiet -- bash -c "
        curl -s \"\${VITE_SUPABASE_URL}/rest/v1/import_queue?listing_url=eq.$full_url&select=id\" \
          -H \"apikey: \${SUPABASE_SERVICE_ROLE_KEY}\" \
          -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" 2>/dev/null | jq 'length'
      " 2>/dev/null || echo "0")

      if [[ "$exists" == "0" ]]; then
        # Add to queue
        dotenvx run --quiet -- bash -c "
          curl -s \"\${VITE_SUPABASE_URL}/rest/v1/import_queue\" \
            -H \"apikey: \${SUPABASE_SERVICE_ROLE_KEY}\" \
            -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" \
            -H \"Content-Type: application/json\" \
            -H \"Prefer: return=minimal\" \
            -d '{\"listing_url\": \"$full_url\", \"source\": \"pcarmarket\", \"status\": \"pending\"}' 2>/dev/null
        " 2>/dev/null
        added=$((added + 1))
        log "INFO" "Queued: $full_url"
      fi
    done <<< "$auction_urls"

    sleep "$DELAY"
  done

  log "INFO" "Discovery complete: $discovered found, $added added to queue"
  echo ""
  echo "Discovery Summary:"
  echo "  URLs found: $discovered"
  echo "  New queued: $added"
}

extract_batch() {
  log "INFO" "Starting extraction batch (size: $BATCH_SIZE)"

  # Get pending URLs
  local pending_json
  pending_json=$(dotenvx run --quiet -- bash -c "
    curl -s \"\${VITE_SUPABASE_URL}/rest/v1/import_queue?listing_url=ilike.%25pcarmarket.com%25&status=eq.pending&order=created_at.asc&limit=$BATCH_SIZE&select=id,listing_url\" \
      -H \"apikey: \${SUPABASE_SERVICE_ROLE_KEY}\" \
      -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" 2>/dev/null
  " 2>/dev/null || echo '[]')

  local count
  count=$(echo "$pending_json" | jq 'length' 2>/dev/null || echo "0")

  if [[ "$count" == "0" ]]; then
    log "INFO" "No pending URLs to process"
    return 0
  fi

  log "INFO" "Processing $count URLs..."

  local success=0
  local failed=0

  echo "$pending_json" | jq -c '.[]' | while read -r item; do
    local queue_id
    local listing_url
    queue_id=$(echo "$item" | jq -r '.id')
    listing_url=$(echo "$item" | jq -r '.listing_url')

    log "INFO" "Extracting: $listing_url"

    # Mark as processing
    dotenvx run --quiet -- bash -c "
      curl -s \"\${VITE_SUPABASE_URL}/rest/v1/import_queue?id=eq.$queue_id\" \
        -X PATCH \
        -H \"apikey: \${SUPABASE_SERVICE_ROLE_KEY}\" \
        -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" \
        -H \"Content-Type: application/json\" \
        -H \"Prefer: return=minimal\" \
        -d '{\"status\": \"processing\"}' 2>/dev/null
    " 2>/dev/null

    # Call extraction function
    local result
    result=$(dotenvx run --quiet -- bash -c "
      curl -s -X POST \"\${VITE_SUPABASE_URL}/functions/v1/import-pcarmarket-listing\" \
        -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" \
        -H \"Content-Type: application/json\" \
        -d '{\"listing_url\": \"$listing_url\"}' 2>/dev/null
    " 2>/dev/null || echo '{"error": "curl failed"}')

    local has_error
    has_error=$(echo "$result" | jq 'has("error")' 2>/dev/null || echo "true")

    if [[ "$has_error" == "true" ]]; then
      local error_msg
      error_msg=$(echo "$result" | jq -r '.error // "unknown error"' 2>/dev/null)
      log "ERROR" "Failed: $listing_url - $error_msg"

      # Mark as failed
      dotenvx run --quiet -- bash -c "
        curl -s \"\${VITE_SUPABASE_URL}/rest/v1/import_queue?id=eq.$queue_id\" \
          -X PATCH \
          -H \"apikey: \${SUPABASE_SERVICE_ROLE_KEY}\" \
          -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" \
          -H \"Content-Type: application/json\" \
          -H \"Prefer: return=minimal\" \
          -d '{\"status\": \"failed\", \"error_message\": \"$error_msg\"}' 2>/dev/null
      " 2>/dev/null

      failed=$((failed + 1))
    else
      local vehicle_id
      vehicle_id=$(echo "$result" | jq -r '.vehicle_id // "unknown"' 2>/dev/null)
      log "INFO" "Success: $listing_url -> vehicle $vehicle_id"

      # Mark as complete
      dotenvx run --quiet -- bash -c "
        curl -s \"\${VITE_SUPABASE_URL}/rest/v1/import_queue?id=eq.$queue_id\" \
          -X PATCH \
          -H \"apikey: \${SUPABASE_SERVICE_ROLE_KEY}\" \
          -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" \
          -H \"Content-Type: application/json\" \
          -H \"Prefer: return=minimal\" \
          -d '{\"status\": \"complete\"}' 2>/dev/null
      " 2>/dev/null

      success=$((success + 1))
    fi

    sleep "$DELAY"
  done

  log "INFO" "Batch complete: $success success, $failed failed"
}

test_extraction() {
  local test_url="${1:-https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2}"

  echo "Testing extraction for: $test_url"
  echo ""

  local result
  result=$(dotenvx run --quiet -- bash -c "
    curl -s -X POST \"\${VITE_SUPABASE_URL}/functions/v1/import-pcarmarket-listing\" \
      -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" \
      -H \"Content-Type: application/json\" \
      -d '{\"listing_url\": \"$test_url\"}'
  " 2>/dev/null)

  echo "$result" | jq .
}

run_loop() {
  log "INFO" "=========================================="
  log "INFO" "PCARMARKET EXTRACTION LOOP STARTING"
  log "INFO" "=========================================="
  log "INFO" "Batch size: $BATCH_SIZE"
  log "INFO" "Delay: ${DELAY}s"
  log "INFO" "Max pages: $MAX_PAGES"

  local cycle=0

  while true; do
    cycle=$((cycle + 1))
    log "INFO" "--- Cycle $cycle ---"

    # Discovery every 10 cycles
    if [[ $((cycle % 10)) -eq 1 ]]; then
      discover_listings
    fi

    # Extract batch
    extract_batch

    # Check if more work
    local pending
    pending=$(dotenvx run --quiet -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/import_queue?select=id&listing_url=ilike.%25pcarmarket.com%25&status=eq.pending" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r"' 2>/dev/null || echo "0")

    if [[ "$pending" == "0" ]]; then
      log "INFO" "No pending URLs. Sleeping 5 minutes..."
      sleep 300
    else
      log "INFO" "$pending URLs remaining. Continuing..."
    fi
  done
}

# Main
case "${1:-}" in
  --status)
    show_status
    ;;
  --discover)
    discover_listings
    ;;
  --extract)
    extract_batch
    ;;
  --test)
    test_extraction "${2:-}"
    ;;
  --loop)
    run_loop
    ;;
  *)
    echo "Usage: $0 {--status|--discover|--extract|--test [url]|--loop}"
    echo ""
    echo "Commands:"
    echo "  --status    Show queue and extraction stats"
    echo "  --discover  Find new PCarMarket listings and add to queue"
    echo "  --extract   Process one batch of pending URLs"
    echo "  --test      Test extraction on a single URL"
    echo "  --loop      Run continuous discovery + extraction loop"
    echo ""
    echo "Environment:"
    echo "  PCAR_BATCH_SIZE=10  URLs per batch"
    echo "  PCAR_DELAY=3        Seconds between requests"
    echo "  PCAR_MAX_PAGES=5    Max discovery pages"
    exit 1
    ;;
esac
