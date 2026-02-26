#!/bin/bash
# Overnight iPhoto intake — runs --all, locks to prevent overlap, logs everything

LOCK=/tmp/iphoto-overnight.lock
LOG_DIR=/Users/skylar/nuke/logs
LOG="$LOG_DIR/iphoto-overnight-$(date +%Y-%m-%d).log"
SCRIPT_DIR=/Users/skylar/nuke

mkdir -p "$LOG_DIR"

# Only one run at a time
if [ -f "$LOCK" ]; then
  pid=$(cat "$LOCK")
  if kill -0 "$pid" 2>/dev/null; then
    echo "$(date): Already running (PID $pid), exiting" >> "$LOG"
    exit 0
  fi
fi
echo $$ > "$LOCK"
trap "rm -f $LOCK" EXIT

echo "========================================" >> "$LOG"
echo "$(date): Starting iPhoto overnight intake" >> "$LOG"
echo "========================================" >> "$LOG"

cd "$SCRIPT_DIR" && dotenvx run -- node scripts/iphoto-intake.mjs --all >> "$LOG" 2>&1
STATUS=$?

echo "$(date): Finished (exit $STATUS)" >> "$LOG"

# Count results from log
MATCHED=$(grep -c "Done:.*uploaded" "$LOG" 2>/dev/null || echo 0)
PHOTOS=$(grep "uploaded," "$LOG" | grep -oE '[0-9]+ uploaded' | awk '{sum+=$1} END {print sum+0}')

# macOS notification
osascript -e "display notification \"$PHOTOS photos across $MATCHED albums\" with title \"iPhoto Intake Done ✓\" subtitle \"Check logs/iphoto-overnight-$(date +%Y-%m-%d).log\""
