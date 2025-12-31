#!/bin/bash

# Test script for ingest-org-complete Edge Function
# Usage: ./scripts/test-ingest-org-complete.sh [url]

set -e

TEST_URL="${1:-https://www.velocityrestorations.com/}"
SUPABASE_URL="${SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}"
FUNCTION_URL="${SUPABASE_URL}/functions/v1/ingest-org-complete"

# Try to load from .env.local
if [ -f "nuke_frontend/.env.local" ]; then
  export $(grep -E "^VITE_SUPABASE_(URL|ANON_KEY)=" nuke_frontend/.env.local | sed 's/^VITE_/SUPABASE_/' | xargs)
fi

# Use SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_ANON_KEY}}"

if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "❌ Error: SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY must be set"
  echo ""
  echo "Set it in one of these ways:"
  echo "  1. Export in your shell: export SUPABASE_ANON_KEY=your-key"
  echo "  2. Set in nuke_frontend/.env.local: VITE_SUPABASE_ANON_KEY=your-key"
  exit 1
fi

echo "🧪 Testing ingest-org-complete Edge Function"
echo "============================================="
echo ""
echo "📍 URL: $TEST_URL"
echo "🔗 Function URL: $FUNCTION_URL"
echo ""

echo "📡 Calling Edge Function..."
echo ""

start_time=$(date +%s)

response=$(curl -s -w "\n%{http_code}" -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$TEST_URL\"}")

end_time=$(date +%s)
duration=$((end_time - start_time))

# Extract HTTP status code (last line) and body (everything else)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "⏱️  Duration: ${duration}s"
echo "📊 HTTP Status: $http_code"
echo ""

if [ "$http_code" != "200" ]; then
  echo "❌ Error Response:"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
  exit 1
fi

# Parse JSON response
if command -v jq &> /dev/null; then
  success=$(echo "$body" | jq -r '.success // false')
  
  if [ "$success" = "true" ]; then
    echo "✅ Success!"
    echo ""
    echo "📋 Results:"
    echo "$body" | jq -r '
      "   Organization ID: " + (.organization_id // "N/A"),
      "   Organization Name: " + (.organization_name // "N/A"),
      "   Vehicles Found: " + (.vehicles.found // 0 | tostring),
      "   Vehicles Inserted: " + (.vehicles.inserted // 0 | tostring),
      "   Vehicles Errors: " + (.vehicles.errors // 0 | tostring),
      "",
      "📊 Statistics:",
      "   Org Fields Extracted: " + (.stats.org_fields_extracted // 0 | tostring),
      "   Vehicles Found: " + (.stats.vehicles_found // 0 | tostring),
      "   Vehicles With Images: " + (.stats.vehicles_with_images // 0 | tostring)
    '
    
    org_name=$(echo "$body" | jq -r '.organization_name // "Unknown"')
    vehicles_inserted=$(echo "$body" | jq -r '.vehicles.inserted // 0')
    
    echo ""
    echo "✅ Test passed! Ingested $vehicles_inserted vehicles for $org_name"
  else
    echo "❌ Function returned success: false"
    echo "$body" | jq '.'
    exit 1
  fi
else
  # Fallback if jq is not available
  echo "📄 Response:"
  echo "$body"
  echo ""
  echo "💡 Install 'jq' for better formatted output"
fi

