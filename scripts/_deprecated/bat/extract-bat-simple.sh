#!/bin/bash
# Simple BaT Extraction - Use the proven two-step method
# Usage: ./scripts/extract-bat-simple.sh "https://bringatrailer.com/listing/..."

set -e

cd "$(dirname "$0")/.."
source nuke_frontend/.env.local 2>/dev/null || true

URL="${1:-}"

if [ -z "$URL" ]; then
  echo "❌ Usage: ./scripts/extract-bat-simple.sh <bat_url>"
  echo ""
  echo "Example:"
  echo "  ./scripts/extract-bat-simple.sh 'https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/'"
  exit 1
fi

echo "🚀 Extracting BaT vehicle using proven two-step method"
echo "   URL: $URL"
echo ""

# Step 1: Extract vehicle + specs + images
echo "📋 Step 1: Extracting vehicle data (extract-premium-auction)..."
RESULT1=$(curl -s -m 150 -X POST \
  "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$URL\", \"max_vehicles\": 1}")

echo "$RESULT1" | jq '.'

SUCCESS=$(echo "$RESULT1" | jq -r '.success // false')
if [ "$SUCCESS" != "true" ]; then
  echo "❌ Step 1 failed"
  exit 1
fi

VEHICLE_ID=$(echo "$RESULT1" | jq -r '.created_vehicle_ids[0] // .updated_vehicle_ids[0] // empty')
if [ -z "$VEHICLE_ID" ]; then
  echo "❌ No vehicle ID returned"
  exit 1
fi

echo "✅ Step 1 complete: Vehicle ID = $VEHICLE_ID"
echo ""

# Step 2: Extract comments + bids
echo "💬 Step 2: Extracting comments/bids (extract-auction-comments)..."
RESULT2=$(curl -s -m 60 -X POST \
  "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-auction-comments" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}" \
  -H "Content-Type: application/json" \
  -d "{\"auction_url\": \"$URL\", \"vehicle_id\": \"$VEHICLE_ID\"}")

echo "$RESULT2" | jq '.'

COMMENTS=$(echo "$RESULT2" | jq -r '.comments_extracted // 0')
BIDS=$(echo "$RESULT2" | jq -r '.bids_extracted // 0')

echo "✅ Step 2 complete: $COMMENTS comments, $BIDS bids"
echo ""
echo "🎯 DONE! Vehicle: https://n-zero.dev/vehicle/$VEHICLE_ID"

