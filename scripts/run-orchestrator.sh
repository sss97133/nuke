#!/bin/bash
# Orchestrator: periodically aggregates sentiment and checks pipeline health
# Runs aggregate-sentiment batch + market_trends every INTERVAL seconds

set -uo pipefail
cd /Users/skylar/nuke

INTERVAL=${1:-300}  # Default 5 minutes
MAX_CYCLES=${2:-100}
LOG_FILE="/Users/skylar/nuke/logs/orchestrator-$(date +%Y%m%d-%H%M%S).log"

mkdir -p /Users/skylar/nuke/logs

# Load env vars
eval "$(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' 2>/dev/null)"

if [ -z "${VITE_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "ERROR: Could not load env vars" | tee "$LOG_FILE"
  exit 1
fi

echo "=== Orchestrator ===" | tee "$LOG_FILE"
echo "Interval: ${INTERVAL}s | Max cycles: $MAX_CYCLES" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "---" | tee -a "$LOG_FILE"

for (( i=1; i<=MAX_CYCLES; i++ )); do
  echo "" | tee -a "$LOG_FILE"
  echo "[$i/$MAX_CYCLES] $(date '+%H:%M:%S')" | tee -a "$LOG_FILE"

  # 1. Get current counts
  COUNTS=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -F'|' -c "
    SELECT
      (SELECT count(*) FROM comment_discoveries) as cd,
      (SELECT count(*) FROM vehicle_sentiment) as vs,
      (SELECT count(*) FROM vehicle_condition_assessments) as ca,
      (SELECT count(*) FROM component_conditions) as cc,
      (SELECT count(*) FROM market_trends) as mt;
  " 2>/dev/null)

  IFS='|' read -r CD VS CA CC MT <<< "$COUNTS"
  echo "  Discoveries: $CD | Sentiment: $VS | Conditions: $CA | Components: $CC | Trends: $MT" | tee -a "$LOG_FILE"

  # 2. Run aggregate-sentiment if discoveries > sentiment
  GAP=$((CD - VS))
  if [ "$GAP" -gt 0 ]; then
    echo "  Aggregating $GAP new discoveries..." | tee -a "$LOG_FILE"
    RESULT=$(curl -s -m 120 -X POST "$VITE_SUPABASE_URL/functions/v1/aggregate-sentiment" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d '{"mode": "batch", "batch_size": 200}' 2>/dev/null)

    PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))" 2>/dev/null || echo "ERR")
    echo "  Sentiment batch: processed=$PROCESSED" | tee -a "$LOG_FILE"
  fi

  # 3. Run market trends every 3rd cycle
  if [ $((i % 3)) -eq 0 ]; then
    echo "  Refreshing market trends..." | tee -a "$LOG_FILE"
    MRESULT=$(curl -s -m 120 -X POST "$VITE_SUPABASE_URL/functions/v1/aggregate-sentiment" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d '{"mode": "market_trends"}' 2>/dev/null)

    MAKES=$(echo "$MRESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('makes_aggregated',0))" 2>/dev/null || echo "ERR")
    echo "  Market trends: $MAKES makes" | tee -a "$LOG_FILE"
  fi

  # 4. Sleep
  sleep "$INTERVAL"
done

echo "---" | tee -a "$LOG_FILE"
echo "=== ORCHESTRATOR COMPLETE ===" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
