#!/bin/bash
# Fast programmatic comment analysis runner
# Processes 50 vehicles per batch, ~25 seconds per batch
# 127K vehicles ÷ 50 = ~2,540 batches ÷ ~2.4/min = ~17.6 hours
set -euo pipefail
cd /Users/skylar/nuke

BATCH_SIZE=50
MIN_COMMENTS=5
MAX_CONSECUTIVE_ZEROS=5
consecutive_zeros=0
total_discovered=0
batch_num=0
start_time=$(date +%s)

echo "=== Fast Comment Analysis Runner ==="
echo "Batch size: $BATCH_SIZE | Min comments: $MIN_COMMENTS"
echo "Started: $(date)"
echo ""

while true; do
  batch_num=$((batch_num + 1))

  # dotenvx leaks a colorized status line to stderr; redirect ALL stderr and strip non-JSON
  result=$(dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/analyze-comments-fast" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"mode\":\"analyze\",\"batch_size\":'"$BATCH_SIZE"',\"min_comments\":'"$MIN_COMMENTS"'}"' 2>/dev/null | sed -n '/^{/,/^}/p')

  discovered=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('discovered',0))" 2>/dev/null || echo "0")
  remaining=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('remaining',0))" 2>/dev/null || echo "?")
  errors=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errors',0))" 2>/dev/null || echo "0")
  elapsed=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('elapsed_ms',0))" 2>/dev/null || echo "0")

  total_discovered=$((total_discovered + discovered))
  now=$(date +%s)
  runtime=$((now - start_time))
  rate=$(python3 -c "print(round($total_discovered / max($runtime, 1) * 60, 1))" 2>/dev/null || echo "?")

  echo "[$(date +%H:%M:%S)] Batch $batch_num: +$discovered ($errors err) | Total: $total_discovered | Remaining: $remaining | ${elapsed}ms | Rate: ${rate}/min"

  # Check for error responses
  error_msg=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d.get('error',''); print(e if e else '')" 2>/dev/null || echo "")
  if [ -n "$error_msg" ] && [ "$error_msg" != "" ]; then
    echo "  ERROR: $error_msg"
  fi

  if [ "$discovered" = "0" ]; then
    consecutive_zeros=$((consecutive_zeros + 1))
    if [ "$consecutive_zeros" -ge "$MAX_CONSECUTIVE_ZEROS" ]; then
      echo ""
      echo "=== COMPLETE: $MAX_CONSECUTIVE_ZEROS consecutive zero batches ==="
      break
    fi
  else
    consecutive_zeros=0
  fi

  if [ "$remaining" = "0" ]; then
    echo ""
    echo "=== COMPLETE: No remaining vehicles ==="
    break
  fi

  # Brief pause between batches
  sleep 1
done

echo "Total discovered: $total_discovered"
echo "Total batches: $batch_num"
echo "Total time: $(($(date +%s) - start_time))s"
echo "Finished: $(date)"
