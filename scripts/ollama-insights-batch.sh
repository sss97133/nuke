#!/bin/bash
# OLLAMA COMMUNITY INSIGHTS BATCH PROCESSOR
# Runs for ~7 hours processing vehicles through local Llama 3.1
# Usage: ./ollama-insights-batch.sh

set -e
cd /Users/skylar/nuke

# Load env
eval "$(dotenvx run -- printenv | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY)=' | sed 's/^/export /')"

# Config
MAX_HOURS=7
MAX_VEHICLES=3000  # ~7 hrs at 8 sec/vehicle
LOG_FILE="/tmp/ollama-insights-$(date +%Y%m%d-%H%M%S).log"
PROGRESS_FILE="/tmp/ollama-insights-progress.json"
MODEL="llama3.1:8b"

echo "=== OLLAMA COMMUNITY INSIGHTS BATCH ===" | tee "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Model: $MODEL" | tee -a "$LOG_FILE"
echo "Max duration: ${MAX_HOURS} hours" | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Warm up ollama
echo "Warming up Ollama..." | tee -a "$LOG_FILE"
ollama run $MODEL "Say OK" > /dev/null 2>&1
echo "Ready!" | tee -a "$LOG_FILE"

START_TIME=$(date +%s)
END_TIME=$((START_TIME + MAX_HOURS * 3600))
PROCESSED=0
ERRORS=0

# Function to get next vehicle needing insights
get_next_vehicle() {
    # Get vehicles with observations but no discoveries yet
    curl -sS "${VITE_SUPABASE_URL}/rest/v1/rpc/get_vehicles_needing_insights" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
        -H "Content-Type: application/json" \
        -d '{"p_limit": 1}' 2>/dev/null || \
    # Fallback: find vehicles with observations not in discoveries
    curl -sS "${VITE_SUPABASE_URL}/rest/v1/vehicle_observations?select=vehicle_id&limit=100" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | \
    jq -r '.[0].vehicle_id // empty'
}

# Function to get observations for a vehicle
get_observations() {
    local vehicle_id=$1
    curl -sS "${VITE_SUPABASE_URL}/rest/v1/vehicle_observations?select=content_text&vehicle_id=eq.${vehicle_id}&content_text=not.is.null&limit=100" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | \
    jq -r '.[].content_text' | head -50
}

# Function to save discovery
save_discovery() {
    local vehicle_id=$1
    local discovery_type=$2
    local raw_json=$3
    local obs_count=$4

    curl -sS "${VITE_SUPABASE_URL}/rest/v1/observation_discoveries" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=minimal" \
        -d "{
            \"vehicle_id\": \"${vehicle_id}\",
            \"discovery_type\": \"${discovery_type}\",
            \"raw_extraction\": ${raw_json},
            \"observation_count\": ${obs_count},
            \"confidence_score\": 0.75,
            \"model_used\": \"${MODEL}\",
            \"prompt_version\": \"ollama-v1\"
        }" 2>/dev/null
}

# Main loop
while [ $(date +%s) -lt $END_TIME ] && [ $PROCESSED -lt $MAX_VEHICLES ]; do
    # Get next vehicle
    VEHICLE_ID=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/vehicle_observations?select=vehicle_id&limit=500" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | \
        jq -r "[.[].vehicle_id] | unique | .[$PROCESSED] // empty")

    if [ -z "$VEHICLE_ID" ]; then
        echo "No more vehicles to process" | tee -a "$LOG_FILE"
        break
    fi

    # Check if already has discovery
    HAS_DISCOVERY=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/observation_discoveries?select=id&vehicle_id=eq.${VEHICLE_ID}&limit=1" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | jq 'length')

    if [ "$HAS_DISCOVERY" -gt 0 ]; then
        PROCESSED=$((PROCESSED + 1))
        continue
    fi

    # Get observations
    OBSERVATIONS=$(get_observations "$VEHICLE_ID")
    OBS_COUNT=$(echo "$OBSERVATIONS" | wc -l | tr -d ' ')

    if [ "$OBS_COUNT" -lt 3 ]; then
        PROCESSED=$((PROCESSED + 1))
        continue
    fi

    echo "[$(date +%H:%M:%S)] Processing $VEHICLE_ID ($OBS_COUNT obs)..." | tee -a "$LOG_FILE"

    VEHICLE_START=$(date +%s.%N)

    # Build prompt
    PROMPT="Analyze the sentiment in these vehicle auction comments. Return ONLY valid JSON.

Comments:
${OBSERVATIONS}

Return this exact JSON structure (no other text):
{\"overall_sentiment\":\"positive\",\"sentiment_score\":0.5,\"themes\":[{\"theme\":\"example\",\"frequency\":1,\"sentiment\":\"positive\"}],\"notable_quotes\":[],\"red_flags\":[],\"highlights\":[],\"confidence\":0.8}"

    # Run through Ollama
    RESULT=$(ollama run $MODEL "$PROMPT" 2>/dev/null | tr -d '\n' | grep -o '{.*}' | head -1)

    if [ -n "$RESULT" ] && echo "$RESULT" | jq . > /dev/null 2>&1; then
        # Save sentiment discovery
        save_discovery "$VEHICLE_ID" "sentiment" "$RESULT" "$OBS_COUNT"

        VEHICLE_END=$(date +%s.%N)
        DURATION=$(echo "$VEHICLE_END - $VEHICLE_START" | bc)

        SENTIMENT=$(echo "$RESULT" | jq -r '.overall_sentiment // "unknown"')
        echo "  -> $SENTIMENT (${DURATION}s)" | tee -a "$LOG_FILE"

        PROCESSED=$((PROCESSED + 1))
    else
        echo "  -> ERROR: Invalid JSON" | tee -a "$LOG_FILE"
        ERRORS=$((ERRORS + 1))
    fi

    # Progress update
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ $ELAPSED -gt 0 ]; then
        RATE=$(echo "scale=1; $PROCESSED * 3600 / $ELAPSED" | bc 2>/dev/null || echo "0")
    else
        RATE="0"
    fi
    echo "{\"processed\": $PROCESSED, \"errors\": $ERRORS, \"elapsed_min\": $((ELAPSED / 60)), \"rate_per_hour\": $RATE}" > "$PROGRESS_FILE"

    # Small delay to prevent overheating
    sleep 0.5
done

# Final stats
TOTAL_TIME=$(($(date +%s) - START_TIME))
echo "" | tee -a "$LOG_FILE"
echo "=== COMPLETED ===" | tee -a "$LOG_FILE"
echo "Processed: $PROCESSED vehicles" | tee -a "$LOG_FILE"
echo "Errors: $ERRORS" | tee -a "$LOG_FILE"
echo "Duration: $((TOTAL_TIME / 60)) minutes" | tee -a "$LOG_FILE"
echo "Rate: $(echo "scale=1; $PROCESSED / ($TOTAL_TIME / 3600)" | bc) vehicles/hour" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
