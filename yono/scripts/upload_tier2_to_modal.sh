#!/bin/bash
# upload_tier2_to_modal.sh
#
# Uploads tier-2 hierarchical ONNX models + zone classifier to Modal volume yono-data,
# then redeploys the sidecar so new models are picked up.
#
# Run AFTER wait_then_train_hier_tier2.sh completes (watcher PID signals DONE).
# Zone classifier can be uploaded independently (it's already done).
#
# Usage:
#   bash yono/scripts/upload_tier2_to_modal.sh              # upload what exists, then deploy
#   bash yono/scripts/upload_tier2_to_modal.sh --wait        # wait for log signal, then upload+deploy
#   bash yono/scripts/upload_tier2_to_modal.sh --zone-only   # upload zone classifier only, then deploy
#   bash yono/scripts/upload_tier2_to_modal.sh --no-deploy   # upload only, skip modal deploy
#
# Files uploaded to Modal volume yono-data /models/:
#   Tier-2 ONNX: hier_american.onnx, hier_german.onnx, hier_british.onnx,
#                hier_japanese.onnx, hier_italian.onnx, hier_french.onnx,
#                hier_swedish.onnx, hier_labels.json
#   Zone model:  yono_zone_head.safetensors, yono_zone_classifier_labels.json,
#                yono_zone_config.json
#
# Modal workspace: sss97133
# Modal volume put syntax:
#   modal volume put <volume> <local_path> <remote_path>
#   Note: remote_path is the destination *directory* inside the volume.

set -euo pipefail

MODELS_DIR="/Users/skylar/nuke/yono/models"
TIER2_LOG="/Users/skylar/nuke/yono/outputs/hierarchical/tier2_remaining.log"
MODAL_SERVE_PY="/Users/skylar/nuke/yono/modal_serve.py"
VOLUME="yono-data"
REMOTE_DIR="/models"
WORKSPACE="sss97133"
SIDECAR_URL="https://sss97133--yono-serve-fastapi-app.modal.run"
WAIT_MODE=false
ZONE_ONLY=false
NO_DEPLOY=false

TIER2_FAMILIES=(american german british japanese italian french swedish)
TIER2_ONNX=()
for f in "${TIER2_FAMILIES[@]}"; do
    TIER2_ONNX+=("hier_${f}.onnx")
done

# Zone classifier files (stored alongside other models in yono/models/)
ZONE_FILES=(
    "yono_zone_head.safetensors"
    "yono_zone_classifier_labels.json"
    "yono_zone_config.json"
)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── Parse args ───────────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --wait)       WAIT_MODE=true ;;
        --zone-only)  ZONE_ONLY=true ;;
        --no-deploy)  NO_DEPLOY=true ;;
    esac
done

# ── Optional: wait for watcher to signal DONE ────────────────────────────────
if $WAIT_MODE && ! $ZONE_ONLY; then
    log "Waiting for tier-2 training watcher to complete..."
    log "Watching: $TIER2_LOG"
    while true; do
        if grep -q "=== DONE ===" "$TIER2_LOG" 2>/dev/null; then
            log "Watcher signaled DONE."
            break
        fi
        sleep 60
    done
fi

# ── Check modal CLI is available ─────────────────────────────────────────────
if ! command -v modal &>/dev/null; then
    log "ERROR: modal CLI not found. Activate venv: source yono/.venv/bin/activate"
    exit 1
fi

# ── Upload helper ─────────────────────────────────────────────────────────────
UPLOADED=()
SKIPPED=()
FAILED=()

upload_file() {
    local fname="$1"
    local local_path="$MODELS_DIR/$fname"
    if [ -f "$local_path" ]; then
        local size_mb
        size_mb=$(python3 -c "import os; print(f'{os.path.getsize(\"$local_path\")/1e6:.1f}')" 2>/dev/null || echo "?")
        log "Uploading $fname ($size_mb MB) → modal volume $VOLUME $REMOTE_DIR/"
        if modal volume put "$VOLUME" "$local_path" "$REMOTE_DIR/"; then
            log "  ✓ $fname uploaded"
            UPLOADED+=("$fname")
        else
            log "  ✗ $fname FAILED"
            FAILED+=("$fname")
        fi
    else
        log "  – $fname not found, skipping"
        SKIPPED+=("$fname")
    fi
}

# ── Upload zone classifier ────────────────────────────────────────────────────
log "=== Zone Classifier Files ==="
for fname in "${ZONE_FILES[@]}"; do
    upload_file "$fname"
done

# ── Upload tier-2 ONNX (skip in --zone-only mode) ────────────────────────────
if ! $ZONE_ONLY; then
    log ""
    log "=== Tier-2 Hierarchical ONNX Files ==="
    for fname in "${TIER2_ONNX[@]}"; do
        upload_file "$fname"
    done

    # Upload labels JSON
    upload_file "hier_labels.json"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
log ""
log "=== Upload Summary ==="
log "Uploaded (${#UPLOADED[@]}): ${UPLOADED[*]:-none}"
log "Skipped  (${#SKIPPED[@]}): ${SKIPPED[*]:-none}"
log "Failed   (${#FAILED[@]}): ${FAILED[*]:-none}"
log ""

if [ ${#FAILED[@]} -gt 0 ]; then
    log "RESULT: PARTIAL — re-run to retry failed files"
    exit 1
fi

log "RESULT: Upload SUCCESS"
log ""

# ── Redeploy Modal sidecar ────────────────────────────────────────────────────
if $NO_DEPLOY; then
    log "Skipping Modal redeploy (--no-deploy). Run manually:"
    log "  cd /Users/skylar/nuke && modal deploy yono/modal_serve.py"
else
    log "Redeploying Modal sidecar to pick up new models..."
    cd /Users/skylar/nuke
    if modal deploy "$MODAL_SERVE_PY"; then
        log "  ✓ Modal sidecar redeployed"
    else
        log "  ✗ Modal deploy FAILED — check logs above"
        exit 1
    fi
    log ""
    log "Validating sidecar health..."
    sleep 5
    HEALTH=$(curl -s --max-time 30 "$SIDECAR_URL/health" 2>/dev/null || echo "{}")
    log "  Health: $HEALTH"
    ZONE_STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('zone_classifier:', d.get('zone_classifier', 'not reported'))" 2>/dev/null || echo "zone_classifier: parse error")
    log "  $ZONE_STATUS"
fi

log ""
log "Done. Validate tier-2 classification:"
log "  curl -s -X POST $SIDECAR_URL/classify \\"
log "    -H 'Content-Type: application/json' \\"
log "    -d '{\"image_url\": \"<image_url>\"}'"
