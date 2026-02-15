#!/bin/bash
# Batch VIN Decode — NHTSA batch API (50 VINs per call) + direct DB writes
# ~35K records in ~30 minutes
set -uo pipefail

DB="postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
LOG="/tmp/nuke-overnight/main.log"
BATCH_SIZE=50
TOTAL=0
SUCCESS=0
SKIPPED=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p /tmp/nuke-overnight

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

log "[VIN-BATCH] Starting NHTSA batch decode ($BATCH_SIZE VINs/call)"

while true; do
  # Get batch
  VINS=$(psql "$DB" -t -A -F'|' -c "
    SELECT vin FROM vehicles
    WHERE is_public = true
      AND vin IS NOT NULL AND LENGTH(vin) = 17
      AND engine_size IS NULL AND year >= 1981
      AND vin ~ '^[1-5JKLSTWYZ][A-HJ-NPR-Z0-9]{16}$'
    LIMIT $BATCH_SIZE;" 2>/dev/null)

  [ -z "$VINS" ] && { log "[VIN-BATCH] Done. Total: $TOTAL, Updated: $SUCCESS, Skipped: $SKIPPED"; break; }

  # Build semicolon-separated list
  VIN_LIST=$(echo "$VINS" | tr '\n' ';' | sed 's/;$//')
  BATCH_COUNT=$(echo "$VINS" | wc -l | tr -d ' ')

  # Call NHTSA batch API
  curl -s -m 45 -X POST "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/" \
    -d "format=json&DATA=${VIN_LIST}" > /tmp/nuke-overnight/nhtsa-resp.json 2>/dev/null

  if [ ! -s /tmp/nuke-overnight/nhtsa-resp.json ]; then
    log "[VIN-BATCH] Empty NHTSA response, waiting 5s..."
    sleep 5
    continue
  fi

  # Parse into SQL
  DECODED=$(python3 "$SCRIPT_DIR/parse-nhtsa-batch.py" < /tmp/nuke-overnight/nhtsa-resp.json 2>/tmp/nuke-overnight/vin-parse-stderr.txt)

  if [ -z "$DECODED" ]; then
    SKIP_CT=$BATCH_COUNT
    SKIPPED=$((SKIPPED + SKIP_CT))
    TOTAL=$((TOTAL + BATCH_COUNT))

    # Mark these VINs so we don't retry them — set engine_size to empty marker
    psql "$DB" -c "
      UPDATE vehicles SET engine_size = 'N/A'
      WHERE vin IN ($(echo "$VINS" | sed "s/.*/'&'/" | tr '\n' ',' | sed 's/,$//' ))
        AND engine_size IS NULL;" > /dev/null 2>&1

    if [ $((TOTAL % 200)) -lt $BATCH_SIZE ]; then
      log "[VIN-BATCH] $TOTAL processed, $SUCCESS updated, $SKIPPED skipped (no NHTSA data)"
    fi
    sleep 0.3
    continue
  fi

  # Execute updates (no transaction wrapper — individual fast statements)
  echo "$DECODED" | psql "$DB" > /tmp/nuke-overnight/vin-sql-result.txt 2>&1
  UPDATES=$(grep -c "UPDATE 1" /tmp/nuke-overnight/vin-sql-result.txt 2>/dev/null || echo 0)
  NOT_UPDATED=$((BATCH_COUNT - UPDATES))

  SUCCESS=$((SUCCESS + UPDATES))
  SKIPPED=$((SKIPPED + NOT_UPDATED))
  TOTAL=$((TOTAL + BATCH_COUNT))

  # Mark undecoded VINs so we don't retry
  if [ "$NOT_UPDATED" -gt 0 ]; then
    # Find VINs that weren't in the SQL output and mark them
    DECODED_VINS=$(echo "$DECODED" | grep -oP "vin = '[^']+'" | sed "s/vin = '//" | sed "s/'//")
    UNDECODED=$(comm -23 <(echo "$VINS" | sort) <(echo "$DECODED_VINS" | sort) 2>/dev/null)
    if [ -n "$UNDECODED" ]; then
      psql "$DB" -c "
        UPDATE vehicles SET engine_size = 'N/A'
        WHERE vin IN ($(echo "$UNDECODED" | sed "s/.*/'&'/" | tr '\n' ',' | sed 's/,$//' ))
          AND engine_size IS NULL;" > /dev/null 2>&1
    fi
  fi

  if [ $((TOTAL % 200)) -lt $BATCH_SIZE ]; then
    log "[VIN-BATCH] $TOTAL processed, $SUCCESS updated, $SKIPPED skipped (~$((SUCCESS * 100 / (TOTAL > 0 ? TOTAL : 1)))% hit)"
  fi

  sleep 0.3
done

log "[VIN-BATCH] COMPLETE: $TOTAL total, $SUCCESS updated, $SKIPPED skipped"
