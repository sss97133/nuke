#!/bin/bash
# qa-monitor.sh — Quality Assurance Monitor
# Checks data quality every 15 minutes

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [QA-MONITOR] $*"; }

query() {
  dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c \"$1\"" 2>/dev/null | grep -v 'dotenvx' | grep -v 'injecting'
}

log "QA Monitor started."

while [ "$(date +%s)" -lt "$END_TIME" ]; do

  log "═══════════════════════════════════════"
  log "QA REPORT @ $(date '+%Y-%m-%d %H:%M:%S')"
  log "═══════════════════════════════════════"

  # 1. Null year/make/model in recent inserts
  log ""
  log "1. NULL FIELDS IN RECENT VEHICLES (last 15 min):"
  NULL_FIELDS=$(query "
    SELECT
      COUNT(*) FILTER (WHERE year IS NULL) as null_year,
      COUNT(*) FILTER (WHERE make IS NULL) as null_make,
      COUNT(*) FILTER (WHERE model IS NULL) as null_model,
      COUNT(*) FILTER (WHERE year IS NULL AND make IS NULL AND model IS NULL) as all_null,
      COUNT(*) as total_recent
    FROM vehicles
    WHERE created_at > NOW() - INTERVAL '15 minutes';
  ")
  log "  $NULL_FIELDS"

  # 2. Duplicate VINs
  log ""
  log "2. DUPLICATE VINs (recent):"
  DUPE_VINS=$(query "
    SELECT vin, COUNT(*) as cnt
    FROM vehicles
    WHERE vin IS NOT NULL
      AND LENGTH(vin) = 17
      AND created_at > NOW() - INTERVAL '1 hour'
    GROUP BY vin
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 5;
  ")
  if [ -n "$(echo "$DUPE_VINS" | tr -d '[:space:]')" ]; then
    echo "$DUPE_VINS" | while read -r line; do
      [ -n "$line" ] && log "  $line"
    done
  else
    log "  (no duplicates)"
  fi

  # 3. Image counts
  log ""
  log "3. IMAGE COVERAGE (recent vehicles):"
  IMG_STATS=$(query "
    SELECT
      COUNT(*) as total_vehicles,
      COUNT(*) FILTER (WHERE id IN (SELECT DISTINCT vehicle_id FROM vehicle_images)) as with_images,
      ROUND(100.0 * COUNT(*) FILTER (WHERE id IN (SELECT DISTINCT vehicle_id FROM vehicle_images)) / NULLIF(COUNT(*), 0), 1) as pct
    FROM vehicles
    WHERE created_at > NOW() - INTERVAL '1 hour';
  ")
  log "  $IMG_STATS"

  # 4. Source distribution
  log ""
  log "4. EXTRACTION SOURCE DISTRIBUTION (last hour):"
  SOURCES=$(query "
    SELECT
      COALESCE(discovery_source, 'unknown') as source,
      COUNT(*) as vehicles,
      ROUND(AVG(CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END)::numeric * 100, 0) as year_pct,
      ROUND(AVG(CASE WHEN make IS NOT NULL THEN 1 ELSE 0 END)::numeric * 100, 0) as make_pct
    FROM vehicles
    WHERE created_at > NOW() - INTERVAL '1 hour'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 15;
  ")
  if [ -n "$(echo "$SOURCES" | tr -d '[:space:]')" ]; then
    echo "$SOURCES" | while read -r line; do
      [ -n "$line" ] && log "  $line"
    done
  else
    log "  (no recent vehicles)"
  fi

  # 5. Queue health
  log ""
  log "5. QUEUE HEALTH:"
  QUEUE=$(query "
    SELECT status, COUNT(*)
    FROM import_queue
    GROUP BY 1
    ORDER BY 2 DESC;
  ")
  echo "$QUEUE" | while read -r line; do
    [ -n "$line" ] && log "  $line"
  done

  # 6. Error patterns
  log ""
  log "6. TOP ERROR PATTERNS (last hour):"
  ERRORS=$(query "
    SELECT
      LEFT(error_message, 80) as error,
      COUNT(*) as cnt
    FROM import_queue
    WHERE status='failed'
      AND updated_at > NOW() - INTERVAL '1 hour'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 5;
  ")
  if [ -n "$(echo "$ERRORS" | tr -d '[:space:]')" ]; then
    echo "$ERRORS" | while read -r line; do
      [ -n "$line" ] && log "  $line"
    done
  else
    log "  (no recent errors)"
  fi

  sleep 900
done

log "QA Monitor shutting down."
