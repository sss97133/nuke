#!/bin/bash
# VIN Decode Gap Filler — Targets vehicles with valid VINs missing trim/engine/drivetrain
# Uses NHTSA batch API (50 VINs per call), fills ALL empty structured fields
# Designed to run for hours — processes ~84K vehicles at ~150 VINs/sec
set -uo pipefail

DB="postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
WORK_DIR="/tmp/nuke-vin-gaps"
VIN_FILE="$WORK_DIR/vins-to-decode.txt"
LOG="$WORK_DIR/progress.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BATCH_SIZE=50
TOTAL=0
SUCCESS=0
SKIPPED=0
ERRORS=0
SECONDS=0

mkdir -p "$WORK_DIR"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

# Step 1: Extract VINs that need decoding
# Target: valid 17-char VINs missing trim OR engine OR drivetrain OR body_style
log "Extracting VINs needing decode..."
psql "$DB" -t -A -c "
  SELECT vin FROM vehicles
  WHERE vin IS NOT NULL
    AND LENGTH(vin) = 17
    AND vin ~ '^[1-9A-HJ-NPR-Z][A-HJ-NPR-Z0-9]{16}$'
    AND year >= 1981
    AND (trim IS NULL OR engine_size IS NULL OR drivetrain IS NULL OR body_style IS NULL)
    AND COALESCE(engine_size, '') != 'N/A'
  ORDER BY
    CASE WHEN trim IS NULL THEN 0 ELSE 1 END,
    created_at DESC;
" > "$VIN_FILE" 2>/dev/null

TOTAL_VINS=$(wc -l < "$VIN_FILE" | tr -d ' ')

if [ "$TOTAL_VINS" -eq 0 ]; then
  log "No VINs to decode. Done."
  exit 0
fi

log "Found $TOTAL_VINS VINs to decode (prioritizing missing trim)"
log "Estimated time: ~$((TOTAL_VINS / 150 / 60)) minutes at 150 VINs/sec"

# Step 2: Process in batches
while true; do
  OFFSET=$TOTAL
  BATCH=$(sed -n "$((OFFSET + 1)),$((OFFSET + BATCH_SIZE))p" "$VIN_FILE")
  [ -z "$BATCH" ] && break

  VIN_LIST=$(echo "$BATCH" | tr '\n' ';' | sed 's/;$//')
  BATCH_COUNT=$(echo "$BATCH" | wc -l | tr -d ' ')

  # Call NHTSA batch API
  HTTP_CODE=$(curl -s -o "$WORK_DIR/nhtsa-resp.json" -w "%{http_code}" -m 45 \
    -X POST "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/" \
    -d "format=json&DATA=${VIN_LIST}" 2>/dev/null)

  if [ "$HTTP_CODE" != "200" ] || [ ! -s "$WORK_DIR/nhtsa-resp.json" ]; then
    ERRORS=$((ERRORS + 1))
    if [ "$ERRORS" -gt 10 ]; then
      log "ERROR: Too many NHTSA failures ($ERRORS). Stopping."
      break
    fi
    log "NHTSA error (HTTP $HTTP_CODE) at offset $OFFSET, retrying in 10s..."
    sleep 10
    continue
  fi
  ERRORS=0  # Reset error counter on success

  # Parse into SQL using the full parser (extracts trim + all fields)
  SQL=$(python3 "$SCRIPT_DIR/parse-nhtsa-full.py" < "$WORK_DIR/nhtsa-resp.json" 2>"$WORK_DIR/parse-stderr.txt")

  if [ -n "$SQL" ]; then
    echo "$SQL" | psql "$DB" > "$WORK_DIR/sql-result.txt" 2>&1
    UPDATES=$(grep -c "UPDATE 1" "$WORK_DIR/sql-result.txt" 2>/dev/null || echo 0)
    SUCCESS=$((SUCCESS + UPDATES))
    SKIPPED=$((SKIPPED + BATCH_COUNT - UPDATES))
  else
    SKIPPED=$((SKIPPED + BATCH_COUNT))
  fi

  TOTAL=$((TOTAL + BATCH_COUNT))

  # Progress reporting every 500 VINs
  if [ $((TOTAL % 500)) -lt $BATCH_SIZE ]; then
    ELAPSED=$SECONDS
    RATE=$((TOTAL / (ELAPSED > 0 ? ELAPSED : 1)))
    REMAINING=$(( (TOTAL_VINS - TOTAL) / (RATE > 0 ? RATE : 1) ))
    PCT=$((TOTAL * 100 / TOTAL_VINS))
    HIT_PCT=$((SUCCESS * 100 / (TOTAL > 0 ? TOTAL : 1)))
    log "Progress: $TOTAL/$TOTAL_VINS (${PCT}%) | Updated: $SUCCESS (${HIT_PCT}% hit) | Skipped: $SKIPPED | ~$((REMAINING / 60))m remaining"
  fi

  # Throttle: 0.25s between batches (~200 batches/min, well under NHTSA limits)
  sleep 0.25
done

ELAPSED=$SECONDS
log "================================================================"
log "COMPLETE: $TOTAL processed, $SUCCESS updated, $SKIPPED skipped"
log "Duration: $((ELAPSED / 60))m $((ELAPSED % 60))s"
log "================================================================"

# Summary of what was filled
psql "$DB" -c "
  SELECT
    'After decode' as status,
    COUNT(trim) as has_trim,
    COUNT(engine_size) as has_engine,
    COUNT(drivetrain) as has_drivetrain,
    COUNT(body_style) as has_body,
    COUNT(fuel_type) as has_fuel
  FROM vehicles
  WHERE vin IS NOT NULL AND LENGTH(vin) = 17 AND year >= 1981;
" 2>/dev/null | tee -a "$LOG"
