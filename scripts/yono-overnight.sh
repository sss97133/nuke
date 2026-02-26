#!/bin/bash
# yono-overnight.sh — Nightly YONO training cycle
#
# 1. Run hierarchical classifier training (if new data available)
# 2. Export all trained models to ONNX
# 3. Restart YONO sidecar with updated models
# 4. macOS notification when done
#
# Add to crontab: 0 2 * * * /Users/skylar/nuke/scripts/yono-overnight.sh
# (runs at 2am, after iphoto-overnight.sh at 1am)

YONO_DIR=/Users/skylar/nuke/yono
PYTHON=$YONO_DIR/.venv/bin/python
LOG_DIR=/Users/skylar/nuke/logs
LOCK_FILE=/tmp/yono_overnight.lock
DATE=$(date +%Y-%m-%d)
LOG_FILE=$LOG_DIR/yono-overnight-$DATE.log

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# Lock to prevent overlap
if [ -f "$LOCK_FILE" ]; then
  PID=$(cat "$LOCK_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    log "Already running (PID $PID), skipping"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

cd "$YONO_DIR" || exit 1

log "=== YONO Overnight Training Cycle ($DATE) ==="

# ── 1. Check if labeled_index.csv has been updated since last training ──────
LAST_TRAIN_MARKER=$YONO_DIR/outputs/hierarchical/.last_trained
LABELED_INDEX=/Users/skylar/nuke/training-data/labeled_index.csv

if [ -f "$LAST_TRAIN_MARKER" ] && [ -f "$LABELED_INDEX" ]; then
  if [ "$LABELED_INDEX" -ot "$LAST_TRAIN_MARKER" ]; then
    log "No new training data since last run. Skipping training."
    SKIP_TRAINING=1
  fi
fi

# ── 2. Run hierarchical training (skipped if no new data) ───────────────────
if [ -z "$SKIP_TRAINING" ]; then
  log "Starting hierarchical classifier training..."
  $PYTHON scripts/train_hierarchical.py --all >> "$LOG_FILE" 2>&1
  TRAIN_EXIT=$?
  if [ $TRAIN_EXIT -ne 0 ]; then
    log "Training failed with exit code $TRAIN_EXIT"
    osascript -e 'display notification "Training failed — check logs" with title "YONO Overnight" sound name "Basso"' 2>/dev/null
    exit 1
  fi
  touch "$LAST_TRAIN_MARKER"
  log "Training completed"
fi

# ── 3. Export all models to ONNX ────────────────────────────────────────────
log "Exporting models to ONNX..."
$PYTHON scripts/train_hierarchical.py --export >> "$LOG_FILE" 2>&1
if [ $? -ne 0 ]; then
  log "ONNX export failed"
else
  log "ONNX export complete"
fi

# ── 4. Restart YONO sidecar ─────────────────────────────────────────────────
log "Restarting YONO sidecar..."
/Users/skylar/nuke/scripts/yono-server-start.sh >> "$LOG_FILE" 2>&1 &
sleep 5
if curl -s http://127.0.0.1:8472/health > /dev/null 2>&1; then
  log "Sidecar restarted and healthy"
else
  log "Sidecar restart failed — check logs"
fi

# ── 5. Report results ────────────────────────────────────────────────────────
ONNX_COUNT=$(ls "$YONO_DIR/models"/hier_*.onnx 2>/dev/null | wc -l | tr -d ' ')
log "Done. $ONNX_COUNT ONNX models available."

# macOS notification
osascript -e "display notification \"Training complete. $ONNX_COUNT ONNX models. Server restarted.\" with title \"YONO Overnight\" sound name \"Hero\"" 2>/dev/null

log "=== Cycle complete ==="
