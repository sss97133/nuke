#!/bin/bash

# Batch Process Pending Images
# Usage: ./scripts/process-pending-images.sh [batch_size] [max_batches]

BATCH_SIZE=${1:-10}
MAX_BATCHES=${2:-5}

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Validate required environment variables
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required"
  exit 1
fi

SUPABASE_URL="$VITE_SUPABASE_URL"
SERVICE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
DB_PASSWORD="${Supabase_Database_Password:-}"

echo "🚀 Starting batch processing"
echo "   Batch size: $BATCH_SIZE"
echo "   Max batches: $MAX_BATCHES"
echo ""

SUCCESS_COUNT=0
ERROR_COUNT=0

for BATCH in $(seq 1 $MAX_BATCHES); do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Batch $BATCH/$MAX_BATCHES"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Get batch of pending images
  IMAGES=$(psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -t -c "
    SELECT json_agg(json_build_object(
      'id', id,
      'vehicle_id', vehicle_id,
      'image_url', image_url
    ))
    FROM (
      SELECT id, vehicle_id, image_url
      FROM vehicle_images
      WHERE vehicle_id IS NOT NULL
        AND ai_processing_status = 'pending'
        AND image_url IS NOT NULL
      LIMIT $BATCH_SIZE
      FOR UPDATE SKIP LOCKED
    ) t;
  " 2>/dev/null | tr -d ' \n')

  if [ "$IMAGES" == "null" ] || [ -z "$IMAGES" ]; then
    echo "✅ No more pending images!"
    break
  fi

  # Process each image
  echo "$IMAGES" | jq -r '.[] | "\(.id)|\(.vehicle_id)|\(.image_url)"' | while IFS='|' read -r IMAGE_ID VEHICLE_ID IMAGE_URL; do
    echo "Processing: ${IMAGE_ID:0:8}..."
    
    # Mark as processing
    psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -c "
      UPDATE vehicle_images
      SET ai_processing_status = 'processing',
          ai_processing_started_at = NOW()
      WHERE id = '$IMAGE_ID';
    " >/dev/null 2>&1

    # Call edge function
    RESPONSE=$(curl -s -X POST "$SUPABASE_URL/functions/v1/intelligent-work-detector" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{
        \"image_id\": \"$IMAGE_ID\",
        \"vehicle_id\": \"$VEHICLE_ID\",
        \"image_url\": \"$IMAGE_URL\"
      }")

    if echo "$RESPONSE" | jq -e '.success' >/dev/null 2>&1; then
      WORK_TYPE=$(echo "$RESPONSE" | jq -r '.extraction.work_type // "work"')
      CONFIDENCE=$(echo "$RESPONSE" | jq -r '.extraction.confidence // 0')
      CONFIDENCE_PCT=$(echo "$CONFIDENCE * 100" | bc | cut -d. -f1)
      
      # Mark as complete
      psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -c "
        UPDATE vehicle_images
        SET ai_processing_status = 'complete',
            ai_processing_completed_at = NOW()
        WHERE id = '$IMAGE_ID';
      " >/dev/null 2>&1

      echo "  ✅ $WORK_TYPE detected (${CONFIDENCE_PCT}% confidence)"
      ((SUCCESS_COUNT++))
    else
      ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
      echo "  ❌ Error: $ERROR_MSG"
      
      # Mark as failed
      psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -c "
        UPDATE vehicle_images
        SET ai_processing_status = 'failed'
        WHERE id = '$IMAGE_ID';
      " >/dev/null 2>&1

      ((ERROR_COUNT++))
    fi

    # Small delay
    sleep 0.5
  done

  echo ""
  
  # Check if done
  PENDING=$(psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -t -c "
    SELECT COUNT(*)
    FROM vehicle_images
    WHERE vehicle_id IS NOT NULL
      AND ai_processing_status = 'pending';
  " 2>/dev/null | tr -d ' ')

  if [ "$PENDING" == "0" ]; then
    echo "✅ All images processed!"
    break
  fi

  if [ $BATCH -lt $MAX_BATCHES ]; then
    echo "⏳ Waiting 2 seconds before next batch..."
    sleep 2
  fi
done

# Final stats
PENDING=$(psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -t -c "
  SELECT COUNT(*)
  FROM vehicle_images
  WHERE vehicle_id IS NOT NULL
    AND ai_processing_status = 'pending';
" 2>/dev/null | tr -d ' ')

COMPLETE=$(psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -t -c "
  SELECT COUNT(*)
  FROM vehicle_images
  WHERE ai_processing_status = 'complete';
" 2>/dev/null | tr -d ' ')

FAILED=$(psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -t -c "
  SELECT COUNT(*)
  FROM vehicle_images
  WHERE ai_processing_status = 'failed';
" 2>/dev/null | tr -d ' ')

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📈 Final Stats:"
echo "   ✅ Complete: $COMPLETE"
echo "   ⏳ Pending: $PENDING"
echo "   ❌ Failed: $FAILED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

