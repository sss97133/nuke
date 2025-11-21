#!/bin/bash

# Verify that detailed extraction is working in classifications

SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"

if [ -f .env.local ]; then
  SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d '=' -f2 | tr -d '"' | tr -d "'" | head -1)
else
  SERVICE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-""}
fi

if [ -z "$SERVICE_KEY" ]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY not found"
  exit 1
fi

echo "🔍 Checking extraction quality for recent classifications..."
echo ""

# Query recent classifications
response=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/check_extraction_quality" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SERVICE_KEY}" \
  -d '{"hours": 1}')

# If RPC doesn't exist, use direct query
if [[ "$response" == *"does not exist"* ]] || [[ -z "$response" ]]; then
  echo "Using direct SQL query..."
  
  # Create a simple check query
  echo "Recent classifications (last hour):"
  echo "Checking for extracted_tags, colors, materials, brands, features..."
  echo ""
  
  # We'll need to check via SQL directly
  echo "Run this SQL query to check:"
  echo ""
  echo "SELECT"
  echo "  COUNT(*) as total_recent,"
  echo "  COUNT(*) FILTER (WHERE raw_classification::text LIKE '%extracted_tags%') as has_tags,"
  echo "  COUNT(*) FILTER (WHERE raw_classification::text LIKE '%colors%') as has_colors,"
  echo "  COUNT(*) FILTER (WHERE raw_classification::text LIKE '%materials%') as has_materials,"
  echo "  COUNT(*) FILTER (WHERE raw_classification::text LIKE '%brands%') as has_brands,"
  echo "  COUNT(*) FILTER (WHERE raw_classification::text LIKE '%features%') as has_features"
  echo "FROM ai_angle_classifications_audit"
  echo "WHERE created_at > NOW() - INTERVAL '1 hour';"
else
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
fi

