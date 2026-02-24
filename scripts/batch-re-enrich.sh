#!/usr/bin/env bash
# Batch re-enrichment script for vehicle extractors.
# Usage: dotenvx run -- bash scripts/batch-re-enrich.sh <platform> [batch_size] [concurrency] [max_batches]
#
# Examples:
#   dotenvx run -- bash scripts/batch-re-enrich.sh mecum 50 5 100
#   dotenvx run -- bash scripts/batch-re-enrich.sh barrett-jackson 25 3 50

set -euo pipefail

PLATFORM="${1:?Usage: batch-re-enrich.sh <platform> [batch_size] [concurrency] [max_batches]}"
BATCH_SIZE="${2:-50}"
CONCURRENCY="${3:-5}"
MAX_BATCHES="${4:-100}"
SUPABASE_URL="${VITE_SUPABASE_URL:?Missing VITE_SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Missing SUPABASE_SERVICE_ROLE_KEY}"

# Map platform to edge function name
case "$PLATFORM" in
  mecum)        FUNC="extract-mecum" ;;
  barrett-jackson|bj) FUNC="extract-barrett-jackson" ;;
  bonhams)      FUNC="extract-bonhams" ;;
  gooding)      FUNC="extract-gooding" ;;
  *)            echo "Unknown platform: $PLATFORM"; exit 1 ;;
esac

echo "=== Batch Re-Enrichment: $PLATFORM ==="
echo "Function: $FUNC | Batch: $BATCH_SIZE | Concurrency: $CONCURRENCY | Max batches: $MAX_BATCHES"
echo ""

TOTAL_SUCCESS=0
TOTAL_FAILED=0
TOTAL_FIELDS=0
BATCH_NUM=0
CONSECUTIVE_ZEROS=0

while [ "$BATCH_NUM" -lt "$MAX_BATCHES" ]; do
  BATCH_NUM=$((BATCH_NUM + 1))

  RESULT=$(curl -s -X POST "$SUPABASE_URL/functions/v1/$FUNC" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"action\": \"re_enrich\", \"limit\": $BATCH_SIZE, \"concurrency\": $CONCURRENCY}" \
    --max-time 300 2>/dev/null || echo '{"success": false, "error": "timeout"}')

  SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success',0))" 2>/dev/null || echo "0")
  FAILED=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('failed',0))" 2>/dev/null || echo "0")
  FIELDS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('fields_added',0))" 2>/dev/null || echo "0")
  TOTAL_VAL=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null || echo "0")
  MSG=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message',''))" 2>/dev/null || echo "")

  # Check if explicitly no candidates remain (message from the extractor)
  if echo "$MSG" | grep -qi "no.*candidates"; then
    echo "[batch $BATCH_NUM] No more candidates. Done!"
    break
  fi

  # Transient error (timeout, bad response) — count as zero but don't stop immediately
  if [ "$TOTAL_VAL" = "0" ] && [ -z "$MSG" ]; then
    CONSECUTIVE_ZEROS=$((CONSECUTIVE_ZEROS + 1))
    echo "[batch $BATCH_NUM] Empty response (transient error?) | $CONSECUTIVE_ZEROS consecutive"
    if [ "$CONSECUTIVE_ZEROS" -ge 5 ]; then
      echo "5 consecutive empty responses. Stopping."
      break
    fi
    sleep 5
    continue
  fi

  TOTAL_SUCCESS=$((TOTAL_SUCCESS + SUCCESS))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
  TOTAL_FIELDS=$((TOTAL_FIELDS + FIELDS))

  echo "[batch $BATCH_NUM] $SUCCESS/$TOTAL_VAL success | $FIELDS fields added | running total: $TOTAL_SUCCESS success, $TOTAL_FAILED failed, $TOTAL_FIELDS fields"

  # Stop if 5 consecutive batches have 0 successes (more resilient)
  if [ "$SUCCESS" = "0" ]; then
    CONSECUTIVE_ZEROS=$((CONSECUTIVE_ZEROS + 1))
    if [ "$CONSECUTIVE_ZEROS" -ge 5 ]; then
      echo "5 consecutive zero-success batches. Stopping."
      break
    fi
  else
    CONSECUTIVE_ZEROS=0
  fi

  # Brief delay between batches to avoid overwhelming the edge function
  sleep 2
done

echo ""
echo "=== Complete ==="
echo "Batches: $BATCH_NUM | Success: $TOTAL_SUCCESS | Failed: $TOTAL_FAILED | Fields added: $TOTAL_FIELDS"
