#!/bin/bash
# Overnight BaT Profile Scraper
# Runs for up to 10 hours, handles errors, logs everything

cd /Users/skylar/nuke
LOG_FILE="/Users/skylar/nuke/logs/profile-scrape-$(date +%Y%m%d-%H%M%S).log"
mkdir -p /Users/skylar/nuke/logs

echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "  OVERNIGHT BAT PROFILE SCRAPER" | tee -a "$LOG_FILE"
echo "  Started: $(date)" | tee -a "$LOG_FILE"
echo "  Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"

START_TIME=$(date +%s)
MAX_RUNTIME=$((10 * 60 * 60))  # 10 hours in seconds
BATCH_SIZE=50
SLEEP_BETWEEN_BATCHES=30
RETRY_DELAY=120
MAX_RETRIES=5

total_found=0
total_updated=0
batch_num=0

while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ $ELAPSED -ge $MAX_RUNTIME ]; then
        echo "" | tee -a "$LOG_FILE"
        echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
        echo "  TIME LIMIT REACHED (10 hours)" | tee -a "$LOG_FILE"
        echo "  Total sellers found: $total_found" | tee -a "$LOG_FILE"
        echo "  Total events updated: $total_updated" | tee -a "$LOG_FILE"
        echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
        break
    fi

    batch_num=$((batch_num + 1))
    echo "" | tee -a "$LOG_FILE"
    echo "[$(date +%H:%M:%S)] Batch #$batch_num (elapsed: $((ELAPSED/60))m)" | tee -a "$LOG_FILE"

    # Check how many sellers still need location
    REMAINING=$(dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/auction_events?seller_location=is.null&seller_name=not.is.null&select=seller_name&limit=5000" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" 2>/dev/null | jq -r ".[].seller_name" | sort -u | wc -l' 2>/dev/null | tr -d ' ')

    echo "  Sellers remaining: $REMAINING" | tee -a "$LOG_FILE"

    if [ "$REMAINING" -eq 0 ] || [ "$REMAINING" -lt 5 ]; then
        echo "" | tee -a "$LOG_FILE"
        echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
        echo "  ALL SELLERS PROCESSED!" | tee -a "$LOG_FILE"
        echo "  Total sellers found: $total_found" | tee -a "$LOG_FILE"
        echo "  Total events updated: $total_updated" | tee -a "$LOG_FILE"
        echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
        break
    fi

    # Run the scraper with retries
    retries=0
    while [ $retries -lt $MAX_RETRIES ]; do
        OUTPUT=$(dotenvx run -- node scripts/contacts/scrape-bat-profiles.js $BATCH_SIZE 2>&1)
        EXIT_CODE=$?

        echo "$OUTPUT" >> "$LOG_FILE"

        if [ $EXIT_CODE -eq 0 ]; then
            # Extract stats from output
            found=$(echo "$OUTPUT" | grep "Sellers with location found:" | awk '{print $NF}')
            updated=$(echo "$OUTPUT" | grep "Total events updated:" | awk '{print $NF}')

            if [ -n "$found" ]; then
                total_found=$((total_found + found))
                total_updated=$((total_updated + updated))
                echo "  Found: $found sellers, Updated: $updated events (cumulative: $total_found found, $total_updated updated)" | tee -a "$LOG_FILE"
            fi
            break
        else
            retries=$((retries + 1))
            echo "  ERROR: Batch failed (attempt $retries/$MAX_RETRIES). Waiting ${RETRY_DELAY}s..." | tee -a "$LOG_FILE"
            sleep $RETRY_DELAY
        fi
    done

    if [ $retries -ge $MAX_RETRIES ]; then
        echo "  Max retries reached. Continuing to next batch after longer wait..." | tee -a "$LOG_FILE"
        sleep 300  # 5 minute cooldown
    else
        echo "  Sleeping ${SLEEP_BETWEEN_BATCHES}s before next batch..." | tee -a "$LOG_FILE"
        sleep $SLEEP_BETWEEN_BATCHES
    fi
done

# Final stats
echo "" | tee -a "$LOG_FILE"
echo "Completed: $(date)" | tee -a "$LOG_FILE"

# Get final coverage
dotenvx run -- bash -c '
echo ""
echo "FINAL COVERAGE:"
WITH_LOC=$(curl -s "$VITE_SUPABASE_URL/rest/v1/auction_events?seller_location=not.is.null&select=id" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r")
WITHOUT_LOC=$(curl -s "$VITE_SUPABASE_URL/rest/v1/auction_events?seller_location=is.null&select=id" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r")
TOTAL=$((WITH_LOC + WITHOUT_LOC))
PCT=$(echo "scale=1; $WITH_LOC * 100 / $TOTAL" | bc)
echo "  Events with location: $WITH_LOC / $TOTAL ($PCT%)"
' 2>&1 | tee -a "$LOG_FILE"
