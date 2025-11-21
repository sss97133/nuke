#!/bin/bash

# Automated Image Classification Processor
# Processes all images in batches to avoid timeouts
# Continues automatically until all images are classified

set -e

SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
            BATCH_SIZE=100  # Smaller batches to avoid rate limits
            MAX_ATTEMPTS=100  # More attempts since batches are smaller
            SLEEP_BETWEEN_BATCHES=5  # Longer wait to avoid rate limits

# Get service key
if [ -f .env.local ]; then
  SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d '=' -f2 | tr -d '"' | tr -d "'")
else
  echo "Error: .env.local not found"
  exit 1
fi

if [ -z "$SERVICE_KEY" ]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY not found in .env.local"
  exit 1
fi

echo "🚀 Starting automated image classification"
echo "📊 Batch size: $BATCH_SIZE images"
echo "⏱️  Estimated time: ~4.5 hours for all images"
echo ""

attempt=0
total_processed=0

while [ $attempt -lt $MAX_ATTEMPTS ]; do
  attempt=$((attempt + 1))
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 Batch #$attempt"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Run batch
  response=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/backfill-image-angles" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"batchSize\": $BATCH_SIZE, \"minConfidence\": 80, \"requireReview\": true}" \
    --max-time 600)
  
  # Parse JSON response - try multiple methods
  if command -v jq &> /dev/null; then
    processed=$(echo "$response" | jq -r '.processed // 0' 2>/dev/null || echo "0")
    skipped=$(echo "$response" | jq -r '.skipped // 0' 2>/dev/null || echo "0")
    failed=$(echo "$response" | jq -r '.failed // 0' 2>/dev/null || echo "0")
    needs_review=$(echo "$response" | jq -r '.needsReview // 0' 2>/dev/null || echo "0")
  elif command -v python3 &> /dev/null; then
    # Use Python to parse JSON
    processed=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('processed', 0))" 2>/dev/null || echo "0")
    skipped=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('skipped', 0))" 2>/dev/null || echo "0")
    failed=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('failed', 0))" 2>/dev/null || echo "0")
    needs_review=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('needsReview', 0))" 2>/dev/null || echo "0")
  else
    # Fallback: use sed/grep with better pattern matching
    processed=$(echo "$response" | sed -n 's/.*"processed":\([0-9]*\).*/\1/p' | head -1 || echo "0")
    skipped=$(echo "$response" | sed -n 's/.*"skipped":\([0-9]*\).*/\1/p' | head -1 || echo "0")
    failed=$(echo "$response" | sed -n 's/.*"failed":\([0-9]*\).*/\1/p' | head -1 || echo "0")
    needs_review=$(echo "$response" | sed -n 's/.*"needsReview":\([0-9]*\).*/\1/p' | head -1 || echo "0")
  fi
  
  # Ensure we have valid integers
  processed=${processed:-0}
  skipped=${skipped:-0}
  failed=${failed:-0}
  needs_review=${needs_review:-0}
  
  # Convert to integers (handle empty strings)
  processed=$((processed + 0))
  skipped=$((skipped + 0))
  failed=$((failed + 0))
  needs_review=$((needs_review + 0))
  
  total_processed=$((total_processed + processed))
  
  echo "✅ Processed: $processed"
  echo "⏭️  Skipped: $skipped"
  echo "❌ Failed: $failed"
  echo "⚠️  Needs review: $needs_review"
  echo "📊 Total processed so far: $total_processed"
  echo ""
  
  # Debug: show raw response if parsing failed
  if [ "$processed" -eq 0 ] && [ "$skipped" -eq 0 ] && [ "$failed" -eq 0 ]; then
    echo "⚠️  Warning: Could not parse response. Raw response:"
    echo "$response" | head -5
    echo ""
    # Don't break - continue trying
  fi
  
  # Check if we're done (no more images to process)
  # Only stop if we processed 0 AND skipped many (all already classified)
  if [ "$processed" -eq 0 ] && [ "$skipped" -ge "$((BATCH_SIZE * 2))" ]; then
    echo "✅ All images already classified!"
    break
  fi
  
  # Continue processing - don't stop early
  # The function will skip already-classified images automatically
  
  # Wait before next batch
  if [ $attempt -lt $MAX_ATTEMPTS ]; then
    echo "⏳ Waiting ${SLEEP_BETWEEN_BATCHES}s before next batch..."
    sleep $SLEEP_BETWEEN_BATCHES
    echo ""
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Processing complete!"
echo "📊 Total batches: $attempt"
echo "📊 Total images processed: $total_processed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

