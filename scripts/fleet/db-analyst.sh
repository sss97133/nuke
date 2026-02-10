#!/bin/bash
# db-analyst.sh — Database Monitoring Agent
# Tracks extraction velocity and progress every 5 minutes

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [DB-ANALYST] $*"; }

query() {
  dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c \"$1\"" 2>/dev/null | grep -v 'dotenvx' | grep -v 'injecting'
}

safe_num() {
  local val="$1"
  val=$(echo "$val" | tr -d ' \n')
  if [ -n "$val" ] && [ "$val" -eq "$val" ] 2>/dev/null; then
    echo "$val"
  else
    echo "0"
  fi
}

PREV_TOTAL=0
PREV_TIME=$(date +%s)
INITIAL_TOTAL=$(safe_num "$(query "SELECT COUNT(*) FROM vehicles;")")

log "========================================="
log "DB ANALYST STARTED | Initial vehicles: $INITIAL_TOTAL"
log "========================================="

while [ "$(date +%s)" -lt "$END_TIME" ]; do
  CURRENT_TOTAL=$(safe_num "$(query "SELECT COUNT(*) FROM vehicles;")")
  NOW=$(date +%s)
  ELAPSED_MINS=$(( (NOW - (END_TIME - DURATION)) / 60 ))

  # Velocity calculation
  if [ "$PREV_TOTAL" -gt 0 ]; then
    DELTA=$((CURRENT_TOTAL - PREV_TOTAL))
    TIME_DELTA=$((NOW - PREV_TIME))
    if [ "$TIME_DELTA" -gt 0 ]; then
      VPM=$(echo "scale=1; $DELTA * 60 / $TIME_DELTA" | bc 2>/dev/null || echo "?")
    else
      VPM="0"
    fi
  else
    DELTA=0
    VPM="0"
  fi

  TOTAL_NEW=$((CURRENT_TOTAL - INITIAL_TOTAL))

  log "─────────────────────────────────────────"
  log "DASHBOARD @ ${ELAPSED_MINS}min"
  log "  Total vehicles: $CURRENT_TOTAL (+$TOTAL_NEW since start)"
  log "  Last period:    +$DELTA | Velocity: ${VPM} v/min"
  log ""

  # Queue status by domain
  log "  QUEUE STATUS:"
  QUEUE_DATA=$(query "
    SELECT
      CASE
        WHEN listing_url LIKE '%barrett-jackson%' THEN 'barrett-jackson'
        WHEN listing_url LIKE '%broadarrow%' THEN 'broadarrow'
        WHEN listing_url LIKE '%vanguard%' THEN 'vanguard'
        WHEN listing_url LIKE '%velocity%' THEN 'velocity'
        WHEN listing_url LIKE '%icon4x4%' THEN 'icon4x4'
        WHEN listing_url LIKE '%bonhams%' THEN 'bonhams'
        WHEN listing_url LIKE '%rmsothebys%' THEN 'rmsothebys'
        WHEN listing_url LIKE '%gooding%' THEN 'gooding'
        WHEN listing_url LIKE '%gaa%' THEN 'gaa'
        WHEN listing_url LIKE '%bhauction%' THEN 'bhauction'
        WHEN listing_url LIKE '%ringbrothers%' THEN 'ringbrothers'
        WHEN listing_url LIKE '%coolnvintage%' THEN 'coolnvintage'
        WHEN listing_url LIKE '%brabus%' THEN 'brabus'
        ELSE 'other'
      END as domain,
      status,
      COUNT(*)
    FROM import_queue
    GROUP BY 1, 2
    ORDER BY 1, 2;
  ")
  echo "$QUEUE_DATA" | while read -r line; do
    [ -n "$line" ] && log "    $line"
  done

  log ""

  # Recent extraction activity
  log "  RECENT ACTIVITY (last 5 min):"
  RECENT=$(query "
    SELECT
      COALESCE(discovery_source, 'unknown') as source,
      COUNT(*) as cnt
    FROM vehicles
    WHERE created_at > NOW() - INTERVAL '5 minutes'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10;
  ")
  if [ -n "$(echo "$RECENT" | tr -d '[:space:]')" ]; then
    echo "$RECENT" | while read -r line; do
      [ -n "$line" ] && log "    $line"
    done
  else
    log "    (no new vehicles in last 5 min)"
  fi

  # Stall detection
  if [ "$DELTA" -eq 0 ] && [ "$PREV_TOTAL" -gt 0 ]; then
    log ""
    log "  WARNING: No progress in last period!"
    # Check for stuck processing items
    STUCK=$(query "SELECT COUNT(*) FROM import_queue WHERE status='processing' AND locked_at < NOW() - INTERVAL '10 minutes';" | tr -d ' ')
    [ "$STUCK" -gt 0 ] && log "  STUCK ITEMS: $STUCK processing for >10min"
  fi

  PREV_TOTAL=$CURRENT_TOTAL
  PREV_TIME=$NOW

  sleep 300
done

log "DB Analyst shutting down."
FINAL=$(safe_num "$(query "SELECT COUNT(*) FROM vehicles;")")
log "Final vehicle count: $FINAL (+$((FINAL - INITIAL_TOTAL)) total new)"
