#!/bin/bash
# Fast VIN Decode — reads from pre-extracted file, no per-batch DB queries
# 50 VINs per NHTSA call, direct SQL updates
set -uo pipefail

DB="postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
VIN_FILE="/tmp/nuke-overnight/vins-to-decode.txt"
LOG="/tmp/nuke-overnight/main.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BATCH_SIZE=50
TOTAL=0
SUCCESS=0
SKIPPED=0

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

TOTAL_VINS=$(wc -l < "$VIN_FILE" | tr -d ' ')
log "[VIN-FAST] Starting fast VIN decode: $TOTAL_VINS VINs from file ($BATCH_SIZE per NHTSA call)"

# Process file in chunks of BATCH_SIZE
while true; do
  # Read next batch from file
  OFFSET=$TOTAL
  BATCH=$(sed -n "$((OFFSET + 1)),$((OFFSET + BATCH_SIZE))p" "$VIN_FILE")

  [ -z "$BATCH" ] && break

  VIN_LIST=$(echo "$BATCH" | tr '\n' ';' | sed 's/;$//')
  BATCH_COUNT=$(echo "$BATCH" | wc -l | tr -d ' ')

  # Call NHTSA batch API
  curl -s -m 45 -X POST "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/" \
    -d "format=json&DATA=${VIN_LIST}" > /tmp/nuke-overnight/nhtsa-resp.json 2>/dev/null

  if [ ! -s /tmp/nuke-overnight/nhtsa-resp.json ]; then
    log "[VIN-FAST] Empty NHTSA response at offset $OFFSET, retrying..."
    sleep 5
    continue
  fi

  # Parse into SQL
  SQL=$(python3 "$SCRIPT_DIR/parse-nhtsa-batch.py" < /tmp/nuke-overnight/nhtsa-resp.json 2>/tmp/nuke-overnight/vin-parse-stderr.txt)

  if [ -n "$SQL" ]; then
    echo "$SQL" | psql "$DB" > /tmp/nuke-overnight/vin-sql-result.txt 2>&1
    UPDATES=$(grep -c "UPDATE 1" /tmp/nuke-overnight/vin-sql-result.txt 2>/dev/null || echo 0)
    SUCCESS=$((SUCCESS + UPDATES))
    SKIPPED=$((SKIPPED + BATCH_COUNT - UPDATES))
  else
    SKIPPED=$((SKIPPED + BATCH_COUNT))
  fi

  TOTAL=$((TOTAL + BATCH_COUNT))

  if [ $((TOTAL % 500)) -lt $BATCH_SIZE ]; then
    PCT=$((SUCCESS * 100 / (TOTAL > 0 ? TOTAL : 1)))
    ETA=$(( (TOTAL_VINS - TOTAL) / (TOTAL / (SECONDS > 0 ? SECONDS : 1) + 1) ))
    log "[VIN-FAST] $TOTAL/$TOTAL_VINS ($SUCCESS updated, ${PCT}% hit, ~${ETA}s remaining)"
  fi

  sleep 0.2
done

log "[VIN-FAST] COMPLETE: $TOTAL processed, $SUCCESS updated, $SKIPPED skipped"
