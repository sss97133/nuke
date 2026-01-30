#!/bin/bash
# OLLAMA COMMUNITY INSIGHTS v5

cd /Users/skylar/nuke

# Load env directly from .env file
export $(grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY)=' .env | xargs)

LOG="/tmp/ollama-insights-$(date +%Y%m%d-%H%M%S).log"
PROG="/tmp/ollama-insights-progress.json"
MODEL="llama3.1:8b"
MAX_HRS=4

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

    # Use Ollama API with JSON mode for clean output
    SYSPROMPT="You analyze auction comment sentiment. Return ONLY valid JSON with these exact keys: overall_sentiment (positive/negative/neutral), sentiment_score (0-1), themes (array of strings), red_flags (array of strings), highlights (array of strings), confidence (0-1). No markdown, no explanation."

    USERPROMPT="Analyze these comments:
$COMMENTS"

    # Use chat endpoint with JSON format
    PAYLOAD=$(jq -nc \
        --arg model "$MODEL" \
        --arg sys "$SYSPROMPT" \
        --arg user "$USERPROMPT" \
        '{model:$model, messages:[{role:"system",content:$sys},{role:"user",content:$user}], stream:false, format:"json"}')

    RAW=$(curl -s -m 90 http://localhost:11434/api/chat -d "$PAYLOAD" 2>/dev/null \
        | jq -r '.message.content // empty' 2>/dev/null)

    # Parse and normalize the result
    RESULT=$(echo "$RAW" | jq -c '{
        overall_sentiment: (.overall_sentiment // "neutral"),
        sentiment_score: (.sentiment_score // 0.5),
        themes: ([.themes[]? | if type == "string" then . else .text // . end] // []),
        red_flags: ([.red_flags[]? | if type == "string" then . else .text // . end] // []),
        highlights: ([.highlights[]? | if type == "string" then . else .text // . end] // []),
        confidence: (.confidence // 0.5)
    }' 2>/dev/null)
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

# ============================================
# QUALITY INSPECTION
# ============================================
echo "" | tee -a "$LOG"
echo "=== QUALITY INSPECTION ===" | tee -a "$LOG"

QA_REPORT="/tmp/ollama-insights-qa-$(date +%Y%m%d-%H%M%S).json"

# Sample recent discoveries from this run
SAMPLES=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/observation_discoveries?select=id,vehicle_id,raw_extraction,observation_count&discovery_type=eq.sentiment&model_used=eq.${MODEL}&order=discovered_at.desc&limit=50" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null)

# Quality checks
TOTAL_SAMPLES=$(echo "$SAMPLES" | jq 'length')
EMPTY_THEMES=$(echo "$SAMPLES" | jq '[.[] | select((.raw_extraction.themes | length) == 0)] | length')
EMPTY_FLAGS=$(echo "$SAMPLES" | jq '[.[] | select((.raw_extraction.red_flags | length) == 0)] | length')
EMPTY_HIGHLIGHTS=$(echo "$SAMPLES" | jq '[.[] | select((.raw_extraction.highlights | length) == 0)] | length')

# Check for vague/garbage red flags
VAGUE_PATTERNS='unreliable|bad car|issues|problems$|concerns$'
VAGUE_FLAGS=$(echo "$SAMPLES" | jq --arg pat "$VAGUE_PATTERNS" '[.[] | .raw_extraction.red_flags[]? | select(. | test($pat; "i"))] | length')

# Check for all-caps (formatting issue)
ALLCAPS_COUNT=$(echo "$SAMPLES" | jq '[.[] | .raw_extraction | (.themes[]?, .red_flags[]?, .highlights[]?) | select(. == (. | ascii_upcase))] | length')

# Sentiment distribution
POS=$(echo "$SAMPLES" | jq '[.[] | select(.raw_extraction.overall_sentiment == "positive")] | length')
NEG=$(echo "$SAMPLES" | jq '[.[] | select(.raw_extraction.overall_sentiment == "negative")] | length')
NEU=$(echo "$SAMPLES" | jq '[.[] | select(.raw_extraction.overall_sentiment == "neutral")] | length')

# Avg confidence
AVG_CONF=$(echo "$SAMPLES" | jq '[.[].raw_extraction.confidence] | add / length * 100 | floor')

# Generate report
cat > "$QA_REPORT" << QAJSON
{
  "timestamp": "$(date -Iseconds)",
  "batch_stats": {
    "ok": $OK,
    "skip": $SKIP,
    "err": $ERR,
    "runtime_min": $((EL/60))
  },
  "sample_size": $TOTAL_SAMPLES,
  "quality_scores": {
    "empty_themes_pct": $(echo "scale=1; $EMPTY_THEMES * 100 / $TOTAL_SAMPLES" | bc),
    "empty_red_flags_pct": $(echo "scale=1; $EMPTY_FLAGS * 100 / $TOTAL_SAMPLES" | bc),
    "empty_highlights_pct": $(echo "scale=1; $EMPTY_HIGHLIGHTS * 100 / $TOTAL_SAMPLES" | bc),
    "vague_red_flags": $VAGUE_FLAGS,
    "allcaps_items": $ALLCAPS_COUNT,
    "avg_confidence": $AVG_CONF
  },
  "sentiment_distribution": {
    "positive": $POS,
    "negative": $NEG,
    "neutral": $NEU
  },
  "issues": [
    $([ "$VAGUE_FLAGS" -gt 5 ] && echo '"High vague red flag count",' || echo "")
    $([ "$ALLCAPS_COUNT" -gt 10 ] && echo '"Formatting issues (all caps)",' || echo "")
    $([ "$EMPTY_THEMES" -gt $((TOTAL_SAMPLES / 2)) ] && echo '"Too many empty themes",' || echo "")
    "none"
  ]
}
QAJSON

echo "QA Report: $QA_REPORT" | tee -a "$LOG"
cat "$QA_REPORT" | jq -c '.' | tee -a "$LOG"

# Summary
echo "" | tee -a "$LOG"
echo "Quality: ${AVG_CONF}% avg confidence, ${VAGUE_FLAGS} vague flags, ${ALLCAPS_COUNT} allcaps" | tee -a "$LOG"
