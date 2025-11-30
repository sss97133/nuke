#!/bin/bash

# Quick script to trigger the squarebody scraper
# Get your service role key from: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api

echo "🚀 Triggering Craigslist squarebody scraper..."
echo ""

# Check if service key is provided
if [ -z "$1" ]; then
  echo "Usage: ./RUN_IT_NOW.sh YOUR_SERVICE_ROLE_KEY"
  echo ""
  echo "Get your key from:"
  echo "https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api"
  echo ""
  echo "Or use the Supabase Dashboard (easiest):"
  echo "https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions"
  exit 1
fi

SERVICE_KEY=$1
MAX_REGIONS=${2:-5}  # Default to 5 regions for test

echo "Regions: $MAX_REGIONS"
echo "Starting scrape..."
echo ""

curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"max_regions\": $MAX_REGIONS,
    \"max_listings_per_search\": 50,
    \"user_id\": null
  }" | python3 -m json.tool

echo ""
echo "✅ Scraper triggered! Check logs:"
echo "https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions/scrape-all-craigslist-squarebodies/logs"

