#!/bin/bash

# BaT Vehicle Extraction Script
# Uses the proven two-step workflow: extract-premium-auction + extract-auction-comments
#
# Usage:
#   ./scripts/extract-bat-vehicle.sh "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check arguments
if [ -z "$1" ]; then
  echo -e "${RED}Error: BaT URL required${NC}"
  echo "Usage: $0 <bat_url>"
  echo "Example: $0 'https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/'"
  exit 1
fi

BAT_URL="$1"

# Load environment variables
if [ -f "nuke_frontend/.env.local" ]; then
  export $(grep -v '^#' nuke_frontend/.env.local | xargs)
fi

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-${SUPABASE_URL}}"
SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_KEY}}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_ROLE_KEY" ]; then
  echo -e "${RED}Error: SUPABASE_URL and SERVICE_ROLE_KEY must be set${NC}"
  echo "Set them in nuke_frontend/.env.local or as environment variables"
  exit 1
fi

echo -e "${GREEN}🚀 BaT Vehicle Extraction${NC}"
echo "URL: $BAT_URL"
echo ""

# Step 1: Extract core vehicle data
echo -e "${YELLOW}Step 1: Extracting core vehicle data (VIN, specs, images)...${NC}"
EXTRACTION_RESULT=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${BAT_URL}\", \"max_vehicles\": 1}")

# Check if extraction succeeded
SUCCESS=$(echo "$EXTRACTION_RESULT" | jq -r '.success // false')
if [ "$SUCCESS" != "true" ]; then
  echo -e "${RED}❌ Extraction failed:${NC}"
  echo "$EXTRACTION_RESULT" | jq '.'
  exit 1
fi

# Extract vehicle_id
VEHICLE_ID=$(echo "$EXTRACTION_RESULT" | jq -r '.created_vehicle_ids[0] // .updated_vehicle_ids[0] // empty')

if [ -z "$VEHICLE_ID" ] || [ "$VEHICLE_ID" == "null" ]; then
  echo -e "${RED}❌ Failed to get vehicle_id from extraction result${NC}"
  echo "$EXTRACTION_RESULT" | jq '.'
  exit 1
fi

echo -e "${GREEN}✅ Vehicle extracted successfully${NC}"
echo "Vehicle ID: $VEHICLE_ID"

# Show extracted data
VIN=$(echo "$EXTRACTION_RESULT" | jq -r '.debug_extraction.vin // "N/A"')
MILEAGE=$(echo "$EXTRACTION_RESULT" | jq -r '.debug_extraction.mileage // "N/A"')
COLOR=$(echo "$EXTRACTION_RESULT" | jq -r '.debug_extraction.color // "N/A"')
TRANSMISSION=$(echo "$EXTRACTION_RESULT" | jq -r '.debug_extraction.transmission // "N/A"')
IMAGES_COUNT=$(echo "$EXTRACTION_RESULT" | jq -r '.debug_extraction.images_count // 0')

echo "  VIN: $VIN"
echo "  Mileage: $MILEAGE"
echo "  Color: $COLOR"
echo "  Transmission: $TRANSMISSION"
echo "  Images: $IMAGES_COUNT"
echo ""

# Step 2: Extract comments and bids
echo -e "${YELLOW}Step 2: Extracting comments and bids...${NC}"
COMMENT_RESULT=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/extract-auction-comments" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"auction_url\": \"${BAT_URL}\", \"vehicle_id\": \"${VEHICLE_ID}\"}")

COMMENTS_EXTRACTED=$(echo "$COMMENT_RESULT" | jq -r '.comments_extracted // 0')
BIDS_EXTRACTED=$(echo "$COMMENT_RESULT" | jq -r '.bids_extracted // 0')

if [ "$COMMENTS_EXTRACTED" != "0" ] || [ "$BIDS_EXTRACTED" != "0" ]; then
  echo -e "${GREEN}✅ Comments and bids extracted${NC}"
  echo "  Comments: $COMMENTS_EXTRACTED"
  echo "  Bids: $BIDS_EXTRACTED"
else
  echo -e "${YELLOW}⚠️  No comments/bids extracted (may be normal for some listings)${NC}"
fi

echo ""
echo -e "${GREEN}✅ Complete! Vehicle fully extracted.${NC}"
echo ""
echo "View vehicle: ${SUPABASE_URL%/}/vehicle/${VEHICLE_ID}"
echo ""

