#!/bin/bash
# OLLAMA COMMUNITY INSIGHTS v5

cd /Users/skylar/nuke

# Load env directly from .env file
export $(grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY)=' .env | xargs)

LOG="/tmp/ollama-insights-$(date +%Y%m%d-%H%M%S).log"
PROG="/tmp/ollama-insights-progress.json"
MODEL="llama3.1:8b"
MAX_HRS=7

echo "=== OLLAMA INSIGHTS v5 ===" | tee "$LOG"
echo "Started: $(date)" | tee -a "$LOG"
echo "URL: ${VITE_SUPABASE_URL:0:30}..." | tee -a "$LOG"

# Warmup
ollama run $MODEL "OK" >/dev/null 2>&1
echo "Ollama ready" | tee -a "$LOG"

START=$(date +%s)
END=$((START + MAX_HRS * 3600))
OK=0; ERR=0; SKIP=0

# Get vehicles
echo "Fetching vehicles..." | tee -a "$LOG"
VEHICLES=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/bat_listings?select=vehicle_id&comment_count=gt.10&order=comment_count.desc&limit=3000" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" | jq -r '.[].vehicle_id' 2>/dev/null)

TOTAL=$(echo "$VEHICLES" | grep -c . || echo 0)
echo "Found $TOTAL vehicles" | tee -a "$LOG"

[ "$TOTAL" -lt 10 ] && { echo "ERROR: Too few vehicles, check env" | tee -a "$LOG"; exit 1; }

for VID in $VEHICLES; do
    [ -z "$VID" ] && continue
    [ $(date +%s) -ge $END ] && break

    # Skip existing
    HAS=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/observation_discoveries?select=id&vehicle_id=eq.${VID}&discovery_type=eq.sentiment&limit=1" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | jq 'length' 2>/dev/null || echo 0)

    [ "$HAS" -gt 0 ] && { SKIP=$((SKIP+1)); continue; }

    # Get comments
    COMMENTS=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/auction_comments?select=comment_text&vehicle_id=eq.${VID}&limit=60" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | jq -r '.[].comment_text' 2>/dev/null | head -40)

    CNT=$(echo "$COMMENTS" | grep -c . || echo 0)
    [ "$CNT" -lt 5 ] && { SKIP=$((SKIP+1)); continue; }

    echo -n "[$(date +%H:%M:%S)] #$((OK+1)) ($CNT) " | tee -a "$LOG"
    T0=$(date +%s)

    PROMPT="Analyze sentiment. JSON only: {\"overall_sentiment\":\"positive\",\"sentiment_score\":0.5,\"themes\":[],\"red_flags\":[],\"highlights\":[],\"confidence\":0.8}

$COMMENTS"

    RESULT=$(timeout 60 ollama run $MODEL "$PROMPT" 2>/dev/null | tr '\n' ' ' | grep -oE '\{[^}]+\}' | head -1)
    DUR=$(($(date +%s) - T0))

    if [ -n "$RESULT" ] && echo "$RESULT" | jq . >/dev/null 2>&1; then
        curl -sS "${VITE_SUPABASE_URL}/rest/v1/observation_discoveries" \
            -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
            -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"vehicle_id\":\"${VID}\",\"discovery_type\":\"sentiment\",\"raw_extraction\":${RESULT},\"observation_count\":${CNT},\"model_used\":\"${MODEL}\"}" >/dev/null 2>&1

        SENT=$(echo "$RESULT" | jq -r '.overall_sentiment' 2>/dev/null)
        echo "$SENT ${DUR}s" | tee -a "$LOG"
        OK=$((OK+1))
    else
        echo "ERR" | tee -a "$LOG"
        ERR=$((ERR+1))
    fi

    EL=$(($(date +%s) - START))
    [ $EL -gt 0 ] && RT=$((OK * 3600 / EL)) || RT=0
    echo "{\"ok\":$OK,\"skip\":$SKIP,\"err\":$ERR,\"min\":$((EL/60)),\"rate\":$RT,\"total\":$TOTAL}" > "$PROG"
done

echo "" | tee -a "$LOG"
echo "=== DONE: $OK ok, $SKIP skip, $ERR err ===" | tee -a "$LOG"
