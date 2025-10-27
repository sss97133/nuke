#!/bin/bash

echo "🚀 DEPLOYING COMPLETE VEHICLE TRANSACTION + SHIPPING SYSTEM"
echo "============================================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Step 1: Deploying Database Migrations${NC}"
echo "--------------------------------------"
supabase db push

if [ $? -ne 0 ]; then
  echo -e "${YELLOW}⚠️  Database migration failed. Check Supabase connection.${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Database migrations applied${NC}"
echo ""

echo -e "${BLUE}Step 2: Deploying Transaction Edge Functions${NC}"
echo "----------------------------------------------"
supabase functions deploy create-vehicle-transaction-checkout --no-verify-jwt
supabase functions deploy generate-transaction-documents --no-verify-jwt
supabase functions deploy send-transaction-sms --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt

echo -e "${GREEN}✅ Transaction functions deployed${NC}"
echo ""

echo -e "${BLUE}Step 3: Deploying Shipping Edge Functions${NC}"
echo "------------------------------------------"
supabase functions deploy create-shipping-listing --no-verify-jwt
supabase functions deploy centraldispatch-oauth-callback --no-verify-jwt
supabase functions deploy centraldispatch-webhook --no-verify-jwt
supabase functions deploy get-centraldispatch-auth-url --no-verify-jwt

echo -e "${GREEN}✅ Shipping functions deployed${NC}"
echo ""

echo -e "${BLUE}Step 4: Verifying Deployments${NC}"
echo "-----------------------------"
echo "Deployed functions:"
supabase functions list

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "Next steps:"
echo "1. Visit https://n-zero.dev to see changes"
echo "2. Test transaction flow with test vehicle"
echo "3. When Central Dispatch credentials arrive:"
echo "   - Add to Supabase secrets"
echo "   - Visit /admin/shipping-settings"
echo "   - Click 'Connect Central Dispatch'"
echo ""
echo "🎉 Your complete vehicle marketplace platform is ready!"

