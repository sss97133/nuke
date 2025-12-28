#!/bin/bash
# Extract inventory for Hillbank Motorsports

SUPABASE_URL="${SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: SUPABASE_SERVICE_ROLE_KEY not set"
  exit 1
fi

ORG_ID="1152029f-316d-4379-80b6-e74706700490"
WEBSITE="https://www.hillbankmotorsports.com"

echo "🔍 Step 1: Triggering inventory extraction..."
echo "   Organization: Hillbank"
echo "   Website: $WEBSITE"

RESPONSE=$(curl -sS -X POST "${SUPABASE_URL}/functions/v1/scrape-multi-source" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"source_url\": \"${WEBSITE}\",
    \"source_type\": \"dealer_website\",
    \"extract_listings\": true,
    \"extract_dealer_info\": true,
    \"use_llm_extraction\": true,
    \"cheap_mode\": false,
    \"max_listings\": 500,
    \"organization_id\": \"${ORG_ID}\"
  }")

echo "$RESPONSE" | jq '.'
LISTINGS_QUEUED=$(echo "$RESPONSE" | jq -r '.listings_queued // 0')
echo ""
echo "✅ Queued $LISTINGS_QUEUED listings in import_queue"

if [ "$LISTINGS_QUEUED" -gt 0 ]; then
  echo ""
  echo "⚙️  Step 2: Processing import_queue to create vehicles..."
  PROCESS_RESPONSE=$(curl -sS -X POST "${SUPABASE_URL}/functions/v1/process-import-queue" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
      "batch_size": 20,
      "max_results": 500
    }')
  
  echo "$PROCESS_RESPONSE" | jq '{processed, vehicles_created, vehicles_updated, errors}'
  echo ""
  echo "✅ Processing complete!"
  echo ""
  echo "📊 Run the SQL query in get_hillbank_inventory.sql to see all vehicle data"
fi

