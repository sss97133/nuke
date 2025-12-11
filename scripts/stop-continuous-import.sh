#!/bin/bash

# Stop Continuous Vehicle Import System

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/../logs/continuous-import.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "⚠️  No PID file found - process may not be running"
  exit 1
fi

PID=$(cat "$PID_FILE")

if ! ps -p "$PID" > /dev/null 2>&1; then
  echo "⚠️  Process not running (stale PID file)"
  rm "$PID_FILE"
  exit 1
fi

echo "🛑 Stopping continuous import system (PID: $PID)..."
kill "$PID"

# Wait for graceful shutdown
for i in {1..10}; do
  if ! ps -p "$PID" > /dev/null 2>&1; then
    echo "✅ Process stopped"
    rm "$PID_FILE"
    exit 0
  fi
  sleep 1
done

# Force kill if still running
if ps -p "$PID" > /dev/null 2>&1; then
  echo "⚠️  Force killing process..."
  kill -9 "$PID"
  rm "$PID_FILE"
  echo "✅ Process force stopped"
fi

