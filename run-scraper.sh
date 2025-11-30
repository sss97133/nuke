#!/bin/bash

# Run the Craigslist squarebody scraper
# Usage: ./run-scraper.sh [max_regions] [max_listings]

MAX_REGIONS=${1:-5}
MAX_LISTINGS=${2:-50}

echo "🚀 Starting Craigslist squarebody scraper..."
echo "   Regions: $MAX_REGIONS"
echo "   Max listings per search: $MAX_LISTINGS"
echo ""

# Get service key from environment or prompt
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "⚠️  SUPABASE_SERVICE_ROLE_KEY not set in environment"
  echo ""
  echo "Get it from: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api"
  echo "Then run:"
  echo "  export SUPABASE_SERVICE_ROLE_KEY='your-key-here'"
  echo "  ./run-scraper.sh $MAX_REGIONS $MAX_LISTINGS"
  echo ""
  exit 1
fi

echo "📡 Invoking function..."
echo ""

curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"max_regions\": $MAX_REGIONS,
    \"max_listings_per_search\": $MAX_LISTINGS,
    \"user_id\": null
  }" | python3 -m json.tool

echo ""
echo ""
echo "✅ Scraper triggered! Check logs:"
echo "https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions/scrape-all-craigslist-squarebodies/logs"

