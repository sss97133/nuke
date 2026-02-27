#!/bin/bash
# wait_then_train_hier_tier2.sh
# Waits for zone classifier training (PID 12814) to finish,
# then trains remaining hierarchical tier-2 families (german, british,
# japanese, italian, french, swedish) and exports all ONNX models.
#
# american is skipped — hier_american_best.pt already exists.
#
# Usage: bash yono/scripts/wait_then_train_hier_tier2.sh &

ZONE_PID=12814
LOG_DIR="/Users/skylar/nuke/yono/outputs/hierarchical"
LOG="$LOG_DIR/tier2_remaining.log"
PYTHON="/Users/skylar/nuke/yono/.venv/bin/python3"
SCRIPT="/Users/skylar/nuke/yono/scripts/train_hierarchical.py"
FAMILIES="german british japanese italian french swedish"

mkdir -p "$LOG_DIR"

echo "[$(date)] Watching for zone classifier (PID $ZONE_PID) to finish..." | tee -a "$LOG"
echo "[$(date)] Will train tier-2 families: $FAMILIES" | tee -a "$LOG"
echo "[$(date)] Log: $LOG" | tee -a "$LOG"

while kill -0 "$ZONE_PID" 2>/dev/null; do
    sleep 30
done

echo "[$(date)] Zone classifier (PID $ZONE_PID) has finished." | tee -a "$LOG"
echo "[$(date)] Starting hierarchical tier-2 training..." | tee -a "$LOG"

cd /Users/skylar/nuke

FAILED=""
for FAMILY in $FAMILIES; do
    echo "" | tee -a "$LOG"
    echo "[$(date)] === Training family: $FAMILY ===" | tee -a "$LOG"
    PYTHONUNBUFFERED=1 "$PYTHON" -u "$SCRIPT" --tier 2 --family "$FAMILY" >> "$LOG" 2>&1
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date)] $FAMILY: SUCCESS" | tee -a "$LOG"
    else
        echo "[$(date)] $FAMILY: FAILED (exit $EXIT_CODE)" | tee -a "$LOG"
        FAILED="$FAILED $FAMILY"
    fi
done

echo "" | tee -a "$LOG"
echo "[$(date)] === Exporting all checkpoints to ONNX ===" | tee -a "$LOG"
PYTHONUNBUFFERED=1 "$PYTHON" -u "$SCRIPT" --export >> "$LOG" 2>&1
EXPORT_CODE=$?
if [ $EXPORT_CODE -eq 0 ]; then
    echo "[$(date)] ONNX export: SUCCESS" | tee -a "$LOG"
else
    echo "[$(date)] ONNX export: FAILED (exit $EXPORT_CODE)" | tee -a "$LOG"
fi

echo "" | tee -a "$LOG"
echo "[$(date)] === DONE ===" | tee -a "$LOG"
if [ -n "$FAILED" ]; then
    echo "[$(date)] Failed families:$FAILED" | tee -a "$LOG"
else
    echo "[$(date)] All families trained successfully." | tee -a "$LOG"
fi
echo "[$(date)] ONNX models in: yono/outputs/hierarchical/" | tee -a "$LOG"
echo "[$(date)] Next step: upload ONNX files to Modal volume yono-data" | tee -a "$LOG"
