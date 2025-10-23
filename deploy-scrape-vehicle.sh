#!/bin/bash

# Deploy scrape-vehicle function to Supabase
# This function now supports both Bring a Trailer and Craigslist listings
# and can extract images from both platforms

echo "🚀 Deploying scrape-vehicle function..."
echo ""
echo "This function now supports:"
echo "  ✓ Bring a Trailer (bringatrailer.com)"
echo "  ✓ Craigslist (craigslist.org)"
echo "  ✓ Image extraction from both platforms"
echo ""

# Check if supabase CLI is logged in
if ! supabase projects list &> /dev/null; then
  echo "❌ Not logged in to Supabase CLI"
  echo ""
  echo "Please run: supabase login"
  echo ""
  exit 1
fi

# Deploy the function
supabase functions deploy scrape-vehicle

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Test with:"
echo '  curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/scrape-vehicle" \'
echo '    -H "Authorization: Bearer YOUR_ANON_KEY" \'
echo '    -H "Content-Type: application/json" \'
echo '    -d "{\"url\": \"https://sandiego.craigslist.org/esd/cto/d/el-centro-1972-gmc-suburban/7888155474.html\"}"'
echo ""

