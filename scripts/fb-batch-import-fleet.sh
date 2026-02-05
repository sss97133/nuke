#!/bin/bash
#
# FB Marketplace Batch Import Fleet
# Launches multiple batch importers to process marketplace_listings → vehicles
#

set -euo pipefail

cd "$(dirname "$0")/.."

export $(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | xargs)

NUM_WORKERS="${1:-10}"
BATCH_SIZE="${2:-100}"

echo "🚀 FB MARKETPLACE BATCH IMPORT FLEET"
echo "====================================="
echo "Workers: $NUM_WORKERS"
echo "Batch size: $BATCH_SIZE"
echo ""

SUPABASE_URL="${VITE_SUPABASE_URL}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
FUNCTION_URL="${SUPABASE_URL}/functions/v1/import-fb-marketplace"

# Launch workers
for i in $(seq 1 $NUM_WORKERS); do
  echo "🚀 Launching Batch Importer #$i..."

  (
    while true; do
      echo "[Worker $i] Calling import-fb-marketplace with batch_size=$BATCH_SIZE..."

      response=$(curl -sf -X POST "$FUNCTION_URL" \
        -H "Authorization: Bearer $SUPABASE_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"batch_size\": $BATCH_SIZE, \"dry_run\": false}" 2>&1)

      success=$(echo "$response" | jq -r '.success // false' 2>/dev/null)
      imported=$(echo "$response" | jq -r '.imported // 0' 2>/dev/null)

      if [ "$success" = "true" ]; then
        echo "[Worker $i] ✅ Imported $imported vehicles"
      else
        error=$(echo "$response" | jq -r '.error // "Unknown"' 2>/dev/null)
        echo "[Worker $i] ❌ Error: $error"
      fi

      # If no more to import, stop
      if [ "$imported" = "0" ]; then
        echo "[Worker $i] No more listings to import, exiting"
        break
      fi

      # Rate limit between batches
      sleep 3
    done
  ) > "/tmp/fb-importer-$i-$(date +%s).log" 2>&1 &

  WORKER_PID=$!
  echo "  PID: $WORKER_PID"
  echo "  Log: /tmp/fb-importer-$i-*.log"

  # Stagger launches
  sleep 2
done

echo ""
echo "✅ Batch import fleet launched!"
echo ""
echo "Monitor progress:"
echo "  tail -f /tmp/fb-importer-*.log"
echo ""
echo "Check vehicles created:"
echo "  SELECT COUNT(*) FROM vehicles WHERE profile_origin = 'facebook_marketplace' AND created_at > NOW() - INTERVAL '10 minutes';"
