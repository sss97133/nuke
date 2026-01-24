#!/bin/bash
#
# PCarMarket Background Extraction Daemon
# Runs completely in background - no terminal needed
#
# Usage:
#   ./scripts/pcarmarket-daemon.sh start    # Start background extraction
#   ./scripts/pcarmarket-daemon.sh stop     # Stop daemon
#   ./scripts/pcarmarket-daemon.sh status   # Check progress
#   ./scripts/pcarmarket-daemon.sh logs     # Tail logs
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_ROOT/logs/pcarmarket"
PID_FILE="$PROJECT_ROOT/.pcarmarket-daemon.pid"
URLS_FILE="$PROJECT_ROOT/.pcarmarket-queue.txt"
DONE_FILE="$PROJECT_ROOT/.pcarmarket-done.txt"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_DIR/daemon.log"
}

run_extraction() {
  cd "$PROJECT_ROOT"

  log "Daemon started"

  while true; do
    # Check if queue file exists and has content
    if [[ ! -f "$URLS_FILE" ]] || [[ ! -s "$URLS_FILE" ]]; then
      log "Queue empty, sleeping 5 minutes..."
      sleep 300
      continue
    fi

    # Get next URL
    URL=$(head -1 "$URLS_FILE")
    if [[ -z "$URL" ]]; then
      sleep 60
      continue
    fi

    log "Processing: $URL"

    # Extract using Playwright (headless)
    RESULT=$(dotenvx run --quiet -- node scripts/pcarmarket-scrape.js "$URL" 2>&1) || true

    # Log result
    if echo "$RESULT" | grep -q '"success":true'; then
      log "SUCCESS: $URL"
      echo "$URL" >> "$DONE_FILE"
    else
      log "FAILED: $URL - $(echo "$RESULT" | grep -o '"error":"[^"]*"' || echo 'unknown error')"
    fi

    # Remove from queue
    tail -n +2 "$URLS_FILE" > "$URLS_FILE.tmp" && mv "$URLS_FILE.tmp" "$URLS_FILE"

    # Rate limit
    sleep 5
  done
}

start_daemon() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Daemon already running (PID: $(cat "$PID_FILE"))"
    exit 1
  fi

  echo "Starting PCarMarket extraction daemon..."

  # Run in background, completely detached
  nohup bash -c "$(declare -f log run_extraction); PROJECT_ROOT='$PROJECT_ROOT' LOG_DIR='$LOG_DIR' URLS_FILE='$URLS_FILE' DONE_FILE='$DONE_FILE' run_extraction" \
    >> "$LOG_DIR/daemon.log" 2>&1 &

  echo $! > "$PID_FILE"
  echo "Daemon started (PID: $!)"
  echo "Logs: $LOG_DIR/daemon.log"
  echo ""
  echo "Add URLs to queue: echo 'https://...' >> $URLS_FILE"
}

stop_daemon() {
  if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      rm "$PID_FILE"
      echo "Daemon stopped"
    else
      rm "$PID_FILE"
      echo "Daemon was not running"
    fi
  else
    echo "No daemon PID file found"
  fi
}

show_status() {
  echo "=== PCarMarket Daemon Status ==="
  echo ""

  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Status: RUNNING (PID: $(cat "$PID_FILE"))"
  else
    echo "Status: STOPPED"
  fi

  echo ""
  echo "Queue:     $(wc -l < "$URLS_FILE" 2>/dev/null || echo 0) URLs pending"
  echo "Completed: $(wc -l < "$DONE_FILE" 2>/dev/null || echo 0) URLs done"
  echo ""
  echo "Recent log:"
  tail -5 "$LOG_DIR/daemon.log" 2>/dev/null || echo "(no logs yet)"
}

show_logs() {
  tail -f "$LOG_DIR/daemon.log"
}

populate_queue() {
  local TYPE="${1:-sold}"
  local START="${2:-1}"
  local END="${3:-10}"

  echo "Discovering $TYPE pages $START-$END..."
  node "$SCRIPT_DIR/pcarmarket-scrape.js" --discover "$TYPE" "$START" "$END" 2>/dev/null | \
    grep '^https' >> "$URLS_FILE"

  # Deduplicate
  sort -u "$URLS_FILE" -o "$URLS_FILE"

  echo "Queue now has $(wc -l < "$URLS_FILE") URLs"
}

case "${1:-}" in
  start)
    start_daemon
    ;;
  stop)
    stop_daemon
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  queue)
    populate_queue "${2:-sold}" "${3:-1}" "${4:-10}"
    ;;
  *)
    echo "PCarMarket Background Extraction Daemon"
    echo ""
    echo "Usage: $0 {start|stop|status|logs|queue}"
    echo ""
    echo "Commands:"
    echo "  start              Start background extraction"
    echo "  stop               Stop daemon"
    echo "  status             Show queue and progress"
    echo "  logs               Tail daemon logs"
    echo "  queue [type] [s] [e]  Discover and add URLs (type=sold|unsold, pages s-e)"
    echo ""
    echo "Example:"
    echo "  $0 queue sold 1 50    # Add pages 1-50 of sold auctions"
    echo "  $0 start              # Start processing"
    exit 1
    ;;
esac
