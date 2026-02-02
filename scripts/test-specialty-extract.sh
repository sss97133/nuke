#!/bin/bash
#
# Test specialty builder extraction on a single URL
#

set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -eq 0 ]; then
  echo "Usage: $0 <url>"
  echo ""
  echo "Examples:"
  echo "  $0 https://www.velocityrestorations.com/for-sale/"
  echo "  $0 https://kindredmotorworks.com/for-sale"
  exit 1
fi

URL="$1"

export $(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | xargs)

FUNCTION_URL="${VITE_SUPABASE_URL}/functions/v1/extract-specialty-builder"

echo "🔍 Testing specialty builder extraction"
echo "========================================"
echo "URL: $URL"
echo ""

echo "Calling extractor..."
response=$(curl -sf -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$URL\", \"action\": \"extract\"}" 2>&1)

success=$(echo "$response" | jq -r '.success // false')

if [ "$success" = "true" ]; then
  echo ""
  echo "✅ Extraction successful"
  echo ""
  echo "$response" | jq '{
    duration_ms: .duration_ms,
    scrape_method: .scrape_method,
    data: {
      title: .data.title,
      year: .data.year,
      make: .data.make,
      model: .data.model,
      vin: .data.vin,
      chassis_number: .data.chassis_number,
      price: .data.price,
      builder: .data.builder,
      description_length: (.data.description | length),
      timeline_events: (.data.timeline_events | length),
      image_count: (.data.image_urls | length),
      confidence: .data.confidence
    },
    validation: {
      is_valid: .validation.is_valid,
      quality_score: .validation.quality_score,
      missing_fields: .validation.missing_fields,
      needs_rescrape: .validation.needs_rescrape
    }
  }'
else
  echo "❌ Extraction failed"
  echo ""
  echo "$response" | jq '.'
  exit 1
fi
