#!/bin/bash

# Deploy Supabase Edge Functions
# Project: qkgaybvrernstplzjaam

echo "🚀 Deploying Supabase Edge Functions"
echo ""

# Check if logged in
if ! supabase projects list &> /dev/null; then
  echo "❌ Not logged in to Supabase CLI"
  echo ""
  echo "Please login first:"
  echo "  supabase login"
  echo ""
  echo "Or set access token:"
  echo "  export SUPABASE_ACCESS_TOKEN='your-token-here'"
  echo ""
  exit 1
fi

# Deploy scrape-vehicle function (now with Craigslist support!)
echo "📦 Deploying scrape-vehicle function..."
supabase functions deploy scrape-vehicle --project-ref qkgaybvrernstplzjaam

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Deployment complete!"
  echo ""
  echo "Function URL:"
  echo "  https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle"
  echo ""
  echo "Now supports:"
  echo "  ✓ Bring a Trailer (bringatrailer.com)"
  echo "  ✓ Craigslist (craigslist.org) - NEW!"
  echo "  ✓ Image extraction from both platforms"
  echo ""
  echo "Test with curl:"
  echo '  curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle" \'
  echo '    -H "Authorization: Bearer YOUR_ANON_KEY" \'
  echo '    -H "Content-Type: application/json" \'
  echo '    -d '"'"'{"url": "https://sandiego.craigslist.org/esd/cto/d/el-centro-1972-gmc-suburban/7888155474.html"}'"'"
  echo ""
else
  echo ""
  echo "❌ Deployment failed"
  exit 1
fi

