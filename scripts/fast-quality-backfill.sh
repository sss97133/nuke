#!/usr/bin/env bash
# Fast quality score backfill for vehicles table
# Uses management API (superuser) to bypass triggers
# Processes 10K rows per batch with session_replication_role = 'replica'
#
# Usage: dotenvx run -- bash scripts/fast-quality-backfill.sh
#
# Expected throughput: ~800-1000 rows/sec
# For 826K vehicles: ~15-20 minutes

set -euo pipefail

BATCH_SIZE=10000
TOTAL_PROCESSED=0
BATCH_NUM=0
START_TIME=$(date +%s)

PROJECT_ID="qkgaybvrernstplzjaam"
API_URL="https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query"
TOKEN="${SUPABASE_ACCESS_TOKEN}"

# DNS resolve workaround (local DNS cache sometimes fails)
RESOLVE_MGMT="--resolve api.supabase.com:443:104.20.27.145"
RESOLVE_REST="--resolve qkgaybvrernstplzjaam.supabase.co:443:104.18.38.10"

# Prepare the SQL payload (reused for each batch)
PAYLOAD=$(python3 -c "
import json
sql = '''SET statement_timeout = '120s';
SET session_replication_role = 'replica';
WITH batch AS (
  SELECT id FROM vehicles
  WHERE data_quality_score IS NULL OR data_quality_score = 0
  LIMIT ${BATCH_SIZE}
)
UPDATE vehicles v SET data_quality_score = LEAST(100, GREATEST(0,
  ROUND((
    CASE WHEN v.year IS NOT NULL AND v.year >= 1885 AND v.year <= 2028 THEN 0.20 ELSE 0 END +
    CASE WHEN v.make IS NOT NULL AND trim(v.make) <> '' AND length(trim(v.make)) <= 50 THEN 0.20 ELSE 0 END +
    CASE WHEN v.model IS NOT NULL AND trim(v.model) <> '' THEN
      CASE WHEN length(trim(v.model)) <= 80 THEN 0.20 ELSE 0.05 END
    ELSE 0 END +
    CASE WHEN v.vin IS NOT NULL AND trim(v.vin) <> '' THEN
      CASE WHEN v.year IS NULL OR v.year < 1981 THEN 0.10
           WHEN length(trim(v.vin)) = 17 THEN 0.10
           ELSE 0.02 END
    ELSE 0 END +
    CASE WHEN v.description IS NOT NULL AND length(trim(v.description)) > 30 THEN 0.10 ELSE 0 END +
    CASE WHEN v.mileage IS NOT NULL AND v.mileage >= 0 AND v.mileage < 2000000 THEN 0.05 ELSE 0 END +
    CASE WHEN v.listing_url IS NOT NULL AND trim(v.listing_url) <> '' THEN 0.05 ELSE 0 END +
    CASE WHEN v.sale_price IS NOT NULL AND v.sale_price >= 100 THEN 0.10 ELSE 0 END
  ) * 100)::INTEGER
))
FROM batch WHERE v.id = batch.id;
SET session_replication_role = 'origin';'''
print(json.dumps({'query': sql}))
")

# Count remaining before starting
echo "[$(date +%H:%M:%S)] Starting fast quality score backfill..."
echo "[$(date +%H:%M:%S)] Batch size: ${BATCH_SIZE} rows"

# Check remaining via REST API
REMAINING=$(curl -s ${RESOLVE_REST} -X POST "${VITE_SUPABASE_URL}/rest/v1/rpc/execute_sql" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT count(*) as cnt FROM vehicles WHERE data_quality_score IS NULL OR data_quality_score = 0"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['cnt'])" 2>/dev/null || echo "unknown")

echo "[$(date +%H:%M:%S)] Remaining vehicles to score: ${REMAINING}"
echo "---"

while true; do
  BATCH_NUM=$((BATCH_NUM + 1))
  BATCH_START=$(date +%s)

  RESULT=$(curl -s ${RESOLVE_MGMT} -X POST "${API_URL}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${PAYLOAD}" 2>&1)

  BATCH_END=$(date +%s)
  BATCH_TIME=$((BATCH_END - BATCH_START))

  # Check for errors
  if echo "${RESULT}" | grep -q '"message"'; then
    echo "[$(date +%H:%M:%S)] ERROR in batch ${BATCH_NUM}: ${RESULT}"
    echo "Waiting 5s before retry..."
    sleep 5
    continue
  fi

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + BATCH_SIZE))
  ELAPSED=$((BATCH_END - START_TIME))
  RATE=$((TOTAL_PROCESSED / (ELAPSED > 0 ? ELAPSED : 1)))

  # Estimate remaining
  if [ "${REMAINING}" != "unknown" ] && [ "${RATE}" -gt 0 ]; then
    LEFT=$((REMAINING - TOTAL_PROCESSED))
    if [ "${LEFT}" -le 0 ]; then
      echo "[$(date +%H:%M:%S)] Batch ${BATCH_NUM}: ${BATCH_TIME}s | Total: ${TOTAL_PROCESSED} | COMPLETE!"
      break
    fi
    ETA_SEC=$((LEFT / RATE))
    ETA_MIN=$((ETA_SEC / 60))
    echo "[$(date +%H:%M:%S)] Batch ${BATCH_NUM}: ${BATCH_TIME}s | Total: ${TOTAL_PROCESSED}/${REMAINING} | ${RATE}/s | ETA: ${ETA_MIN}m"
  else
    echo "[$(date +%H:%M:%S)] Batch ${BATCH_NUM}: ${BATCH_TIME}s | Total: ${TOTAL_PROCESSED} | ${RATE}/s"
  fi

  # Brief pause between batches to let DB breathe
  sleep 1
done

FINAL_ELAPSED=$(( $(date +%s) - START_TIME ))
echo "---"
echo "[$(date +%H:%M:%S)] DONE! Processed ~${TOTAL_PROCESSED} rows in $((FINAL_ELAPSED / 60))m $((FINAL_ELAPSED % 60))s"

# Final count check
FINAL_REMAINING=$(curl -s ${RESOLVE_REST} -X POST "${VITE_SUPABASE_URL}/rest/v1/rpc/execute_sql" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT count(*) as cnt FROM vehicles WHERE data_quality_score IS NULL OR data_quality_score = 0"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['cnt'])" 2>/dev/null || echo "unknown")

echo "[$(date +%H:%M:%S)] Remaining after backfill: ${FINAL_REMAINING}"
