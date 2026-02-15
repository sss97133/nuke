#!/bin/bash
# BaT Archive Batch Re-Parser
# Reads archived HTML from listing_page_snapshots, parses locally, updates vehicles
# No re-crawling — all data comes from already-archived pages
set -uo pipefail

DB="postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
WORK_DIR="/tmp/nuke-bat-reparse"
LOG="$WORK_DIR/progress.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BATCH_SIZE=25
TOTAL=0
SUCCESS=0
ERRORS=0
SECONDS=0

mkdir -p "$WORK_DIR"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

# Step 1: Count target vehicles
log "Counting sparse BaT vehicles with archived HTML..."
TOTAL_TARGET=$(psql "$DB" -t -A -c "
  SELECT COUNT(*)
  FROM vehicles v
  WHERE COALESCE(v.listing_source, v.platform_source, v.source) IN ('bringatrailer', 'bat_simple_extract', 'bat')
    AND v.listing_url IS NOT NULL
    AND v.listing_url LIKE '%bringatrailer.com/listing/%'
    AND (v.description IS NULL OR v.mileage IS NULL OR v.vin IS NULL OR v.color IS NULL OR v.sale_price IS NULL)
    AND EXISTS (
      SELECT 1 FROM listing_page_snapshots s
      WHERE s.platform = 'bat' AND s.success = true AND s.html IS NOT NULL
      AND (s.listing_url = v.listing_url OR s.listing_url = v.listing_url || '/')
    );
" 2>/dev/null | tr -d ' ')

log "Found $TOTAL_TARGET vehicles to re-parse"

if [ "$TOTAL_TARGET" -eq 0 ]; then
  log "Nothing to do."
  exit 0
fi

# Step 2: Process in batches
while true; do
  # Get a batch of vehicles + their archived HTML
  # Write HTML to temp files to avoid shell escaping issues
  psql "$DB" -t -A -F $'\x1f' -c "
    SELECT v.id, s.html
    FROM vehicles v
    JOIN listing_page_snapshots s ON (
      s.platform = 'bat' AND s.success = true AND s.html IS NOT NULL
      AND (s.listing_url = v.listing_url OR s.listing_url = v.listing_url || '/')
    )
    WHERE COALESCE(v.listing_source, v.platform_source, v.source) IN ('bringatrailer', 'bat_simple_extract', 'bat')
      AND v.listing_url IS NOT NULL
      AND v.listing_url LIKE '%bringatrailer.com/listing/%'
      AND (v.description IS NULL OR v.mileage IS NULL OR v.vin IS NULL OR v.color IS NULL OR v.sale_price IS NULL)
    ORDER BY
      CASE WHEN v.description IS NULL THEN 0 ELSE 1 END,
      CASE WHEN v.sale_price IS NULL THEN 0 ELSE 1 END,
      v.created_at DESC
    LIMIT $BATCH_SIZE;
  " 2>/dev/null > "$WORK_DIR/batch-raw.txt"

  BATCH_COUNT=$(wc -l < "$WORK_DIR/batch-raw.txt" | tr -d ' ')
  [ "$BATCH_COUNT" -eq 0 ] && break

  # Process each row — field separator is ASCII unit separator (0x1f)
  BATCH_SQL=""
  BATCH_SUCCESS=0

  while IFS=$'\x1f' read -r VID HTML_CONTENT; do
    [ -z "$VID" ] && continue
    [ -z "$HTML_CONTENT" ] && continue

    # Write HTML to temp file, parse with Python
    echo "$HTML_CONTENT" > "$WORK_DIR/page.html"

    SQL=$(python3 "$SCRIPT_DIR/reparse-bat-single.py" "$VID" < "$WORK_DIR/page.html" 2>/dev/null)

    if [ -n "$SQL" ] && [ "$SQL" != "--" ]; then
      BATCH_SQL="${BATCH_SQL}${SQL}\n"
      BATCH_SUCCESS=$((BATCH_SUCCESS + 1))
    fi
  done < "$WORK_DIR/batch-raw.txt"

  # Execute batch SQL
  if [ -n "$BATCH_SQL" ]; then
    echo -e "$BATCH_SQL" | psql "$DB" > "$WORK_DIR/sql-result.txt" 2>&1
    UPDATES=$(grep -c "UPDATE 1" "$WORK_DIR/sql-result.txt" 2>/dev/null || echo 0)
    SUCCESS=$((SUCCESS + UPDATES))
  fi

  TOTAL=$((TOTAL + BATCH_COUNT))

  # Progress every 100
  if [ $((TOTAL % 100)) -lt $BATCH_SIZE ]; then
    ELAPSED=$SECONDS
    RATE=$((TOTAL / (ELAPSED > 0 ? ELAPSED : 1)))
    PCT=$((TOTAL * 100 / TOTAL_TARGET))
    REMAINING=$(( (TOTAL_TARGET - TOTAL) / (RATE > 0 ? RATE : 1) ))
    log "Progress: $TOTAL/$TOTAL_TARGET (${PCT}%) | Updated: $SUCCESS | ~$((REMAINING / 60))m left"
  fi
done

ELAPSED=$SECONDS
log "================================================================"
log "COMPLETE: $TOTAL processed, $SUCCESS updated"
log "Duration: $((ELAPSED / 60))m $((ELAPSED % 60))s"
log "================================================================"
