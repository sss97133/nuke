#!/bin/bash

# Setup BAT Seller Monitor for Viva! Las Vegas Autos
# This will monitor their BAT profile for new listings

echo "Setting up BAT seller monitor for Viva! Las Vegas Autos..."

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Viva organization ID
VIVA_ORG_ID="c433d27e-2159-4f8c-b4ae-32a5e44a77cf"
BAT_SELLER="VivaLasVegasAutos"

echo "Organization ID: $VIVA_ORG_ID"
echo "BAT Seller: $BAT_SELLER"

# Create monitor record via Supabase API
curl -X POST "${VITE_SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}/rest/v1/bat_seller_monitors" \
  -H "apikey: ${VITE_SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY}}" \
  -H "Authorization: Bearer ${VITE_SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY}}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "{
    \"organization_id\": \"$VIVA_ORG_ID\",
    \"seller_username\": \"$BAT_SELLER\",
    \"seller_url\": \"https://bringatrailer.com/member/$BAT_SELLER/\",
    \"is_active\": true,
    \"check_frequency_hours\": 6
  }"

echo ""
echo "✅ Monitor setup complete!"
echo ""
echo "To test the monitor, run:"
echo "  supabase functions invoke monitor-bat-seller --data '{\"sellerUsername\":\"$BAT_SELLER\",\"organizationId\":\"$VIVA_ORG_ID\"}'"
echo ""
echo "To set up a cron job (check every 6 hours), add to crontab:"
echo "  0 */6 * * * curl -X POST https://your-project.supabase.co/functions/v1/monitor-bat-seller -H \"Authorization: Bearer YOUR_ANON_KEY\" -d '{\"sellerUsername\":\"$BAT_SELLER\",\"organizationId\":\"$VIVA_ORG_ID\"}'"

