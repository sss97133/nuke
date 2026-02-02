#!/bin/bash
#
# Specialty Builder Extraction Coordinator
#
# Self-healing autonomous extractor for specialty builder sites
# - Discovers inventory
# - Extracts with validation
# - Inspects and re-scrapes when fields are missing
# - Runs continuously with feedback loop
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Load environment
if [ -f .env ]; then
  export $(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|FIRECRAWL_API_KEY|OLLAMA_URL)=' | xargs)
fi

SUPABASE_URL="${VITE_SUPABASE_URL}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
FUNCTION_URL="${SUPABASE_URL}/functions/v1/extract-specialty-builder"

# Specialty builders to process
BUILDERS=(
  "https://www.velocityrestorations.com/for-sale/"
  "https://kindredmotorworks.com/for-sale"
)

echo "🏗️  Specialty Builder Extraction Coordinator"
echo "================================================"
echo ""
echo "Mode: Self-healing extraction with validation"
echo "Builders: ${#BUILDERS[@]}"
echo "Function: $FUNCTION_URL"
echo ""

# Check Ollama availability
echo "Checking Ollama availability..."
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
if curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
  echo "✅ Ollama available at $OLLAMA_URL"
else
  echo "⚠️  Ollama not available - starting Ollama..."
  ollama serve > /dev/null 2>&1 &
  sleep 3
fi

echo ""
echo "🔍 Phase 1: Inventory Discovery"
echo "================================"

for builder_url in "${BUILDERS[@]}"; do
  echo ""
  echo "Discovering: $builder_url"

  response=$(curl -sf -X POST "$FUNCTION_URL" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"url\": \"$builder_url\",
      \"action\": \"discover_inventory\"
    }" 2>&1 || echo '{"success": false, "error": "Request failed"}')

  success=$(echo "$response" | jq -r '.success // false')

  if [ "$success" = "true" ]; then
    discovered=$(echo "$response" | jq -r '.discovered // 0')
    echo "  ✅ Discovered: $discovered listings"
  else
    error=$(echo "$response" | jq -r '.error // "Unknown error"')
    echo "  ⚠️  Discovery failed: $error"
    echo "  Continuing with known listings..."
  fi
done

echo ""
echo "🚀 Phase 2: Extraction with Validation"
echo "======================================="

# Get pending items from import_queue for specialty builders
pending_query="
SELECT
  iq.id,
  iq.listing_url,
  iq.attempts,
  ss.name as source_name
FROM import_queue iq
LEFT JOIN scrape_sources ss ON iq.source_id = ss.id
WHERE iq.status IN ('pending', 'failed')
  AND (
    iq.listing_url LIKE '%velocityrestorations.com%'
    OR iq.listing_url LIKE '%kindredmotorworks.com%'
    OR iq.listing_url LIKE '%singervehicledesign.com%'
    OR iq.listing_url LIKE '%ruf-automobile.de%'
    OR iq.listing_url LIKE '%brabus.com%'
    OR iq.listing_url LIKE '%coolnvintage.com%'
  )
  AND iq.attempts < iq.max_attempts
ORDER BY iq.priority DESC, iq.created_at
LIMIT 20;
"

echo ""
echo "Querying pending extractions..."

pending=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
  -h aws-0-us-west-1.pooler.supabase.com \
  -p 6543 \
  -U postgres.qkgaybvrernstplzjaam \
  -d postgres \
  -t -A -F'|' \
  -c "$pending_query" 2>/dev/null || echo "")

if [ -z "$pending" ]; then
  echo "No pending specialty builder extractions found."
  echo ""
  echo "To add listings manually:"
  echo "  1. Add URLs to import_queue"
  echo "  2. Run this script again"
  exit 0
fi

echo "Found pending extractions:"
echo "$pending" | while IFS='|' read -r queue_id url attempts source_name; do
  echo "  - $url (attempts: $attempts)"
done

echo ""
echo "Processing extractions..."

extracted_count=0
failed_count=0
healed_count=0

echo "$pending" | while IFS='|' read -r queue_id url attempts source_name; do
  echo ""
  echo "Extracting: $url"
  echo "  Queue ID: $queue_id"
  echo "  Attempt: $((attempts + 1))"

  response=$(curl -sf -X POST "$FUNCTION_URL" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"url\": \"$url\",
      \"action\": \"extract\",
      \"queue_id\": \"$queue_id\"
    }" 2>&1 || echo '{"success": false, "error": "Request failed"}')

  success=$(echo "$response" | jq -r '.success // false')

  if [ "$success" = "true" ]; then
    is_valid=$(echo "$response" | jq -r '.validation.is_valid // false')
    missing_fields=$(echo "$response" | jq -r '.validation.missing_fields[]?' 2>/dev/null | tr '\n' ',' | sed 's/,$//')
    quality=$(echo "$response" | jq -r '.validation.quality_score // 0')

    if [ "$is_valid" = "true" ]; then
      echo "  ✅ Extraction complete (quality: $quality)"
      extracted_count=$((extracted_count + 1))
    else
      echo "  ⚠️  Extraction incomplete (quality: $quality)"
      echo "  Missing fields: $missing_fields"

      # Trigger self-healing
      echo "  🔧 Triggering self-heal..."
      heal_response=$(curl -sf -X POST "$FUNCTION_URL" \
        -H "Authorization: Bearer $SUPABASE_KEY" \
        -H "Content-Type: application/json" \
        -d "{
          \"url\": \"$url\",
          \"action\": \"self_heal\",
          \"queue_id\": \"$queue_id\"
        }" 2>&1 || echo '{"success": false}')

      heal_success=$(echo "$heal_response" | jq -r '.success // false')
      if [ "$heal_success" = "true" ]; then
        echo "  ✅ Self-heal complete"
        healed_count=$((healed_count + 1))
      else
        echo "  ❌ Self-heal failed"
        failed_count=$((failed_count + 1))
      fi
    fi
  else
    error=$(echo "$response" | jq -r '.error // "Unknown error"')
    echo "  ❌ Extraction failed: $error"
    failed_count=$((failed_count + 1))
  fi

  # Rate limit
  sleep 2
done

echo ""
echo "================================================"
echo "📊 Extraction Summary"
echo "================================================"
echo "  Extracted: $extracted_count"
echo "  Self-healed: $healed_count"
echo "  Failed: $failed_count"
echo ""
echo "✅ Coordinator run complete"
echo ""
echo "To run continuously:"
echo "  watch -n 300 $0"
