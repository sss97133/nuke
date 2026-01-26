#!/bin/bash
# Batch BaT Extraction - Extract multiple listings
# Usage: ./scripts/extract-bat-batch.sh

set -e

cd "$(dirname "$0")/.."
source nuke_frontend/.env.local 2>/dev/null || true

# Current BaT auctions (replace with fresh URLs)
URLS=(
  "https://bringatrailer.com/listing/2020-porsche-911-carrera-s-cabriolet-19/"
  "https://bringatrailer.com/listing/2023-toyota-gr-corolla-circuit-edition-11/"
  "https://bringatrailer.com/listing/2002-porsche-911-carrera-4s-coupe-79/"
  "https://bringatrailer.com/listing/1971-porsche-911t-coupe-63/"
  "https://bringatrailer.com/listing/2006-ford-gt-111/"
  "https://bringatrailer.com/listing/1990-nissan-300zx-twin-turbo-5-speed-34/"
  "https://bringatrailer.com/listing/1973-datsun-240z-96/"
  "https://bringatrailer.com/listing/2023-ford-bronco-raptor-11/"
  "https://bringatrailer.com/listing/2024-ram-1500-trx-16/"
  "https://bringatrailer.com/listing/1967-chevrolet-corvette-convertible-427-435-4-speed-5/"
)

echo "🚀 Batch BaT Extraction"
echo "   Extracting ${#URLS[@]} vehicles"
echo ""

SUCCESS_COUNT=0
FAIL_COUNT=0

for URL in "${URLS[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📋 Extracting: $URL"
  echo ""
  
  # Step 1: Extract vehicle
  RESULT1=$(curl -s -m 150 -X POST \
    "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-premium-auction" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$URL\", \"max_vehicles\": 1}")

  SUCCESS=$(echo "$RESULT1" | jq -r '.success // false')
  if [ "$SUCCESS" != "true" ]; then
    echo "❌ Failed: $(echo "$RESULT1" | jq -r '.error // "Unknown error"')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo ""
    continue
  fi

  VEHICLES_SAVED=$(echo "$RESULT1" | jq -r '.vehicles_saved // 0')
  VEHICLE_ID=$(echo "$RESULT1" | jq -r '.created_vehicle_ids[0] // .updated_vehicle_ids[0] // empty')
  
  # If no vehicle ID but vehicles were saved, query DB by URL
  if [ -z "$VEHICLE_ID" ] && [ "$VEHICLES_SAVED" -gt 0 ]; then
    echo "   ⚠️  Vehicle saved but ID not in response, querying DB..."
    sleep 1
    
    # Query vehicles by discovery_url or bat_auction_url matching this URL
    VEHICLE_DATA=$(curl -s -X GET "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/vehicles?or=(discovery_url.eq.$URL,bat_auction_url.eq.$URL)&select=id,year,make,model&order=created_at.desc&limit=1" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}" \
      -H "Content-Type: application/json" 2>/dev/null | jq '.[0] // {}')
    
    VEHICLE_ID=$(echo "$VEHICLE_DATA" | jq -r '.id // empty')
    YEAR=$(echo "$VEHICLE_DATA" | jq -r '.year // "Unknown"')
    MAKE=$(echo "$VEHICLE_DATA" | jq -r '.make // "Unknown"')
    MODEL=$(echo "$VEHICLE_DATA" | jq -r '.model // "Unknown"')
  else
    # Get vehicle details from DB by ID
    if [ -n "$VEHICLE_ID" ]; then
      VEHICLE_DATA=$(curl -s -X GET "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/vehicles?id=eq.$VEHICLE_ID&select=year,make,model" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}" \
        -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}" \
        -H "Content-Type: application/json" 2>/dev/null | jq '.[0] // {}')
      
      YEAR=$(echo "$VEHICLE_DATA" | jq -r '.year // "Unknown"')
      MAKE=$(echo "$VEHICLE_DATA" | jq -r '.make // "Unknown"')
      MODEL=$(echo "$VEHICLE_DATA" | jq -r '.model // "Unknown"')
    else
      YEAR="Unknown"
      MAKE="Unknown"
      MODEL="Unknown"
    fi
  fi
  
  if [ -z "$VEHICLE_ID" ]; then
    echo "❌ No vehicle ID found (extraction failed)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo ""
    continue
  fi
  
  echo "✅ Vehicle: $YEAR $MAKE $MODEL (ID: $VEHICLE_ID)"

  # Step 2: Extract comments/bids
  RESULT2=$(curl -s -m 60 -X POST \
    "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-auction-comments" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}" \
    -H "Content-Type: application/json" \
    -d "{\"auction_url\": \"$URL\", \"vehicle_id\": \"$VEHICLE_ID\"}")

  COMMENTS=$(echo "$RESULT2" | jq -r '.comments_extracted // 0')
  BIDS=$(echo "$RESULT2" | jq -r '.bids_extracted // 0')

  echo "✅ Comments: $COMMENTS, Bids: $BIDS"
  echo "🔗 https://n-zero.dev/vehicle/$VEHICLE_ID"
  
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  echo ""
  
  # Small delay between extractions
  sleep 2
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Success: $SUCCESS_COUNT"
echo "❌ Failed:  $FAIL_COUNT"
echo ""
echo "🎯 Done! Check https://n-zero.dev/org/bring-a-trailer"

