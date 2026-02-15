#!/bin/bash
# Batch discovery runner - fires parallel discover-comment-data calls
# Usage: dotenvx run -- bash scripts/batch-discover.sh

TOTAL_DISCOVERED=0
TOTAL_ERRORS=0
ROUND=0
EMPTY_ROUNDS=0
TMPDIR=$(mktemp -d)

echo "Starting batch comment discovery..."
echo "Writing results to $TMPDIR"

while [ $EMPTY_ROUNDS -lt 3 ]; do
  ROUND=$((ROUND + 1))
  ROUND_DISCOVERED=0
  ROUND_ERRORS=0

  # Fire 10 parallel batches of 3
  for i in $(seq 0 9); do
    offset=$((i * 300 + (ROUND - 1) * 3000))
    curl -s --max-time 300 -X POST "$VITE_SUPABASE_URL/functions/v1/discover-comment-data" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"batch_size\": 3, \"min_comments\": 10, \"source\": \"auction_comments\", \"offset\": $offset}" \
      > "$TMPDIR/result_${ROUND}_${i}.json" 2>/dev/null &
  done
  wait

  # Parse results
  for i in $(seq 0 9); do
    f="$TMPDIR/result_${ROUND}_${i}.json"
    if [ -f "$f" ] && [ -s "$f" ]; then
      d=$(python3 -c "import json,sys; r=json.load(open('$f')); print(r.get('discovered',0))" 2>/dev/null || echo 0)
      e=$(python3 -c "import json,sys; r=json.load(open('$f')); print(r.get('errors',0))" 2>/dev/null || echo 0)
      ROUND_DISCOVERED=$((ROUND_DISCOVERED + d))
      ROUND_ERRORS=$((ROUND_ERRORS + e))
    fi
  done

  TOTAL_DISCOVERED=$((TOTAL_DISCOVERED + ROUND_DISCOVERED))
  TOTAL_ERRORS=$((TOTAL_ERRORS + ROUND_ERRORS))

  if [ $ROUND_DISCOVERED -eq 0 ]; then
    EMPTY_ROUNDS=$((EMPTY_ROUNDS + 1))
  else
    EMPTY_ROUNDS=0
  fi

  echo "Round $ROUND: +$ROUND_DISCOVERED discovered, $ROUND_ERRORS errors | Running total: $TOTAL_DISCOVERED discovered, $TOTAL_ERRORS errors"
done

echo ""
echo "=== COMPLETE ==="
echo "Total rounds: $ROUND"
echo "Total discovered: $TOTAL_DISCOVERED"
echo "Total errors: $TOTAL_ERRORS"

rm -rf "$TMPDIR"
