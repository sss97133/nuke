#!/bin/bash
# extraction-fleet.sh — Master Fleet Orchestrator
# Launches coordinated multi-agent extraction operation
#
# Usage: ./scripts/extraction-fleet.sh [hours]
# Default: 8 hours

HOURS="${1:-8}"
DURATION_SECS=$((HOURS * 3600))
FLEET_DIR="$(cd "$(dirname "$0")" && pwd)/fleet"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_DIR="$PROJECT_DIR/logs/fleet-${TIMESTAMP}"

mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_DIR/master.log"; }

db_query() {
  dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c \"$1\"" 2>/dev/null | grep -v 'dotenvx' | grep -v 'injecting'
}

log "========================================="
log "EXTRACTION FLEET LAUNCHED"
log "Duration: ${HOURS}h | Logs: $LOG_DIR"
log "========================================="

# Pre-flight: vehicle count
VEHICLE_COUNT_BEFORE=$(db_query "SELECT COUNT(*) FROM vehicles;" | tr -d ' \n')
log "Vehicles before: $VEHICLE_COUNT_BEFORE"

# Pre-flight: queue snapshot
QUEUE_SNAPSHOT=$(db_query "SELECT status, COUNT(*) FROM import_queue GROUP BY 1 ORDER BY 2 DESC;")
log "Queue snapshot:"
echo "$QUEUE_SNAPSHOT" | tee -a "$LOG_DIR/master.log"

ALL_PIDS=()
LONG_RUNNING_PIDS=()

# Launch Agent 1: Investigator (URL discovery) — LONG RUNNING
log "Launching Investigator..."
bash "$FLEET_DIR/investigator.sh" "$DURATION_SECS" >> "$LOG_DIR/investigator.log" 2>&1 &
ALL_PIDS+=($!)
LONG_RUNNING_PIDS+=($!)

# Launch Agent 2: DB Analyst (monitoring) — LONG RUNNING
log "Launching DB Analyst..."
bash "$FLEET_DIR/db-analyst.sh" "$DURATION_SECS" >> "$LOG_DIR/dashboard.log" 2>&1 &
ALL_PIDS+=($!)
LONG_RUNNING_PIDS+=($!)

# Launch Agent 3: Curator (queue management) — LONG RUNNING
log "Launching Curator..."
bash "$FLEET_DIR/curator.sh" "$DURATION_SECS" >> "$LOG_DIR/curator.log" 2>&1 &
ALL_PIDS+=($!)
LONG_RUNNING_PIDS+=($!)

# Launch Agent 4: Workers (domain-specific) — most are one-shot except generic
for worker in worker-rmsothebys worker-gaa worker-gooding worker-bh worker-bonhams worker-bj worker-specialty; do
  if [ -f "$FLEET_DIR/${worker}.sh" ]; then
    log "Launching ${worker}..."
    bash "$FLEET_DIR/${worker}.sh" "$DURATION_SECS" >> "$LOG_DIR/${worker}.log" 2>&1 &
    ALL_PIDS+=($!)
    sleep 1
  fi
done

# Generic worker — LONG RUNNING
log "Launching worker-generic..."
bash "$FLEET_DIR/worker-generic.sh" "$DURATION_SECS" >> "$LOG_DIR/worker-generic.log" 2>&1 &
ALL_PIDS+=($!)
LONG_RUNNING_PIDS+=($!)

# Launch Agent 5: QA Monitor — LONG RUNNING
log "Launching QA Monitor..."
bash "$FLEET_DIR/qa-monitor.sh" "$DURATION_SECS" >> "$LOG_DIR/qa-report.log" 2>&1 &
ALL_PIDS+=($!)
LONG_RUNNING_PIDS+=($!)

log "All agents launched. ${#ALL_PIDS[@]} total, ${#LONG_RUNNING_PIDS[@]} long-running"
log "Monitor: tail -f $LOG_DIR/dashboard.log"
log "Master:  tail -f $LOG_DIR/master.log"

END_TIME=$(($(date +%s) + DURATION_SECS))
START_TIME=$((END_TIME - DURATION_SECS))

cleanup() {
  log "Fleet shutdown initiated..."
  for pid in "${ALL_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done

  VEHICLE_COUNT_AFTER=$(db_query "SELECT COUNT(*) FROM vehicles;" | tr -d ' \n')
  NEW_VEHICLES=$((VEHICLE_COUNT_AFTER - VEHICLE_COUNT_BEFORE))

  log "========================================="
  log "FLEET OPERATION COMPLETE"
  log "Vehicles before: $VEHICLE_COUNT_BEFORE"
  log "Vehicles after:  $VEHICLE_COUNT_AFTER"
  log "New vehicles:    $NEW_VEHICLES"
  log "========================================="

  exit 0
}

trap cleanup SIGINT SIGTERM

while [ "$(date +%s)" -lt "$END_TIME" ]; do
  sleep 60

  # Periodic status (safe arithmetic)
  CURRENT_COUNT=$(db_query "SELECT COUNT(*) FROM vehicles;" | tr -d ' \n')
  if [ -n "$CURRENT_COUNT" ] && [ "$CURRENT_COUNT" -eq "$CURRENT_COUNT" ] 2>/dev/null; then
    DELTA=$((CURRENT_COUNT - VEHICLE_COUNT_BEFORE))
  else
    DELTA="?"
  fi

  # Check long-running agents
  ALIVE=0
  for pid in "${LONG_RUNNING_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      ALIVE=$((ALIVE + 1))
    fi
  done

  ELAPSED=$(( ($(date +%s) - START_TIME) / 60 ))
  log "Status: +${DELTA} vehicles | ${ALIVE}/${#LONG_RUNNING_PIDS[@]} long-running alive | ${ELAPSED}min elapsed"

  # Only exit if ALL long-running agents died (not just one-shot workers)
  if [ "$ALIVE" -eq 0 ]; then
    log "All long-running agents have finished. Exiting."
    break
  fi
done

cleanup
