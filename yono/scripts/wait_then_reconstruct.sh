#!/bin/bash
# wait_then_reconstruct.sh
#
# Watches for the zone classifier to finish, then runs the full
# reconstruction pipeline:
#   1. Restart server.py (loads new zone model)
#   2. Run zone inference on top 10 BaT vehicles
#   3. Run COLMAP reconstruction on top 5 vehicles
#
# Usage: bash yono/scripts/wait_then_reconstruct.sh &

ZONE_PID=12814
PYTHON="/Users/skylar/nuke/yono/.venv/bin/python3"
ZONE_LOG="/Users/skylar/nuke/yono/outputs/zone_classifier/training.log"
INFERENCE_LOG="/Users/skylar/nuke/yono/outputs/zone_classifier/inference.log"
RECONSTRUCT_LOG="/tmp/bat_reconstruct_auto.log"
SERVER_PID_FILE="/tmp/yono_server.pid"

cd /Users/skylar/nuke

echo "[$(date)] Watching for zone classifier (PID $ZONE_PID) to finish..."
echo "[$(date)] Zone training log: $ZONE_LOG"
echo "[$(date)] Will then: restart server → zone inference → COLMAP reconstruction"

while kill -0 "$ZONE_PID" 2>/dev/null; do
    sleep 60
done

echo ""
echo "[$(date)] ✓ Zone classifier finished."

# ── Check for saved weights ───────────────────────────────────────────────

ZONE_WEIGHTS="yono/models/yono_zone_head.safetensors"
if [ -f "$ZONE_WEIGHTS" ]; then
    echo "[$(date)] ✓ Zone model found: $ZONE_WEIGHTS"
else
    echo "[$(date)] ✗ Zone weights not found at $ZONE_WEIGHTS"
    echo "[$(date)] Check training log: $ZONE_LOG"
    exit 1
fi

# ── Step 1: Restart server.py to load zone model ─────────────────────────

echo ""
echo "[$(date)] Step 1: Restarting YONO server to load zone model..."

# Kill existing server gracefully
OLD_SERVER=$(pgrep -f "python.*server.py" 2>/dev/null | head -1)
if [ -n "$OLD_SERVER" ]; then
    echo "[$(date)] Killing old server (PID $OLD_SERVER)..."
    kill "$OLD_SERVER" 2>/dev/null
    sleep 3
fi

# Start new server
PYTHONUNBUFFERED=1 nohup "$PYTHON" -u yono/server.py \
    --host 127.0.0.1 --port 8472 \
    > /tmp/yono_server.log 2>&1 &
NEW_SERVER=$!
echo "$NEW_SERVER" > "$SERVER_PID_FILE"
echo "[$(date)] New server started (PID $NEW_SERVER)"

# Wait for server to come up
echo "[$(date)] Waiting for server health check..."
for i in $(seq 1 30); do
    HEALTH=$(curl -s http://127.0.0.1:8472/health 2>/dev/null)
    ZONE_OK=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('zone_available','false'))" 2>/dev/null)
    if [ "$ZONE_OK" = "True" ]; then
        echo "[$(date)] ✓ Server healthy, zone classifier loaded"
        break
    elif [ -n "$HEALTH" ]; then
        echo "[$(date)] Server up but zone not loaded yet (attempt $i/30)..."
    fi
    sleep 5
done

if [ "$ZONE_OK" != "True" ]; then
    echo "[$(date)] WARNING: Server may not have zone model loaded."
    echo "[$(date)] Continuing anyway — inference will still run."
fi

# ── Step 2: Zone inference on top 10 BaT vehicles ────────────────────────

echo ""
echo "[$(date)] Step 2: Running zone inference on top 10 BaT vehicles..."
PYTHONUNBUFFERED=1 "$PYTHON" -u yono/scripts/run_zone_inference.py \
    --bat-top 10 \
    > "$INFERENCE_LOG" 2>&1

INFERENCE_EXIT=$?
echo "[$(date)] Zone inference finished (exit $INFERENCE_EXIT)"
tail -10 "$INFERENCE_LOG"

if [ $INFERENCE_EXIT -ne 0 ]; then
    echo "[$(date)] Zone inference had errors. Checking if we have enough data to continue..."
fi

# ── Step 3: COLMAP reconstruction on top 5 vehicles ──────────────────────

echo ""
echo "[$(date)] Step 3: Running COLMAP reconstruction on top 5 BaT vehicles..."
PYTHONUNBUFFERED=1 "$PYTHON" -u yono/scripts/bat_reconstruct.py \
    --limit 5 \
    --skip-existing \
    > "$RECONSTRUCT_LOG" 2>&1

RECONSTRUCT_EXIT=$?
echo ""
echo "[$(date)] COLMAP reconstruction finished (exit $RECONSTRUCT_EXIT)"
echo "=========================================="
tail -30 "$RECONSTRUCT_LOG"

echo ""
echo "[$(date)] Pipeline complete."
echo "[$(date)] Logs:"
echo "  Zone training:   $ZONE_LOG"
echo "  Zone inference:  $INFERENCE_LOG"
echo "  Reconstruction:  $RECONSTRUCT_LOG"
echo ""
echo "[$(date)] Check results:"
echo "  psql -c 'SELECT vehicle_id, reconstruction_quality, image_count FROM vehicle_reconstructions ORDER BY reconstructed_at DESC LIMIT 5;'"
