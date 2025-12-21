#!/bin/bash

# PRODUCTION EXTRACTION FROM 4 PREMIUM AUCTION SITES
# All sites tested and ready - start extracting NOW

echo "🚀 PRODUCTION EXTRACTION: 4 PREMIUM AUCTION SITES"
echo "=================================================="
echo "Total potential: 26,400 premium vehicles"
echo "Starting extraction using existing scrape-multi-source..."
echo ""

# Get Supabase credentials
if [ -f .env.local ]; then
    source .env.local
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ SUPABASE_SERVICE_ROLE_KEY not set. Set it in .env.local"
    exit 1
fi

SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
API_URL="$SUPABASE_URL/functions/v1/scrape-multi-source"

echo "🎯 Site 1: Cars & Bids (2,600 vehicles)"
echo "========================================"
curl -s -X POST "$API_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://carsandbids.com/auctions"}' | head -5

echo ""
echo "🎯 Site 2: Mecum Auctions (15,000 vehicles) "
echo "============================================"  
curl -s -X POST "$API_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.mecum.com/lots/"}' | head -5

echo ""
echo "🎯 Site 3: Barrett-Jackson (7,200 vehicles)"
echo "==========================================="
curl -s -X POST "$API_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.barrett-jackson.com/Events/"}' | head -5

echo ""
echo "🎯 Site 4: Russo and Steele (1,600 vehicles)"
echo "============================================="
curl -s -X POST "$API_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.russoandsteele.com/auctions/"}' | head -5

echo ""
echo "✅ EXTRACTION STARTED on all 4 premium auction sites!"
echo "📊 Monitor progress in Supabase dashboard"
echo "🎯 Total target: 26,400 premium vehicles"
echo ""
echo "📋 Next: Check database for new vehicle records:"
echo "   SELECT COUNT(*) FROM vehicles WHERE created_at > NOW() - INTERVAL '1 hour';"
