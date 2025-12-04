#!/bin/bash

# Process Stage 2: Detailed Component Extraction
# Takes images that completed Stage 1 and extracts detailed components

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

echo "🔍 Stage 2: Detailed Component Extraction"
echo "   Batch size: $BATCH_SIZE"
echo "   Max batches: $MAX_BATCHES"
echo ""

SUCCESS_COUNT=0
ERROR_COUNT=0

for BATCH in $(seq 1 $MAX_BATCHES); do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Batch $BATCH/$MAX_BATCHES"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Get batch of Stage 1 complete, ready for Stage 2
  RECORDS=$(psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -t -c "
    SELECT json_agg(json_build_object(
      'work_extraction_id', iwe.id,
      'image_id', iwe.image_id,
      'vehicle_id', iwe.vehicle_id,
      'image_url', vi.image_url
    ))
    FROM image_work_extractions iwe
    JOIN vehicle_images vi ON vi.id = iwe.image_id
    WHERE iwe.status = 'extracted'
      AND iwe.processing_stage = 'stage2_detailed'
      AND NOT EXISTS (
        SELECT 1 FROM ai_component_detections 
        WHERE vehicle_image_id = iwe.image_id
      )
    LIMIT $BATCH_SIZE
    FOR UPDATE SKIP LOCKED;
  " 2>/dev/null | tr -d ' \n')

  if [ "$RECORDS" == "null" ] || [ -z "$RECORDS" ]; then
    echo "✅ No more images ready for Stage 2!"
    break
  fi

  # Process each record
  echo "$RECORDS" | jq -r '.[] | "\(.work_extraction_id)|\(.image_id)|\(.vehicle_id)|\(.image_url)"' | while IFS='|' read -r WORK_EXTRACTION_ID IMAGE_ID VEHICLE_ID IMAGE_URL; do
    echo "Processing Stage 2: ${IMAGE_ID:0:8}..."
    
    # Call Stage 2 edge function
    RESPONSE=$(curl -s -X POST "$SUPABASE_URL/functions/v1/detailed-component-extractor" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{
        \"work_extraction_id\": \"$WORK_EXTRACTION_ID\",
        \"image_id\": \"$IMAGE_ID\",
        \"vehicle_id\": \"$VEHICLE_ID\",
        \"image_url\": \"$IMAGE_URL\"
      }")

    if echo "$RESPONSE" | jq -e '.success' >/dev/null 2>&1; then
      COMPONENTS=$(echo "$RESPONSE" | jq -r '.components_extracted // 0')
      echo "  ✅ Extracted $COMPONENTS components"
      ((SUCCESS_COUNT++))
    else
      ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
      echo "  ❌ Error: $ERROR_MSG"
      ((ERROR_COUNT++))
    fi

    sleep 0.5
  done

  echo ""
  
  # Check if done
  REMAINING=$(psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -t -c "
    SELECT COUNT(*)
    FROM image_work_extractions
    WHERE status = 'extracted'
      AND processing_stage = 'stage2_detailed';
  " 2>/dev/null | tr -d ' ')

  if [ "$REMAINING" == "0" ]; then
    echo "✅ All Stage 2 processing complete!"
    break
  fi

  if [ $BATCH -lt $MAX_BATCHES ]; then
    echo "⏳ Waiting 2 seconds..."
    sleep 2
  fi
done

# Final stats
TOTAL_COMPONENTS=$(psql "postgresql://postgres.qkgaybvrernstplzjaam:$DB_PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -t -c "
  SELECT COUNT(*) FROM ai_component_detections;
" 2>/dev/null | tr -d ' ')

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📈 Final Stats:"
echo "   ✅ Stage 2 Complete: $SUCCESS_COUNT"
echo "   ❌ Errors: $ERROR_COUNT"
echo "   🔧 Total Components Extracted: $TOTAL_COMPONENTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

