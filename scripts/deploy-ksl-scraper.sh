#!/bin/bash
# Deploy KSL Playwright Scraper to Fly.io
# Run: ./scripts/deploy-ksl-scraper.sh

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Deploying KSL Playwright Scraper to Fly.io"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if fly CLI is installed
if ! command -v fly &> /dev/null; then
    echo "📦 Installing Fly.io CLI..."
    curl -L https://fly.io/install.sh | sh
    export FLYCTL_INSTALL="/Users/skylar/.fly"
    export PATH="$FLYCTL_INSTALL/bin:$PATH"
fi

# Login to Fly.io
echo "🔐 Logging in to Fly.io..."
fly auth login

# Launch/create app (if first time)
if ! fly status -a nuke-ksl-scraper &> /dev/null; then
    echo "📱 Creating new Fly.io app..."
    fly launch --dockerfile Dockerfile.ksl-scraper --name nuke-ksl-scraper --region sjc --no-deploy
fi

# Deploy
echo ""
echo "🚢 Deploying to Fly.io..."
fly deploy --dockerfile Dockerfile.ksl-scraper

# Get status
echo ""
echo "✅ Deployment complete!"
echo ""
fly status -a nuke-ksl-scraper

# Get URL
APP_URL=$(fly status -a nuke-ksl-scraper --json | jq -r '.Hostname')
FULL_URL="https://${APP_URL}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Next Steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Set Supabase secret:"
echo "   npx supabase secrets set PLAYWRIGHT_SERVICE_URL=${FULL_URL}"
echo ""
echo "2. Test service:"
echo "   curl -X POST ${FULL_URL}/health"
echo ""
echo "3. Test scraping:"
echo "   curl -X POST ${FULL_URL}/scrape-listing -H 'Content-Type: application/json' -d '{\"url\":\"https://cars.ksl.com/listing/10286857\"}'"
echo ""
echo "4. Get all 514 URLs:"
echo "   curl -X POST ${FULL_URL}/scrape-all-search -H 'Content-Type: application/json' -d '{\"max_pages\":25}' > data/ksl-all-listings.json"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ KSL Playwright Service: ${FULL_URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

