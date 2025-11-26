#!/bin/bash

# Start BAT Scraping - Run this to start/resume scraping
# This script runs the scraping and sets up automation

cd "$(dirname "$0")/.."

echo "🚀 Starting BAT Scraping System"
echo "================================"
echo ""

# Load environment
export $(cat .env 2>/dev/null | grep -v '^#' | xargs)

# Run immediate scrape
echo "📡 Running immediate scrape..."
node scripts/run-bat-scrape-with-notifications.js

echo ""
echo "✅ Immediate scrape complete!"
echo ""
echo "📋 To set up automated scraping (every 6 hours):"
echo "  1. Add to crontab:"
echo "     0 */6 * * * cd $(pwd) && node scripts/run-bat-scrape-with-notifications.js >> /tmp/bat-scrape.log 2>&1"
echo ""
echo "  2. Or use the edge function (if deployed):"
echo "     curl -X POST \"https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller\" \\"
echo "       -H \"Authorization: Bearer \$VITE_SUPABASE_SERVICE_ROLE_KEY\" \\"
echo "       -H \"Content-Type: application/json\" \\"
echo "       -d '{\"sellerUsername\":\"VivaLasVegasAutos\",\"organizationId\":\"c433d27e-2159-4f8c-b4ae-32a5e44a77cf\"}'"
echo ""

