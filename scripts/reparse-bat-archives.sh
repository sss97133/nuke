#!/bin/bash
# BaT Archive Re-Parser — Enriches sparse BaT vehicles from archived HTML
# Uses extract-bat-core with prefer_snapshot=true (no re-crawling)
# Targets 118k vehicles that have archived HTML but sparse data
set -uo pipefail

DB="postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
WORK_DIR="/tmp/nuke-bat-reparse"
LOG="$WORK_DIR/progress.log"
BATCH_SIZE=50
TOTAL=0
SUCCESS=0
SKIPPED=0
ERRORS=0
CONSECUTIVE_ERRORS=0
SECONDS=0

# Load env for Supabase URL
cd /Users/skylar/nuke
eval "$(dotenvx run --quiet -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=')"
SUPABASE_URL="${VITE_SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "ERROR: Missing SUPABASE_URL or SERVICE_ROLE_KEY"
  exit 1
fi

mkdir -p "$WORK_DIR"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

# Step 1: Get BaT vehicles that have archived HTML but are missing key fields
log "Finding sparse BaT vehicles with archived HTML..."
psql "$DB" -t -A -c "
  SELECT v.listing_url
  FROM vehicles v
  WHERE COALESCE(v.listing_source, v.platform_source, v.source) IN ('bringatrailer', 'bat_simple_extract', 'bat')
    AND v.listing_url IS NOT NULL
    AND v.listing_url LIKE '%bringatrailer.com/listing/%'
    AND (
      v.description IS NULL
      OR v.mileage IS NULL
      OR v.vin IS NULL
      OR v.color IS NULL
      OR v.transmission IS NULL
      OR v.sale_price IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM listing_page_snapshots s
      WHERE s.platform = 'bat' AND s.success = true AND s.html IS NOT NULL
      AND (s.listing_url = v.listing_url OR s.listing_url = v.listing_url || '/')
    )
  ORDER BY
    CASE WHEN v.description IS NULL THEN 0 ELSE 1 END,
    CASE WHEN v.vin IS NULL THEN 0 ELSE 1 END,
    v.created_at DESC
  LIMIT 200000;
" > "$WORK_DIR/urls-to-reparse.txt" 2>/dev/null

TOTAL_URLS=$(wc -l < "$WORK_DIR/urls-to-reparse.txt" | tr -d ' ')

if [ "$TOTAL_URLS" -eq 0 ]; then
  log "No vehicles to re-parse. Done."
  exit 0
fi

log "Found $TOTAL_URLS vehicles to re-parse from archives"
log "Using extract-bat-core with prefer_snapshot=true (no re-crawling)"

# Step 2: Process one at a time, calling extract-bat-core
while IFS= read -r URL; do
  [ -z "$URL" ] && continue

  # Call extract-bat-core with prefer_snapshot=true
  HTTP_CODE=$(curl -s -o "$WORK_DIR/response.json" -w "%{http_code}" -m 30 \
    -X POST "${SUPABASE_URL}/functions/v1/extract-bat-core" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"${URL}\", \"prefer_snapshot\": true}" 2>/dev/null)

  if [ "$HTTP_CODE" = "200" ]; then
    # Check if vehicle was created/updated
    VEHICLE_ID=$(jq -r '.vehicle_id // empty' "$WORK_DIR/response.json" 2>/dev/null)
    if [ -n "$VEHICLE_ID" ]; then
      SUCCESS=$((SUCCESS + 1))
      CONSECUTIVE_ERRORS=0
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  else
    ERRORS=$((ERRORS + 1))
    CONSECUTIVE_ERRORS=$((CONSECUTIVE_ERRORS + 1))

    if [ "$CONSECUTIVE_ERRORS" -gt 20 ]; then
      log "ERROR: $CONSECUTIVE_ERRORS consecutive failures. Stopping."
      break
    fi

    # Log error details for debugging
    if [ $((ERRORS % 10)) -eq 0 ]; then
      ERROR_MSG=$(jq -r '.error // "unknown"' "$WORK_DIR/response.json" 2>/dev/null)
      log "Error sample (HTTP $HTTP_CODE): $ERROR_MSG"
    fi
  fi

  TOTAL=$((TOTAL + 1))

  # Progress every 100 vehicles
  if [ $((TOTAL % 100)) -eq 0 ]; then
    ELAPSED=$SECONDS
    RATE=$(echo "scale=1; $TOTAL / ($ELAPSED + 1)" | bc 2>/dev/null || echo "?")
    REMAINING=$(( (TOTAL_URLS - TOTAL) * (ELAPSED + 1) / (TOTAL + 1) ))
    PCT=$((TOTAL * 100 / TOTAL_URLS))
    log "Progress: $TOTAL/$TOTAL_URLS (${PCT}%) | Updated: $SUCCESS | Skipped: $SKIPPED | Errors: $ERRORS | ~$((REMAINING / 60))m left"
  fi

  # Throttle: 0.1s between requests (10 req/sec to our own edge function)
  sleep 0.1

done < "$WORK_DIR/urls-to-reparse.txt"

ELAPSED=$SECONDS
log "================================================================"
log "COMPLETE: $TOTAL processed, $SUCCESS updated, $SKIPPED skipped, $ERRORS errors"
log "Duration: $((ELAPSED / 60))m $((ELAPSED % 60))s"
log "================================================================"

# Summary
psql "$DB" -c "
  SELECT
    COALESCE(listing_source, platform_source, source) as src,
    COUNT(*) as total,
    COUNT(description) as has_desc,
    COUNT(mileage) as has_miles,
    COUNT(vin) as has_vin,
    COUNT(color) as has_color,
    COUNT(transmission) as has_trans,
    COUNT(sale_price) as has_price
  FROM vehicles
  WHERE COALESCE(listing_source, platform_source, source) IN ('bringatrailer', 'bat_simple_extract', 'bat')
  GROUP BY 1
  ORDER BY total DESC;
" 2>/dev/null | tee -a "$LOG"
