#!/bin/bash
#
# Multi-Source Extraction Processor
# Processes pending items from multiple sources in parallel
#

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p logs

export $(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|FIRECRAWL_API_KEY)=' | xargs)

SUPABASE_URL="${VITE_SUPABASE_URL}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
BATCH_SIZE="${1:-20}"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"
}

process_url() {
  local url="$1"
  local queue_id="$2"
  local domain=$(echo "$url" | sed 's|.*://||' | sed 's|/.*||')

  local extractor=""
  case "$domain" in
    *carsandbids*) extractor="extract-cars-and-bids-core" ;;
    *pcarmarket*) extractor="import-pcarmarket-listing" ;;
    *mecum*) extractor="extract-vehicle-data-ai" ;;
    *collectingcars*) extractor="extract-collecting-cars-simple" ;;
    *hagerty*) extractor="extract-hagerty-listing" ;;
    *rmsothebys*) extractor="extract-rmsothebys" ;;
    *goodingco*) extractor="extract-gooding" ;;
    *bonhams*) extractor="extract-bonhams" ;;
    *bringatrailer*) extractor="extract-bat-core" ;;
    *) extractor="extract-vehicle-data-ai" ;;
  esac

  log "Processing $domain via $extractor"

  response=$(curl -sf -X POST "${SUPABASE_URL}/functions/v1/${extractor}" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$url\", \"queue_id\": \"$queue_id\", \"save_to_db\": true}" \
    --max-time 120 2>&1 || echo '{"success": false, "error": "timeout or failed"}')

  success=$(echo "$response" | jq -r '.success // false' 2>/dev/null || echo "false")

  if [ "$success" = "true" ]; then
    title=$(echo "$response" | jq -r '.data.title // .vehicle.title // "extracted"' 2>/dev/null | head -c 60)
    log "  ✅ $title"
    return 0
  else
    error=$(echo "$response" | jq -r '.error // "unknown"' 2>/dev/null | head -c 80)
    log "  ❌ $error"
    return 1
  fi
}

log "🚀 Multi-Source Extraction Processor"
log "===================================="

# Get pending items from non-BaT sources first, then BaT
PENDING=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
  -h aws-0-us-west-1.pooler.supabase.com \
  -p 6543 \
  -U postgres.qkgaybvrernstplzjaam \
  -d postgres \
  -t -A -F'|' \
  -c "
(SELECT id, listing_url
 FROM import_queue
 WHERE status = 'pending'
   AND listing_url NOT LIKE '%bringatrailer.com%'
   AND attempts < max_attempts
 ORDER BY priority DESC, created_at
 LIMIT $((BATCH_SIZE / 2)))
UNION ALL
(SELECT id, listing_url
 FROM import_queue
 WHERE status = 'pending'
   AND listing_url LIKE '%bringatrailer.com%'
   AND attempts < max_attempts
 ORDER BY priority DESC, created_at
 LIMIT $((BATCH_SIZE / 2)));
" 2>/dev/null)

if [ -z "$PENDING" ]; then
  log "✅ No pending items"
  exit 0
fi

TOTAL=$(echo "$PENDING" | wc -l | xargs)
log "Found $TOTAL items to process"

processed=0
succeeded=0
failed=0

echo "$PENDING" | while IFS='|' read -r queue_id url; do
  [ -z "$url" ] && continue
  processed=$((processed + 1))

  # Update to processing
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
    -h aws-0-us-west-1.pooler.supabase.com \
    -p 6543 \
    -U postgres.qkgaybvrernstplzjaam \
    -d postgres \
    -c "UPDATE import_queue SET status='processing', locked_at=NOW(), attempts=attempts+1 WHERE id='$queue_id';" 2>/dev/null

  if process_url "$url" "$queue_id"; then
    PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
      -h aws-0-us-west-1.pooler.supabase.com \
      -p 6543 \
      -U postgres.qkgaybvrernstplzjaam \
      -d postgres \
      -c "UPDATE import_queue SET status='complete', processed_at=NOW() WHERE id='$queue_id';" 2>/dev/null
    succeeded=$((succeeded + 1))
  else
    PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
      -h aws-0-us-west-1.pooler.supabase.com \
      -p 6543 \
      -U postgres.qkgaybvrernstplzjaam \
      -d postgres \
      -c "UPDATE import_queue SET status='failed', error_message='extraction failed' WHERE id='$queue_id';" 2>/dev/null
    failed=$((failed + 1))
  fi

  # Small delay between requests
  sleep 0.5
done

log ""
log "===================================="
log "📊 Batch Complete: $processed processed, $succeeded succeeded, $failed failed"
