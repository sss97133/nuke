#!/bin/bash
# ============================================
# INSIGHT ASSEMBLY LINE
# Dumb steps, smart orchestration, continuous learning
# ============================================

cd /Users/skylar/nuke
export $(grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY)=' .env | xargs)

LOG="/tmp/assembly-line-$(date +%Y%m%d-%H%M%S).log"
METRICS="/tmp/assembly-metrics.json"
MODEL="llama3.1:8b"
BATCH_SIZE=20
RUN_HOURS=${1:-2}

echo "=== INSIGHT ASSEMBLY LINE ===" | tee "$LOG"
echo "Started: $(date)" | tee -a "$LOG"
echo "Run time: ${RUN_HOURS}hrs" | tee -a "$LOG"

START=$(date +%s)
END=$((START + RUN_HOURS * 3600))

# Counters
PROCESSED=0
STEP1_OK=0
STEP2_OK=0
STEP3_OK=0
STEP4_OK=0
GARBAGE_FILTERED=0

# ============================================
# ASSEMBLY STEPS (each one is DUMB and SIMPLE)
# ============================================

step1_extract_mentions() {
    # DUMB: Just find things that look like parts/issues/features
    local comments="$1"

    local prompt="List every car part, issue, or feature mentioned. NO NUMBERS, just the items in these comments.
One per line. No explanation. No sentences. Just the things.
Example output:
power steering
rust on fenders
matching numbers

Comments:
$comments"

    curl -s -m 60 http://localhost:11434/api/generate \
        -d "$(jq -nc --arg model "$MODEL" --arg prompt "$prompt" '{model:$model,prompt:$prompt,stream:false}')" \
        | jq -r '.response' 2>/dev/null
}

step2_classify_sentiment() {
    # DUMB: For each mention, is it positive, negative, or neutral?
    local mentions="$1"

    local prompt="Classify each line as positive, negative, or neutral.
Format: thing|sentiment
No explanation.

Example:
matching numbers|positive
rust on fenders|negative
power steering|neutral

Items:
$mentions"

    curl -s -m 60 http://localhost:11434/api/generate \
        -d "$(jq -nc --arg model "$MODEL" --arg prompt "$prompt" '{model:$model,prompt:$prompt,stream:false}')" \
        | jq -r '.response' 2>/dev/null
}

step3_lookup_known_issues() {
    # DUMB: Just database lookup, no AI
    local make="$1"
    local model="$2"
    local year="$3"

    curl -sS "${VITE_SUPABASE_URL}/rest/v1/vehicle_known_issues?select=issue_slug,common_names,severity,typical_cost_min,typical_cost_max&make=ilike.${make}&or=(model.is.null,model.ilike.${model})" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null
}

step4_match_to_known() {
    # DUMB: String matching, no AI
    local classified="$1"
    local known_issues="$2"

    local output="[]"

    while IFS='|' read -r item sentiment; do
        [ -z "$item" ] && continue
        item_lower=$(echo "$item" | tr '[:upper:]' '[:lower:]' | xargs)

        # Check if matches known issue
        match=$(echo "$known_issues" | jq -r --arg item "$item_lower" '
            .[] | select(
                (.issue_slug | contains($item)) or
                (.common_names[]? | ascii_downcase | contains($item))
            ) | .issue_slug' | head -1)

        if [ -n "$match" ]; then
            cost=$(echo "$known_issues" | jq -r --arg slug "$match" '.[] | select(.issue_slug == $slug) | "\(.typical_cost_min/100)-\(.typical_cost_max/100)"')
            output=$(echo "$output" | jq --arg item "$item" --arg sent "$sentiment" --arg match "$match" --arg cost "$cost" \
                '. + [{item: $item, sentiment: $sent, known_issue: $match, cost_estimate: $cost}]')
        else
            output=$(echo "$output" | jq --arg item "$item" --arg sent "$sentiment" \
                '. + [{item: $item, sentiment: $sent, known_issue: null, cost_estimate: null}]')
        fi
    done <<< "$classified"

    echo "$output"
}

step5_filter_garbage() {
    # DUMB: Remove obvious junk
    local insights="$1"

    # Garbage patterns
    local garbage_patterns="beautiful car|great investment|amazing|wonderful|nice|good luck|glws|glwts|bump|following|watching|interested"

    echo "$insights" | jq --arg patterns "$garbage_patterns" '
        [.[] | select((.item | ascii_downcase | test($patterns)) | not)]
    '
}

step6_format_output() {
    # DUMB: Structure for storage
    local filtered="$1"

    local concerns=$(echo "$filtered" | jq '[.[] | select(.sentiment == "negative")]')
    local highlights=$(echo "$filtered" | jq '[.[] | select(.sentiment == "positive")]')
    local themes=$(echo "$filtered" | jq '[.[].item] | unique')

    jq -nc \
        --argjson concerns "$concerns" \
        --argjson highlights "$highlights" \
        --argjson themes "$themes" \
        '{
            overall_sentiment: (if ($concerns | length) > ($highlights | length) then "negative" elif ($highlights | length) > ($concerns | length) then "positive" else "neutral" end),
            sentiment_score: ((($highlights | length) - ($concerns | length) + 5) / 10),
            themes: $themes,
            red_flags: [$concerns[].item],
            red_flags_enriched: $concerns,
            highlights: [$highlights[].item],
            highlights_enriched: $highlights,
            confidence: 0.7
        }'
}

measure_quality() {
    # Track metrics for continuous improvement
    local result="$1"
    local vehicle_id="$2"

    local total=$(echo "$result" | jq '[.red_flags_enriched[]?, .highlights_enriched[]?] | length')
    local matched=$(echo "$result" | jq '[.red_flags_enriched[]?, .highlights_enriched[]? | select(.known_issue != null)] | length')
    local specific=$(echo "$result" | jq '[.red_flags[]?, .highlights[]? | select(length > 15)] | length')

    echo "{\"vehicle_id\":\"$vehicle_id\",\"total_insights\":$total,\"known_issue_matches\":$matched,\"specific_items\":$specific,\"timestamp\":\"$(date -Iseconds)\"}"
}

# ============================================
# MAIN LOOP
# ============================================

echo "Fetching vehicles..." | tee -a "$LOG"
VEHICLES=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/bat_listings?select=vehicle_id&comment_count=gt.10&order=comment_count.desc&limit=500" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" | jq -r '.[].vehicle_id' 2>/dev/null)

TOTAL=$(echo "$VEHICLES" | grep -c . || echo 0)
echo "Found $TOTAL vehicles" | tee -a "$LOG"

for VID in $VEHICLES; do
    [ -z "$VID" ] && continue
    [ $(date +%s) -ge $END ] && break

    # Skip if already processed with assembly line
    HAS=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/observation_discoveries?select=id&vehicle_id=eq.${VID}&discovery_type=eq.sentiment_v2&limit=1" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | jq 'length' 2>/dev/null || echo 0)
    [ "$HAS" -gt 0 ] && continue

    # Get vehicle info
    VINFO=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/vehicles?select=year,make,model&id=eq.${VID}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" | jq '.[0]' 2>/dev/null)

    YEAR=$(echo "$VINFO" | jq -r '.year // empty')
    MAKE=$(echo "$VINFO" | jq -r '.make // empty')
    VMODEL=$(echo "$VINFO" | jq -r '.model // empty')

    [ -z "$MAKE" ] && continue

    # Get comments
    COMMENTS=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/auction_comments?select=comment_text&vehicle_id=eq.${VID}&limit=30" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | jq -r '.[].comment_text' 2>/dev/null | head -25)

    CNT=$(echo "$COMMENTS" | grep -c . || echo 0)
    [ "$CNT" -lt 5 ] && continue

    echo -n "[$(date +%H:%M:%S)] $YEAR $MAKE $VMODEL ($CNT) " | tee -a "$LOG"
    T0=$(date +%s)

    # === ASSEMBLY LINE ===

    # Step 1: Extract mentions
    MENTIONS=$(step1_extract_mentions "$COMMENTS")
    [ -z "$MENTIONS" ] && { echo "FAIL@1" | tee -a "$LOG"; continue; }
    STEP1_OK=$((STEP1_OK + 1))

    # Step 2: Classify sentiment
    CLASSIFIED=$(step2_classify_sentiment "$MENTIONS")
    [ -z "$CLASSIFIED" ] && { echo "FAIL@2" | tee -a "$LOG"; continue; }
    STEP2_OK=$((STEP2_OK + 1))

    # Step 3: Lookup known issues
    KNOWN=$(step3_lookup_known_issues "$MAKE" "$VMODEL" "$YEAR")
    STEP3_OK=$((STEP3_OK + 1))

    # Step 4: Match to known
    MATCHED=$(step4_match_to_known "$CLASSIFIED" "$KNOWN")
    STEP4_OK=$((STEP4_OK + 1))

    # Step 5: Filter garbage
    FILTERED=$(step5_filter_garbage "$MATCHED")
    GARBAGE_FILTERED=$((GARBAGE_FILTERED + $(echo "$MATCHED" | jq 'length') - $(echo "$FILTERED" | jq 'length')))

    # Step 6: Format output
    RESULT=$(step6_format_output "$FILTERED")

    DUR=$(($(date +%s) - T0))

    # Store result
    if [ -n "$RESULT" ] && echo "$RESULT" | jq . >/dev/null 2>&1; then
        curl -sS "${VITE_SUPABASE_URL}/rest/v1/observation_discoveries" \
            -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
            -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"vehicle_id\":\"${VID}\",\"discovery_type\":\"sentiment_v2\",\"raw_extraction\":${RESULT},\"observation_count\":${CNT},\"model_used\":\"assembly-line-v1\"}" >/dev/null 2>&1

        # Measure quality
        QUALITY=$(measure_quality "$RESULT" "$VID")
        echo "$QUALITY" >> /tmp/assembly-quality-log.jsonl

        THEMES=$(echo "$RESULT" | jq '.themes | length')
        FLAGS=$(echo "$RESULT" | jq '.red_flags | length')
        HIGHLIGHTS=$(echo "$RESULT" | jq '.highlights | length')

        echo "OK ${DUR}s (t:$THEMES f:$FLAGS h:$HIGHLIGHTS)" | tee -a "$LOG"
        PROCESSED=$((PROCESSED + 1))
    else
        echo "FAIL@format" | tee -a "$LOG"
    fi

    # Update metrics
    EL=$(($(date +%s) - START))
    RATE=$((PROCESSED * 3600 / (EL + 1)))
    echo "{\"processed\":$PROCESSED,\"rate\":$RATE,\"step1_ok\":$STEP1_OK,\"step2_ok\":$STEP2_OK,\"garbage_filtered\":$GARBAGE_FILTERED,\"elapsed_min\":$((EL/60))}" > "$METRICS"
done

# ============================================
# QUALITY REPORT
# ============================================

echo "" | tee -a "$LOG"
echo "=== ASSEMBLY LINE COMPLETE ===" | tee -a "$LOG"
echo "Processed: $PROCESSED" | tee -a "$LOG"
echo "Garbage filtered: $GARBAGE_FILTERED" | tee -a "$LOG"

# Analyze quality log
if [ -f /tmp/assembly-quality-log.jsonl ]; then
    echo "" | tee -a "$LOG"
    echo "=== QUALITY METRICS ===" | tee -a "$LOG"

    AVG_INSIGHTS=$(cat /tmp/assembly-quality-log.jsonl | jq -s '[.[].total_insights] | add / length')
    AVG_MATCHED=$(cat /tmp/assembly-quality-log.jsonl | jq -s '[.[].known_issue_matches] | add / length')
    AVG_SPECIFIC=$(cat /tmp/assembly-quality-log.jsonl | jq -s '[.[].specific_items] | add / length')

    echo "Avg insights per vehicle: $AVG_INSIGHTS" | tee -a "$LOG"
    echo "Avg matched to known issues: $AVG_MATCHED" | tee -a "$LOG"
    echo "Avg specific items: $AVG_SPECIFIC" | tee -a "$LOG"

    # Store aggregate metrics for learning
    cat > /tmp/assembly-run-summary.json << EOF
{
    "run_timestamp": "$(date -Iseconds)",
    "vehicles_processed": $PROCESSED,
    "garbage_filtered": $GARBAGE_FILTERED,
    "avg_insights": $AVG_INSIGHTS,
    "avg_known_matches": $AVG_MATCHED,
    "avg_specific": $AVG_SPECIFIC,
    "step_success_rates": {
        "extract": $STEP1_OK,
        "classify": $STEP2_OK,
        "lookup": $STEP3_OK,
        "match": $STEP4_OK
    }
}
EOF

    echo "" | tee -a "$LOG"
    cat /tmp/assembly-run-summary.json | tee -a "$LOG"
fi

echo "" | tee -a "$LOG"
echo "Done: $(date)" | tee -a "$LOG"
