#!/bin/bash

echo "Starting live tracker... (Ctrl+C to stop)"
echo ""

while true; do
  clear
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║      IMAGE BACKFILL - REAL-TIME PROGRESS                       ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  
  cd /Users/skylar/nuke && node scripts/check-progress.js 2>&1 | tail -15
  
  echo ""
  echo "  Auto-refreshing every 5 seconds..."
  echo "  Processing log: tail -f context-backfill.log"
  echo ""
  
  sleep 5
done

