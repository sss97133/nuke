#!/bin/bash
# Cron entry for verified extraction (Playwright-only, no Firecrawl).
# Run this from crontab for multi-hour extraction on this machine.
#
# Example crontab (run at 2am, 6-hour verified run, only BaT/Hagerty/KSL):
#   0 2 * * * /Users/skylar/nuke/scripts/cron-verified-extraction.sh >> /Users/skylar/nuke/logs/cron-verified-extraction.log 2>&1
#
# Or with VERIFIED_SOURCES_ONLY and HOURS:
#   0 2 * * * VERIFIED_SOURCES_ONLY=1 HOURS=6 /Users/skylar/nuke/scripts/cron-verified-extraction.sh >> /Users/skylar/nuke/logs/cron-verified-extraction.log 2>&1

cd /Users/skylar/nuke
export PATH="/opt/homebrew/bin:$PATH"

LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/cron-verified-extraction.log"

echo "=== Cron verified extraction $(date) ===" >> "$LOG"

# Default: 6 hours, verified sources only (BaT, Hagerty, KSL)
export VERIFIED_SOURCES_ONLY="${VERIFIED_SOURCES_ONLY:-1}"
export HOURS="${HOURS:-6}"

bash scripts/verified-extraction-run.sh "$HOURS" >> "$LOG" 2>&1

# Keep log from growing unbounded (last 2000 lines)
tail -2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
