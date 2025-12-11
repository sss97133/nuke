#!/bin/bash

# Start Continuous Vehicle Import System
# Runs in background with logging

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/../logs/continuous-import.log"
PID_FILE="$SCRIPT_DIR/../logs/continuous-import.pid"

# Create logs directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# Check if already running
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "⚠️  Continuous import already running (PID: $PID)"
    echo "   Stop it with: ./scripts/stop-continuous-import.sh"
    exit 1
  else
    # Stale PID file
    rm "$PID_FILE"
  fi
fi

# Start the process
echo "🚀 Starting continuous vehicle import system..."
echo "   Log file: $LOG_FILE"
echo "   PID file: $PID_FILE"

cd "$SCRIPT_DIR/.."
nohup node scripts/continuous-vehicle-import-production.js >> "$LOG_FILE" 2>&1 &
PID=$!

echo $PID > "$PID_FILE"
echo "✅ Started with PID: $PID"
echo "   View logs: tail -f $LOG_FILE"
echo "   Stop: ./scripts/stop-continuous-import.sh"

