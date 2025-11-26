#!/bin/bash

# Deploy Auto-Buy Edge Functions
# Deploys execute-auto-buy and monitor-price-drops functions

set -e

echo "🚀 Deploying Auto-Buy Edge Functions"
echo "====================================="
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
  echo "❌ Supabase CLI is not installed"
  echo "Install it with: npm install -g supabase"
  exit 1
fi

# Check if logged in
if ! supabase projects list &> /dev/null; then
  echo "❌ Not logged in to Supabase CLI"
  echo ""
  echo "Please login first:"
  echo "  supabase login"
  echo ""
  exit 1
fi

PROJECT_REF="qkgaybvrernstplzjaam"

# Deploy execute-auto-buy function
echo "📦 Deploying execute-auto-buy function..."
if supabase functions deploy execute-auto-buy --project-ref $PROJECT_REF --no-verify-jwt; then
  echo "✅ execute-auto-buy deployed successfully!"
else
  echo "❌ Failed to deploy execute-auto-buy"
  exit 1
fi

echo ""

# Deploy monitor-price-drops function
echo "📦 Deploying monitor-price-drops function..."
if supabase functions deploy monitor-price-drops --project-ref $PROJECT_REF --no-verify-jwt; then
  echo "✅ monitor-price-drops deployed successfully!"
else
  echo "❌ Failed to deploy monitor-price-drops"
  exit 1
fi

echo ""
echo "✅ All functions deployed successfully!"
echo ""
echo "Function URLs:"
echo "  - execute-auto-buy: https://$PROJECT_REF.supabase.co/functions/v1/execute-auto-buy"
echo "  - monitor-price-drops: https://$PROJECT_REF.supabase.co/functions/v1/monitor-price-drops"
echo ""
echo "🧪 Test monitor-price-drops:"
echo "  curl -X POST \"https://$PROJECT_REF.supabase.co/functions/v1/monitor-price-drops\" \\"
echo "    -H \"Authorization: Bearer YOUR_ANON_KEY\" \\"
echo "    -H \"Content-Type: application/json\""
echo ""

