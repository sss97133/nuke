#!/bin/bash

# Resume image processing script
# Handles rate limits gracefully and continues until all images are processed

set -e

# Configuration
SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
BATCH_SIZE=50  # Smaller batches to avoid rate limits
MAX_ATTEMPTS=200  # More attempts for large image sets
SLEEP_BETWEEN_BATCHES=10  # Longer wait between batches (10s)
SLEEP_ON_RATE_LIMIT=60  # Wait 60s if rate limit hit
LOG_FILE="/tmp/image-processing-resume.log"

# Get service key
if [ -f .env.local ]; then
  SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d '=' -f2 | tr -d '"' | tr -d "'" | head -1)
else
  SERVICE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-""}
fi

if [ -z "$SERVICE_KEY" ]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY not found in .env.local or environment variables."
  exit 1
fi

# Ensure the log file exists
touch "$LOG_FILE"

echo "🚀 Starting/resuming image classification with rate limit handling" | tee -a "$LOG_FILE"
echo "📊 Batch size: $BATCH_SIZE images" | tee -a "$LOG_FILE"
echo "⏱️  Sleep between batches: ${SLEEP_BETWEEN_BATCHES}s" | tee -a "$LOG_FILE"
echo "⏱️  Sleep on rate limit: ${SLEEP_ON_RATE_LIMIT}s" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

attempt=0
total_processed=0
consecutive_rate_limits=0

while [ $attempt -lt $MAX_ATTEMPTS ]; do
  attempt=$((attempt + 1))
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
  echo "📦 Batch #$attempt" | tee -a "$LOG_FILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
  
  # Run batch with timeout
  response=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/backfill-image-angles" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"batchSize\": $BATCH_SIZE, \"minConfidence\": 80, \"requireReview\": true}" \
    --max-time 600) # 10 minute timeout
  
  # Parse JSON response
  if command -v jq &> /dev/null; then
    processed=$(echo "$response" | jq -r '.processed // 0' 2>/dev/null || echo "0")
    skipped=$(echo "$response" | jq -r '.skipped // 0' 2>/dev/null || echo "0")
    failed=$(echo "$response" | jq -r '.failed // 0' 2>/dev/null || echo "0")
    needs_review=$(echo "$response" | jq -r '.needsReview // 0' 2>/dev/null || echo "0")
    error=$(echo "$response" | jq -r '.error // ""' 2>/dev/null || echo "")
  elif command -v python3 &> /dev/null; then
    processed=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('processed', 0))" 2>/dev/null || echo "0")
    skipped=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('skipped', 0))" 2>/dev/null || echo "0")
    failed=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('failed', 0))" 2>/dev/null || echo "0")
    needs_review=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('needsReview', 0))" 2>/dev/null || echo "0")
    error=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('error', ''))" 2>/dev/null || echo "")
  else
    processed=$(echo "$response" | sed -n 's/.*"processed":\([0-9]*\).*/\1/p' | head -1 || echo "0")
    skipped=$(echo "$response" | sed -n 's/.*"skipped":\([0-9]*\).*/\1/p' | head -1 || echo "0")
    failed=$(echo "$response" | sed -n 's/.*"failed":\([0-9]*\).*/\1/p' | head -1 || echo "0")
    needs_review=$(echo "$response" | sed -n 's/.*"needsReview":\([0-9]*\).*/\1/p' | head -1 || echo "0")
    error=""
  fi
  
  # Ensure we have valid integers
  processed=${processed:-0}
  skipped=${skipped:-0}
  failed=${failed:-0}
  needs_review=${needs_review:-0}
  
  # Convert to integers
  processed=$((processed + 0))
  skipped=$((skipped + 0))
  failed=$((failed + 0))
  needs_review=$((needs_review + 0))
  
  total_processed=$((total_processed + processed))
  
  echo "✅ Processed: $processed" | tee -a "$LOG_FILE"
  echo "⏭️  Skipped: $skipped" | tee -a "$LOG_FILE"
  echo "❌ Failed: $failed" | tee -a "$LOG_FILE"
  echo "⚠️  Needs review: $needs_review" | tee -a "$LOG_FILE"
  echo "📊 Total processed so far: $total_processed" | tee -a "$LOG_FILE"
  
  # Check for rate limit errors
  if [[ "$error" == *"rate limit"* ]] || [[ "$error" == *"429"* ]] || [[ "$response" == *"rate limit"* ]]; then
    consecutive_rate_limits=$((consecutive_rate_limits + 1))
    echo "⚠️  RATE LIMIT HIT! Waiting ${SLEEP_ON_RATE_LIMIT}s before retrying..." | tee -a "$LOG_FILE"
    echo "   Consecutive rate limits: $consecutive_rate_limits" | tee -a "$LOG_FILE"
    
    # If we hit rate limits 3 times in a row, wait longer
    if [ $consecutive_rate_limits -ge 3 ]; then
      echo "   Multiple rate limits detected. Waiting ${SLEEP_ON_RATE_LIMIT}s x 2 = $((SLEEP_ON_RATE_LIMIT * 2))s..." | tee -a "$LOG_FILE"
      sleep $((SLEEP_ON_RATE_LIMIT * 2))
      consecutive_rate_limits=0  # Reset counter after long wait
    else
      sleep $SLEEP_ON_RATE_LIMIT
    fi
    continue  # Retry this batch
  else
    consecutive_rate_limits=0  # Reset counter on success
  fi
  
  # Debug: show raw response if parsing failed
  if [ "$processed" -eq 0 ] && [ "$skipped" -eq 0 ] && [ "$failed" -eq 0 ] && [ -z "$error" ]; then
    echo "⚠️  Warning: Could not parse response. Raw response:" | tee -a "$LOG_FILE"
    echo "$response" | head -5 | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
  fi
  
  # Check if we're done (no more images to process)
  if [ "$processed" -eq 0 ] && [ "$skipped" -ge "$((BATCH_SIZE * 2))" ]; then
    echo "✅ All images already classified!" | tee -a "$LOG_FILE"
    break
  fi
  
  # If we processed some images, continue
  if [ "$processed" -gt 0 ] || [ "$skipped" -gt 0 ]; then
    echo "⏳ Waiting ${SLEEP_BETWEEN_BATCHES}s before next batch..." | tee -a "$LOG_FILE"
    sleep $SLEEP_BETWEEN_BATCHES
  else
    # If nothing happened, wait a bit longer
    echo "⏳ No progress, waiting ${SLEEP_BETWEEN_BATCHES}s..." | tee -a "$LOG_FILE"
    sleep $SLEEP_BETWEEN_BATCHES
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
echo "🎉 Processing complete!" | tee -a "$LOG_FILE"
echo "📊 Total batches: $attempt" | tee -a "$LOG_FILE"
echo "📊 Total images processed: $total_processed" | tee -a "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"

