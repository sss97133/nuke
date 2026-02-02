#!/bin/bash
# Run a finite "finish up" pass on major extraction targets (BaT, Craigslist, Classic.com).
# Uses process-import-queue. Cautious but consistent: configurable batch size and rounds.
#
# Usage:
#   ./scripts/run-major-extraction.sh              # defaults: 20 per batch, 50 rounds, 15s pause
#   BATCH=10 MAX_BATCHES=100 ./scripts/run-major-extraction.sh
#
# Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (e.g. from .env)

set -e
cd "$(dirname "$0")/.."
source .env 2>/dev/null || true

BATCH=${BATCH:-20}
MAX_BATCHES=${MAX_BATCHES:-50}
PAUSE_SEC=${PAUSE_SEC:-15}

echo "═══════════════════════════════════════════════════════════"
echo "  MAJOR EXTRACTION (targets: BaT, Craigslist, Classic.com)"
echo "═══════════════════════════════════════════════════════════"
echo "  Batch size: $BATCH"
echo "  Max rounds: $MAX_BATCHES"
echo "  Pause between rounds: ${PAUSE_SEC}s"
echo "═══════════════════════════════════════════════════════════"
echo ""

for i in $(seq 1 $MAX_BATCHES); do
  echo "[$(date +%H:%M:%S)] Round $i/$MAX_BATCHES"
  curl -s -X POST "${VITE_SUPABASE_URL}/functions/v1/process-import-queue" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": $BATCH}" || true
  echo ""
  if [[ $i -lt $MAX_BATCHES ]]; then
    sleep "$PAUSE_SEC"
  fi
done

echo ""
echo "Done. Check import_queue status or run again to continue."
