#!/bin/bash

# Trigger BAT Scrape via Supabase pg_cron (if set up)
# Or manually trigger the edge function

cd "$(dirname "$0")/.."

# Load environment variables
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
SERVICE_KEY="${VITE_SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY}}"

if [ -z "$SERVICE_KEY" ]; then
  echo "❌ Error: SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY not found"
  exit 1
fi

echo "🚀 Triggering BAT scrape via Supabase edge function..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${SUPABASE_URL}/functions/v1/monitor-bat-seller" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"sellerUsername":"VivaLasVegasAutos","organizationId":"c433d27e-2159-4f8c-b4ae-32a5e44a77cf"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 202 ]; then
  echo "✅ Success! (HTTP $HTTP_CODE)"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
  echo "❌ Failed (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi

