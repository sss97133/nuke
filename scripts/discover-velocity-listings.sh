#!/bin/bash
#
# Discover actual vehicle listings from Velocity Restorations
# Uses their API or scrapes listing pages to find individual vehicles
#

set -euo pipefail

cd "$(dirname "$0")/.."

export $(dotenvx run -- env | grep -E '^(FIRECRAWL_API_KEY)=' | xargs)

echo "🔍 Discovering Velocity Restorations listings..."
echo ""

# Method 1: Try their sold inventory (restorations page)
echo "Method 1: Checking sold inventory..."
SOLD_URLS=$(curl -sf "https://www.velocityrestorations.com/restorations/" -H "User-Agent: Mozilla/5.0" \
  | grep -oE 'href="/restorations/[a-z0-9-]+"' \
  | sed 's/href="//g' | sed 's/"//g' \
  | sort -u \
  | head -10)

if [ -n "$SOLD_URLS" ]; then
  echo "Found sold listings:"
  echo "$SOLD_URLS" | while read path; do
    echo "  - https://www.velocityrestorations.com$path"
  done
else
  echo "  No sold listings found via direct scrape"
fi

echo ""
echo "Method 2: Common URL patterns..."
# Try common patterns based on their site structure
TEST_URLS=(
  "https://www.velocityrestorations.com/restorations/1967-ford-bronco"
  "https://www.velocityrestorations.com/restorations/1971-ford-bronco"
  "https://www.velocityrestorations.com/restorations/1970-chevy-c10"
  "https://www.velocityrestorations.com/for-sale/1967-ford-bronco"
  "https://www.velocityrestorations.com/vehicles/1967-ford-bronco"
)

echo "Testing URL patterns..."
for url in "${TEST_URLS[@]}"; do
  status=$(curl -sf -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    echo "  ✅ Found: $url"
  else
    echo "  ❌ Not found: $url (status: $status)"
  fi
done

echo ""
echo "Method 3: Using Firecrawl to discover structure..."
# Use Firecrawl to get full rendered page
if [ -n "${FIRECRAWL_API_KEY:-}" ]; then
  echo "Scraping with Firecrawl..."

  MARKDOWN=$(curl -sf "https://api.firecrawl.dev/v1/scrape" \
    -X POST \
    -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://www.velocityrestorations.com/for-sale/",
      "formats": ["markdown"],
      "onlyMainContent": false,
      "waitFor": 3000
    }' 2>/dev/null | jq -r '.data.markdown' 2>/dev/null)

  if [ -n "$MARKDOWN" ]; then
    echo "Extracted links from Firecrawl:"
    echo "$MARKDOWN" | grep -oE 'https://www\.velocityrestorations\.com/[a-z0-9/-]+' | sort -u | head -10
  else
    echo "  Firecrawl returned no data"
  fi
else
  echo "  FIRECRAWL_API_KEY not set, skipping"
fi

echo ""
echo "✅ Discovery complete"
echo ""
echo "Next steps:"
echo "  1. Add found URLs to import_queue"
echo "  2. Run coordinator to extract them"
