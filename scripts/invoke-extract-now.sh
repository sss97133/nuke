#!/bin/bash
# Quick script to invoke extract-all-orgs-inventory function

SUPABASE_URL="${SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "❌ SUPABASE_SERVICE_ROLE_KEY not set"
  echo ""
  echo "Get it from: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api"
  echo ""
  echo "Then run:"
  echo "  export SUPABASE_SERVICE_ROLE_KEY='your-key-here'"
  echo "  ./scripts/invoke-extract-now.sh"
  exit 1
fi

LIMIT="${1:-10}"
OFFSET="${2:-0}"

echo "🚀 Invoking extract-all-orgs-inventory"
echo "   Limit: $LIMIT"
echo "   Offset: $OFFSET"
echo ""

curl -X POST "${SUPABASE_URL}/functions/v1/extract-all-orgs-inventory" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"limit\": ${LIMIT},
    \"offset\": ${OFFSET},
    \"min_vehicle_threshold\": 1,
    \"dry_run\": false
  }" | jq '.'

