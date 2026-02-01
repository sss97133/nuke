#!/bin/bash
# Comment Sentiment Backfill
# Runs discover-comment-data in batches until complete or time limit

cd /Users/skylar/nuke
LOG_FILE="/Users/skylar/nuke/logs/sentiment-backfill-$(date +%Y%m%d-%H%M%S).log"
mkdir -p /Users/skylar/nuke/logs

echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "  COMMENT SENTIMENT BACKFILL" | tee -a "$LOG_FILE"
echo "  Started: $(date)" | tee -a "$LOG_FILE"
echo "  Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"

START_TIME=$(date +%s)
MAX_RUNTIME=$((10 * 60 * 60))  # 10 hours
BATCH_SIZE=5
SLEEP_BETWEEN=5
RETRY_DELAY=60

total_discovered=0
total_errors=0
batch_num=0

while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ $ELAPSED -ge $MAX_RUNTIME ]; then
        echo "" | tee -a "$LOG_FILE"
        echo "TIME LIMIT REACHED (10 hours)" | tee -a "$LOG_FILE"
        break
    fi

    batch_num=$((batch_num + 1))

    # Run batch using dotenvx
    RESULT=$(dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/discover-comment-data\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"batch_size\": $BATCH_SIZE}'" 2>&1 | grep -v "dotenvx")

    # Parse results
    discovered=$(echo "$RESULT" | jq -r '.discovered // 0' 2>/dev/null)
    errors=$(echo "$RESULT" | jq -r '.errors // 0' 2>/dev/null)

    if [ "$discovered" != "null" ] && [ "$discovered" != "" ] && [ "$discovered" != "0" ]; then
        total_discovered=$((total_discovered + discovered))
        total_errors=$((total_errors + errors))

        # Log every 10 batches or if errors
        if [ $((batch_num % 10)) -eq 0 ] || [ "$errors" -gt 0 ]; then
            echo "[$(date +%H:%M:%S)] Batch #$batch_num: +$discovered discovered, $errors errors (total: $total_discovered)" | tee -a "$LOG_FILE"
        fi
    elif [ "$discovered" = "0" ] && [ "$errors" = "0" ]; then
        echo "" | tee -a "$LOG_FILE"
        echo "NO MORE VEHICLES TO PROCESS" | tee -a "$LOG_FILE"
        break
    else
        echo "[$(date +%H:%M:%S)] Batch #$batch_num: API issue, retrying... (result: ${RESULT:0:100})" | tee -a "$LOG_FILE"
        sleep $RETRY_DELAY
        continue
    fi

    sleep $SLEEP_BETWEEN
done

echo "" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "  COMPLETE" | tee -a "$LOG_FILE"
echo "  Total discovered: $total_discovered" | tee -a "$LOG_FILE"
echo "  Total errors: $total_errors" | tee -a "$LOG_FILE"
echo "  Batches run: $batch_num" | tee -a "$LOG_FILE"
echo "  Runtime: $((ELAPSED / 60)) minutes" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
