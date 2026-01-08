#!/bin/bash
set -euo pipefail

# ⚠️ DEPRECATED: This script calls the deprecated import-bat-listing function.
# 
# ✅ USE THIS INSTEAD: ./scripts/extract-bat-vehicle.sh
# 
# The approved workflow uses:
# 1. extract-premium-auction (core data: VIN, specs, images, auction_events)
# 2. extract-auction-comments (comments, bids)
# 
# See: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
#
# This script now uses the approved workflow instead of the deprecated function.

# Import a Bring a Trailer listing URL into Nuke via approved two-step workflow:
# - Step 1: extract-premium-auction - Extracts VIN, specs, images, auction_events
# - Step 2: extract-auction-comments - Extracts comments and bids
#
# Usage:
#   ./scripts/import-bat-listing.sh "https://bringatrailer.com/listing/1977-gmc-jimmy-13/"
#
# Optional env vars:
#   SUPABASE_URL (or VITE_SUPABASE_URL)
#   SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_SERVICE_ROLE_KEY)

cd "$(dirname "$0")/.."

BAT_URL="${1:-}"
if [ -z "$BAT_URL" ]; then
  echo "Error: BaT URL required."
  echo "Example: ./scripts/import-bat-listing.sh \"https://bringatrailer.com/listing/1977-gmc-jimmy-13/\""
  exit 1
fi

# Load environment variables from .env if present
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([^#=]+)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]// /}"
      value="${BASH_REMATCH[2]}"
      value="${value#\"}"
      value="${value%\"}"
      value="${value#\'}"
      value="${value%\'}"
      export "$key=$value"
    fi
  done < .env
fi

SUPABASE_URL="${VITE_SUPABASE_URL:-${SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}}"
SERVICE_KEY="${VITE_SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"

if [ -z "$SERVICE_KEY" ]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_SERVICE_ROLE_KEY) not found."
  exit 1
fi

#
# IMPORTANT:
# - Newer versions of the edge function do NOT require organizationId.
# - Older deployed versions may require it. In that case, you must explicitly set ORGANIZATION_ID.
#
echo "✅ Using approved BaT extraction workflow..."
echo "   Step 1: extract-premium-auction"
echo "   Step 2: extract-auction-comments"
echo ""

# Step 1: Extract core vehicle data (VIN, specs, images, auction_events)
echo "📊 Step 1: Extracting core vehicle data..."
STEP1_BODY=$(jq -n \
  --arg url "$BAT_URL" \
  '{ url: $url, max_vehicles: 1 }')

STEP1_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${SUPABASE_URL}/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "$STEP1_BODY")

STEP1_HTTP_CODE=$(echo "$STEP1_RESPONSE" | tail -n1)
STEP1_BODY=$(echo "$STEP1_RESPONSE" | sed '$d')

if [ "$STEP1_HTTP_CODE" -lt 200 ] || [ "$STEP1_HTTP_CODE" -ge 300 ]; then
  echo "❌ Step 1 FAILED (HTTP $STEP1_HTTP_CODE)"
  echo "$STEP1_BODY"
  exit 1
fi

echo "✅ Step 1 complete (HTTP $STEP1_HTTP_CODE)"

# Extract vehicle_id from step 1 response
VEHICLE_ID=$(echo "$STEP1_BODY" | jq -r '.created_vehicle_ids[0] // .updated_vehicle_ids[0] // empty' 2>/dev/null || echo "")

if [ -z "$VEHICLE_ID" ] || [ "$VEHICLE_ID" = "null" ]; then
  echo "⚠️  Warning: No vehicle_id returned from Step 1"
  echo "$STEP1_BODY" | jq '.' 2>/dev/null || echo "$STEP1_BODY"
  exit 1
fi

echo "   Vehicle ID: $VEHICLE_ID"
echo ""

# Step 2: Extract comments and bids (non-critical)
echo "💬 Step 2: Extracting comments and bids..."
STEP2_BODY=$(jq -n \
  --arg auction_url "$BAT_URL" \
  --arg vehicle_id "$VEHICLE_ID" \
  '{ auction_url: $auction_url, vehicle_id: $vehicle_id }')

STEP2_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${SUPABASE_URL}/functions/v1/extract-auction-comments" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "$STEP2_BODY")

STEP2_HTTP_CODE=$(echo "$STEP2_RESPONSE" | tail -n1)
STEP2_BODY=$(echo "$STEP2_RESPONSE" | sed '$d')

if [ "$STEP2_HTTP_CODE" -ge 200 ] && [ "$STEP2_HTTP_CODE" -lt 300 ]; then
  COMMENTS_COUNT=$(echo "$STEP2_BODY" | jq -r '.comments_extracted // 0' 2>/dev/null || echo "0")
  BIDS_COUNT=$(echo "$STEP2_BODY" | jq -r '.bids_extracted // 0' 2>/dev/null || echo "0")
  echo "✅ Step 2 complete: $COMMENTS_COUNT comments, $BIDS_COUNT bids"
else
  echo "⚠️  Step 2 warning (non-critical): HTTP $STEP2_HTTP_CODE"
  echo "$STEP2_BODY" | head -c 200
  echo ""
fi

echo ""
echo "✅ BaT extraction complete!"
echo ""
echo "Results:"
echo "$STEP1_BODY" | jq '{success, vehicles_extracted, vehicles_created, debug_extraction}' 2>/dev/null || echo "$STEP1_BODY"


