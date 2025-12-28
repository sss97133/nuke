#!/bin/bash
# Quick script to extract inventory for organizations
# Uses the known Supabase URL and prompts for service role key if not set

SUPABASE_URL="${SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}"

if [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "❌ SUPABASE_SERVICE_ROLE_KEY not set"
  echo ""
  echo "Get it from: Supabase Dashboard → Project Settings → API → service_role key"
  echo ""
  echo "Then run:"
  echo "  export SUPABASE_SERVICE_ROLE_KEY='your-key-here'"
  echo "  $0"
  exit 1
fi

# Default parameters
LIMIT="${1:-10}"
OFFSET="${2:-0}"
THRESHOLD="${3:-1}"
DRY_RUN="${4:-false}"

echo "🚀 Extracting inventory for organizations..."
echo "   Limit: $LIMIT"
echo "   Offset: $OFFSET"
echo "   Threshold: $THRESHOLD"
echo "   Dry run: $DRY_RUN"
echo ""

curl -X POST "${SUPABASE_URL}/functions/v1/extract-all-orgs-inventory" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -d "{
    \"limit\": ${LIMIT},
    \"offset\": ${OFFSET},
    \"min_vehicle_threshold\": ${THRESHOLD},
    \"dry_run\": ${DRY_RUN}
  }" | jq '.'


