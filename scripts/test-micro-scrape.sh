#!/bin/bash
# Quick test script for micro-scrape-bandaid

SUPABASE_URL="${SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

if [ -z "$SERVICE_KEY" ]; then
  echo "❌ SUPABASE_SERVICE_ROLE_KEY not set"
  exit 1
fi

echo "🧪 Testing micro-scrape-bandaid (dry run)..."
echo ""

curl -X POST "${SUPABASE_URL}/functions/v1/micro-scrape-bandaid" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": true,
    "batch_size": 10,
    "max_runtime_ms": 10000
  }' | jq '.'

echo ""
echo "✅ Test complete!"

