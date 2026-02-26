#!/bin/bash
# wait_then_train_zones.sh
# Waits for the condition model training (PID 68092) to finish,
# then launches zone classifier training automatically.
#
# Usage: bash yono/scripts/wait_then_train_zones.sh &

CONDITION_PID=68092
LOG="/Users/skylar/nuke/yono/outputs/zone_classifier/training.log"
PYTHON="/Users/skylar/nuke/yono/.venv/bin/python3"
SCRIPT="/Users/skylar/nuke/yono/scripts/train_zone_classifier.py"
EPOCHS=15

echo "[$(date)] Watching for condition model (PID $CONDITION_PID) to finish..."
echo "[$(date)] Will launch zone classifier training when ready."
echo "[$(date)] Zone classifier log: $LOG"

while kill -0 "$CONDITION_PID" 2>/dev/null; do
    sleep 30
done

echo "[$(date)] Condition model (PID $CONDITION_PID) has finished."
echo "[$(date)] Checking for saved weights..."

WEIGHTS="/Users/skylar/nuke/yono/models/yono_vision_v2_head.safetensors"
if [ -f "$WEIGHTS" ]; then
    echo "[$(date)] Found weights: $WEIGHTS"
else
    echo "[$(date)] WARNING: weights file not found at $WEIGHTS — zone classifier will still train (shares Florence-2 backbone)"
fi

echo "[$(date)] Starting zone classifier training (${EPOCHS} epochs)..."
cd /Users/skylar/nuke
PYTHONUNBUFFERED=1 "$PYTHON" -u "$SCRIPT" --epochs "$EPOCHS" > "$LOG" 2>&1

EXIT_CODE=$?
echo ""
echo "[$(date)] Zone classifier training finished with exit code $EXIT_CODE"
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date)] SUCCESS — check $LOG for final metrics"
    echo "[$(date)] Zone model weights saved in yono/models/"
else
    echo "[$(date)] ERROR — check $LOG for details"
fi
