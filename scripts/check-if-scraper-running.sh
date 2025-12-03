#!/bin/bash
# Quick check if scraping is working

cd "$(dirname "$0")/.."

echo "🔍 Checking Scraper Status..."
echo ""

# Check vehicles created today
echo "📊 Vehicles created today:"
echo "SELECT COUNT(*), discovery_source FROM vehicles WHERE DATE(created_at) = CURRENT_DATE GROUP BY discovery_source;" | \
  psql "$(grep 'postgres://postgres' .env | grep -v '#' | head -1 | cut -d'=' -f2-)" 2>/dev/null || \
  echo "   Use Supabase Dashboard to run:"
echo "   SELECT COUNT(*), discovery_source FROM vehicles WHERE DATE(created_at) = CURRENT_DATE GROUP BY discovery_source;"
echo ""

# Check last 10 vehicles
echo "📋 Last 10 vehicles added:"
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | cut -d'=' -f2)

curl -s -X GET "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/vehicles?select=year,make,model,created_at,discovery_source&order=created_at.desc&limit=10" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" | jq -r '.[] | "\(.year) \(.make) \(.model) - \(.created_at) (\(.discovery_source))"' 2>/dev/null || echo "Failed to fetch"

echo ""
echo "✅ Done! If you see vehicles from today, scraper is working."
echo ""
echo "To apply infrastructure: node scripts/apply-scraper-infrastructure.js"
echo "To test system: node scripts/test-scraper-system.js"

