#!/bin/bash
# Start YONO inference server
# Usage: ./scripts/yono-server-start.sh [--port 8472] [--fg]

YONO_DIR=/Users/skylar/nuke/yono
PYTHON=$YONO_DIR/.venv/bin/python
PID_FILE=/tmp/yono_server.pid
LOG_FILE=/tmp/yono_server.log
PORT=8472

for arg in "$@"; do
  case $arg in
    --port) PORT=$2; shift 2;;
    --fg) FG=1;;
  esac
done

# Check if already running
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "YONO server already running (PID $PID) on :$PORT"
    echo "  Health: curl http://127.0.0.1:$PORT/health"
    exit 0
  fi
fi

cd "$YONO_DIR"

if [ "$FG" = "1" ]; then
  echo "Starting YONO server on :$PORT (foreground)"
  exec $PYTHON server.py --port $PORT
else
  nohup $PYTHON server.py --port $PORT > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 3
  if kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
    echo "YONO server started (PID $(cat $PID_FILE)) on :$PORT"
    echo "  Health: curl http://127.0.0.1:$PORT/health"
    echo "  Classify: curl -X POST http://127.0.0.1:$PORT/classify -H 'Content-Type: application/json' -d '{\"image_url\":\"...\"}'"
    echo "  Logs: tail -f $LOG_FILE"
  else
    echo "Server failed to start — check $LOG_FILE"
    cat "$LOG_FILE"
  fi
fi
