#!/bin/bash
set -euo pipefail
cd /Users/skylar/nuke
total_synced=0
batch_num=0
start_time=$(date +%s)
echo "=== Sentiment Sync Runner ==="
echo "Started: $(date)"
while true; do
  batch_num=$((batch_num + 1))
  result=$(dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/aggregate-sentiment" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"mode\":\"batch\",\"batch_size\":500}"' 2>/dev/null | sed -n '/^{/,/^}/p')
  processed=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('processed',0))" 2>/dev/null || echo "0")
  remaining=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('remaining',0))" 2>/dev/null || echo "?")
  total_synced=$((total_synced + processed))
  echo "[$(date +%H:%M:%S)] Batch $batch_num: +$processed synced | Total: $total_synced | Remaining: $remaining"
  if [ "$processed" = "0" ]; then
    echo "=== COMPLETE ==="
    break
  fi
  sleep 1
done
echo "Total synced: $total_synced in $(($(date +%s) - start_time))s"
