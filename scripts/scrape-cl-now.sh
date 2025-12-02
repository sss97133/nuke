#!/bin/bash
# Trigger Craigslist scraper right now
# This will catch any new listings posted today

cd "$(dirname "$0")/.."

echo "🔍 Starting Craigslist scrape NOW..."
echo ""

SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | cut -d'=' -f2)

if [ -z "$SERVICE_KEY" ]; then
  echo "❌ ERROR: SUPABASE_SERVICE_ROLE_KEY not found in .env"
  exit 1
fi

echo "Scraping all regions (this will take 30-60 minutes)..."
echo "The function runs in Supabase's cloud, so you can close this terminal."
echo ""

curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"max_regions":100,"max_listings_per_search":100}' \
  | jq '.'

echo ""
echo "✅ Scraper triggered! It's running in the cloud now."
echo ""
echo "Check results later:"
echo "  SELECT COUNT(*) FROM vehicles WHERE DATE(created_at) = CURRENT_DATE AND discovery_source = 'craigslist_scrape';"

