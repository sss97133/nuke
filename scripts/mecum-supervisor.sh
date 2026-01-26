#!/bin/bash
#
# Mecum Supervisor - Stable discovery & extraction
#
# Usage: ./scripts/mecum-supervisor.sh [start|stop|status]
#
# Checkpoints:
#   Discovery: .ralph/mecum_checkpoint.json
#   Extraction: DB pending status (natural checkpoint)
#

cd /Users/skylar/nuke
mkdir -p .ralph/logs

DISCOVERY_LOG=".ralph/logs/mecum_discovery.log"
EXTRACTION_LOG=".ralph/logs/mecum_extraction.log"

start_discovery() {
  if pgrep -f "mecum-discovery-checkpoint" > /dev/null; then
    echo "Discovery already running"
    return
  fi
  
  echo "Starting discovery..."
  nohup dotenvx run -- node scripts/mecum-discovery-checkpoint.js 2 >> "$DISCOVERY_LOG" 2>&1 &
  echo "Discovery started (PID $!)"
}

start_extraction() {
  if pgrep -f "mecum-proper-extract" > /dev/null; then
    echo "Extraction already running"
    return
  fi
  
  echo "Starting extraction (batch=100, workers=3)..."
  nohup dotenvx run -- node scripts/mecum-proper-extract.js 100 3 >> "$EXTRACTION_LOG" 2>&1 &
  echo "Extraction started (PID $!)"
}

stop_all() {
  echo "Stopping processes (graceful)..."
  pkill -f "mecum-discovery-checkpoint" 2>/dev/null && echo "Discovery stopped"
  pkill -f "mecum-proper-extract" 2>/dev/null && echo "Extraction stopped"
}

show_status() {
  echo "╔═══════════════════════════════════════════════════════════════╗"
  echo "║  MECUM PIPELINE STATUS                                        ║"
  echo "╚═══════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Discovery
  if pgrep -f "mecum-discovery-checkpoint" > /dev/null; then
    echo "Discovery: ✅ RUNNING"
  else
    echo "Discovery: ⏹ STOPPED"
  fi
  
  if [ -f ".ralph/mecum_checkpoint.json" ]; then
    COMPLETE=$(grep -c '"complete": true' .ralph/mecum_checkpoint.json 2>/dev/null || echo 0)
    echo "  Auctions complete: $COMPLETE / 340"
    tail -1 "$DISCOVERY_LOG" 2>/dev/null | head -c 80
    echo ""
  fi
  
  echo ""
  
  # Extraction
  if pgrep -f "mecum-proper-extract" > /dev/null; then
    echo "Extraction: ✅ RUNNING"
  else
    echo "Extraction: ⏹ STOPPED"
  fi
  tail -1 "$EXTRACTION_LOG" 2>/dev/null | head -c 80
  echo ""
  
  echo ""
  
  # DB counts
  echo "=== DATABASE COUNTS ==="
  dotenvx run -- node -e "
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const total = await fetch(url + '/rest/v1/vehicles?discovery_source=eq.mecum&select=id', {headers: {apikey: key, Prefer: 'count=exact'}});
  const pending = await fetch(url + '/rest/v1/vehicles?discovery_source=eq.mecum&status=eq.pending&select=id', {headers: {apikey: key, Prefer: 'count=exact'}});
  const active = await fetch(url + '/rest/v1/vehicles?discovery_source=eq.mecum&status=eq.active&select=id', {headers: {apikey: key, Prefer: 'count=exact'}});
  console.log('Mecum Total:   ' + total.headers.get('content-range')?.split('/')[1]);
  console.log('Mecum Pending: ' + pending.headers.get('content-range')?.split('/')[1]);
  console.log('Mecum Active:  ' + active.headers.get('content-range')?.split('/')[1]);
  " 2>/dev/null
}

case "$1" in
  start)
    start_discovery
    sleep 2
    start_extraction
    ;;
  stop)
    stop_all
    ;;
  status)
    show_status
    ;;
  restart)
    stop_all
    sleep 3
    start_discovery
    sleep 2
    start_extraction
    ;;
  *)
    echo "Usage: $0 {start|stop|status|restart}"
    echo ""
    echo "Checkpoints are automatic:"
    echo "  - Discovery saves to .ralph/mecum_checkpoint.json"
    echo "  - Extraction uses DB pending status"
    echo ""
    echo "Safe to stop anytime - will resume where it left off"
    exit 1
    ;;
esac
