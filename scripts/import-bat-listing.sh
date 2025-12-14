#!/bin/bash
set -euo pipefail

# Import a Bring a Trailer listing URL into Nuke via Supabase Edge Function:
# - Creates/updates the correct vehicle profile (URL/VIN matching)
# - Extracts auction data and writes to vehicle fields + timeline events
# - Scrapes ALL listing images and uploads them into Supabase Storage + vehicle_images (deduped)
#
# Usage:
#   ./scripts/import-bat-listing.sh "https://bringatrailer.com/listing/1977-gmc-jimmy-13/"
#
# Optional env vars:
#   SUPABASE_URL (or VITE_SUPABASE_URL)
#   SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_SERVICE_ROLE_KEY)
#   ORGANIZATION_ID (optional)
#   ALLOW_FUZZY_MATCH=true|false (default false)
#   IMAGE_BATCH_SIZE=50 (10..100)

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

ORG_ID="${ORGANIZATION_ID:-}"
ALLOW_FUZZY="${ALLOW_FUZZY_MATCH:-false}"
IMAGE_BATCH_SIZE="${IMAGE_BATCH_SIZE:-50}"

BODY=$(jq -n \
  --arg batUrl "$BAT_URL" \
  --arg organizationId "$ORG_ID" \
  --argjson allowFuzzyMatch "$( [ "$ALLOW_FUZZY" = "true" ] && echo true || echo false )" \
  --argjson imageBatchSize "$(echo "$IMAGE_BATCH_SIZE" | awk '{print ($1+0)}')" \
  '{
    batUrl: $batUrl,
    allowFuzzyMatch: $allowFuzzyMatch,
    imageBatchSize: $imageBatchSize
  }
  + (if ($organizationId | length) > 0 then { organizationId: $organizationId } else {} end)
  ')

echo "Calling import-bat-listing..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${SUPABASE_URL}/functions/v1/import-bat-listing" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "OK (HTTP $HTTP_CODE)"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
  echo "FAILED (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi


