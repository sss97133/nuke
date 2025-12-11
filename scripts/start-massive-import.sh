#!/bin/bash

# Start Massive Vintage Vehicle Import System
# Targets 10,000+ vehicles

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/../logs/massive-import.log"
PID_FILE="$SCRIPT_DIR/../logs/massive-import.pid"

mkdir -p "$(dirname "$LOG_FILE")"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "⚠️  Massive import already running (PID: $PID)"
    exit 1
  else
    rm "$PID_FILE"
  fi
fi

echo "🚀 Starting MASSIVE vintage vehicle import system..."
echo "   Target: 10,000+ vehicles"
echo "   Log file: $LOG_FILE"

cd "$SCRIPT_DIR/.."
nohup node scripts/massive-vintage-import.js >> "$LOG_FILE" 2>&1 &
PID=$!

echo $PID > "$PID_FILE"
echo "✅ Started with PID: $PID"
echo "   View logs: tail -f $LOG_FILE"
echo "   Stop: kill $PID"

