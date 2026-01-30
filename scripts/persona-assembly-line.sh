#!/bin/bash
# ============================================
# PERSONA ASSEMBLY LINE
# Extract personality signals from comments
# Dumb steps, continuous learning
# ============================================

cd /Users/skylar/nuke
export $(grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY)=' .env | xargs)

LOG="/tmp/persona-line-$(date +%Y%m%d-%H%M%S).log"
METRICS="/tmp/persona-metrics.json"
MODEL="llama3.1:8b"
BATCH_SIZE=50
RUN_HOURS=${1:-2}

echo "=== PERSONA ASSEMBLY LINE ===" | tee "$LOG"
echo "Started: $(date)" | tee -a "$LOG"

START=$(date +%s)
END=$((START + RUN_HOURS * 3600))
PROCESSED=0

# ============================================
# ASSEMBLY STEPS
# ============================================

step1_extract_tone() {
    # DUMB: Rate the tone on simple scales
    local comment="$1"

    local prompt="Rate this comment's tone on 0-10 scales. Just numbers, one per line.
helpful (0=unhelpful, 10=very helpful):
technical (0=casual, 10=very technical):
friendly (0=cold, 10=warm):
confident (0=uncertain, 10=very confident):
snarky (0=sincere, 10=very sarcastic):

Comment: $comment"

    curl -s -m 30 http://localhost:11434/api/generate \
        -d "$(jq -nc --arg model "$MODEL" --arg prompt "$prompt" '{model:$model,prompt:$prompt,stream:false}')" \
        | jq -r '.response' 2>/dev/null
}

step2_classify_expertise() {
    # DUMB: What level of expertise?
    local comment="$1"

    local prompt="Classify the expertise level shown in this comment.
Reply with ONE word: novice, enthusiast, expert, or professional

Comment: $comment"

    curl -s -m 20 http://localhost:11434/api/generate \
        -d "$(jq -nc --arg model "$MODEL" --arg prompt "$prompt" '{model:$model,prompt:$prompt,stream:false}')" \
        | jq -r '.response' 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -oE 'novice|enthusiast|expert|professional' | head -1
}

step3_detect_intent() {
    # DUMB: Why is this person commenting?
    local comment="$1"

    local prompt="What is this person's intent? Reply with ONE word:
- buying (interested in purchasing)
- selling (promoting a sale)
- learning (asking questions)
- socializing (chatting, joking)
- advising (giving advice/info)
- critiquing (pointing out flaws)

Comment: $comment"

    curl -s -m 20 http://localhost:11434/api/generate \
        -d "$(jq -nc --arg model "$MODEL" --arg prompt "$prompt" '{model:$model,prompt:$prompt,stream:false}')" \
        | jq -r '.response' 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -oE 'buying|selling|learning|socializing|advising|critiquing' | head -1
}

step4_detect_behaviors() {
    # DUMB: Yes/no on specific behaviors
    local comment="$1"

    local prompt="Answer YES or NO for each:
asks_question:
answers_question:
gives_advice:
makes_joke:
supports_others:
critiques_others:

Comment: $comment"

    curl -s -m 20 http://localhost:11434/api/generate \
        -d "$(jq -nc --arg model "$MODEL" --arg prompt "$prompt" '{model:$model,prompt:$prompt,stream:false}')" \
        | jq -r '.response' 2>/dev/null
}

parse_tone_scores() {
    local raw="$1"
    # Extract numbers from response
    local nums=$(echo "$raw" | grep -oE '[0-9]+' | head -5)
    local arr=($nums)

    local helpful=${arr[0]:-5}
    local technical=${arr[1]:-5}
    local friendly=${arr[2]:-5}
    local confident=${arr[3]:-5}
    local snarky=${arr[4]:-2}

    # Normalize to 0-1
    echo "$helpful $technical $friendly $confident $snarky" | awk '{
        printf "{\"helpful\":%.2f,\"technical\":%.2f,\"friendly\":%.2f,\"confident\":%.2f,\"snarky\":%.2f}",
        $1/10, $2/10, $3/10, $4/10, $5/10
    }'
}

parse_behaviors() {
    local raw="$1"
    local raw_lower=$(echo "$raw" | tr '[:upper:]' '[:lower:]')

    local asks_q=$(echo "$raw_lower" | grep -q "asks_question.*yes\|asks.*yes" && echo "true" || echo "false")
    local answers_q=$(echo "$raw_lower" | grep -q "answers_question.*yes\|answers.*yes" && echo "true" || echo "false")
    local advice=$(echo "$raw_lower" | grep -q "gives_advice.*yes\|advice.*yes" && echo "true" || echo "false")
    local joke=$(echo "$raw_lower" | grep -q "makes_joke.*yes\|joke.*yes" && echo "true" || echo "false")
    local support=$(echo "$raw_lower" | grep -q "supports_others.*yes\|supports.*yes" && echo "true" || echo "false")
    local critique=$(echo "$raw_lower" | grep -q "critiques_others.*yes\|critiques.*yes" && echo "true" || echo "false")

    echo "{\"asks_questions\":$asks_q,\"answers_questions\":$answers_q,\"gives_advice\":$advice,\"makes_jokes\":$joke,\"supports_others\":$support,\"critiques_others\":$critique}"
}

# ============================================
# MAIN LOOP
# ============================================

echo "Fetching comments..." | tee -a "$LOG"

# Get comments that haven't been persona-analyzed
# Start with high-activity commenters
COMMENTS=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/auction_comments?select=id,author_username,comment_text,vehicle_id&limit=1000&order=posted_at.desc" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null)

TOTAL=$(echo "$COMMENTS" | jq 'length')
echo "Found $TOTAL comments" | tee -a "$LOG"

echo "$COMMENTS" | jq -c '.[]' | while read -r comment_row; do
    [ $(date +%s) -ge $END ] && break

    COMMENT_ID=$(echo "$comment_row" | jq -r '.id')
    USERNAME=$(echo "$comment_row" | jq -r '.author_username // "anonymous"')
    COMMENT_TEXT=$(echo "$comment_row" | jq -r '.comment_text // ""')
    VEHICLE_ID=$(echo "$comment_row" | jq -r '.vehicle_id // null')

    # Skip empty or too short
    [ ${#COMMENT_TEXT} -lt 20 ] && continue

    # Skip if already processed
    EXISTS=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/comment_persona_signals?select=id&comment_id=eq.${COMMENT_ID}&limit=1" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null | jq 'length')
    [ "$EXISTS" -gt 0 ] && continue

    echo -n "[$(date +%H:%M:%S)] @$USERNAME (${#COMMENT_TEXT}c) " | tee -a "$LOG"

    # === ASSEMBLY LINE ===

    # Step 1: Tone
    TONE_RAW=$(step1_extract_tone "$COMMENT_TEXT")
    TONE=$(parse_tone_scores "$TONE_RAW")

    # Step 2: Expertise
    EXPERTISE=$(step2_classify_expertise "$COMMENT_TEXT")
    [ -z "$EXPERTISE" ] && EXPERTISE="enthusiast"

    # Step 3: Intent
    INTENT=$(step3_detect_intent "$COMMENT_TEXT")
    [ -z "$INTENT" ] && INTENT="socializing"

    # Step 4: Behaviors
    BEHAVIORS_RAW=$(step4_detect_behaviors "$COMMENT_TEXT")
    BEHAVIORS=$(parse_behaviors "$BEHAVIORS_RAW")

    # Build record
    RECORD=$(jq -nc \
        --arg comment_id "$COMMENT_ID" \
        --arg username "$USERNAME" \
        --arg vehicle_id "$VEHICLE_ID" \
        --arg text "$COMMENT_TEXT" \
        --argjson tone "$TONE" \
        --arg expertise "$EXPERTISE" \
        --arg intent "$INTENT" \
        --argjson behaviors "$BEHAVIORS" \
        --arg model "$MODEL" \
        '{
            comment_id: $comment_id,
            author_username: $username,
            vehicle_id: (if $vehicle_id == "null" then null else $vehicle_id end),
            comment_text: $text,
            comment_length: ($text | length),
            tone_helpful: $tone.helpful,
            tone_technical: $tone.technical,
            tone_friendly: $tone.friendly,
            tone_confident: $tone.confident,
            tone_snarky: $tone.snarky,
            expertise_level: $expertise,
            intent: $intent,
            asks_questions: $behaviors.asks_questions,
            answers_questions: $behaviors.answers_questions,
            gives_advice: $behaviors.gives_advice,
            makes_jokes: $behaviors.makes_jokes,
            supports_others: $behaviors.supports_others,
            critiques_others: $behaviors.critiques_others,
            model_used: $model,
            confidence: 0.7
        }')

    # Store
    RESP=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/comment_persona_signals" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=minimal" \
        -d "$RECORD" 2>&1)

    if echo "$RESP" | grep -q "error"; then
        echo "ERR" | tee -a "$LOG"
    else
        echo "$EXPERTISE/$INTENT t:$(echo $TONE | jq -r '.helpful')" | tee -a "$LOG"
        PROCESSED=$((PROCESSED + 1))
    fi

    # Update metrics
    EL=$(($(date +%s) - START))
    RATE=$((PROCESSED * 3600 / (EL + 1)))
    echo "{\"processed\":$PROCESSED,\"rate\":$RATE,\"elapsed_min\":$((EL/60))}" > "$METRICS"

done

echo "" | tee -a "$LOG"
echo "=== DONE: $PROCESSED processed ===" | tee -a "$LOG"

# Aggregate to author profiles (simple version)
echo "Aggregating author profiles..." | tee -a "$LOG"

curl -sS "${VITE_SUPABASE_URL}/rest/v1/rpc/aggregate_author_personas" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null || echo "Note: aggregation function not deployed yet"

echo "Done: $(date)" | tee -a "$LOG"
