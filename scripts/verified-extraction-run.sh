#!/bin/bash
# Verified extraction: long (multi-hour) run using ONLY local Playwright.
# No Firecrawl, no edge-function extraction. High quality, rate-limited.
#
# Usage:
#   ./scripts/verified-extraction-run.sh [HOURS]
#   VERIFIED_SOURCES_ONLY=1 ./scripts/verified-extraction-run.sh 6
#
# Env:
#   HOURS (or $1)         - Run for this many hours (default 6)
#   VERIFIED_SOURCES_ONLY - If 1, only process BaT, Hagerty, KSL (default 0 = all sources Playwright can do)
#   WORKERS              - Playwright workers (default 2 for stability)
#   BATCH_SIZE           - Not used by extractor; leave default

set -e
cd /Users/skylar/nuke

HOURS="${1:-${HOURS:-6}}"
export VERIFIED_SOURCES_ONLY="${VERIFIED_SOURCES_ONLY:-0}"
export WORKERS="${WORKERS:-2}"

LOG_DIR="logs"
LOG_FILE="$LOG_DIR/verified-extraction-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$LOG_DIR"

END_TS=$(($(date +%s) + HOURS * 3600))

echo "=== Verified extraction run ===" | tee "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Will run for $HOURS hours" | tee -a "$LOG_FILE"
echo "VERIFIED_SOURCES_ONLY=$VERIFIED_SOURCES_ONLY WORKERS=$WORKERS" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Run Playwright extractor in background; kill after HOURS
(
  dotenvx run -- npx tsx scripts/autonomous-playwright-extractor.ts 2>&1
) >> "$LOG_FILE" 2>&1 &
PID=$!

while [ $(date +%s) -lt $END_TS ]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "[$(date)] Process exited early (pid $PID)" | tee -a "$LOG_FILE"
    exit 1
  fi
  sleep 60
done

kill "$PID" 2>/dev/null || true
echo "" | tee -a "$LOG_FILE"
echo "=== Run complete ($HOURS hours) ===" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
