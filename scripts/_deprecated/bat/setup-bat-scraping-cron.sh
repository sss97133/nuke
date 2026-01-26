#!/bin/bash

# Setup Automated BAT Scraping
# Sets up cron job to monitor BAT sellers every 6 hours

echo "🔧 Setting up automated BAT scraping..."

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

VIVA_ORG_ID="c433d27e-2159-4f8c-b4ae-32a5e44a77cf"
BAT_SELLER="VivaLasVegasAutos"
SUPABASE_URL="${VITE_SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}"
SERVICE_KEY="${VITE_SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY}}"

if [ -z "$SERVICE_KEY" ]; then
  echo "❌ Error: SUPABASE_SERVICE_ROLE_KEY not found in environment"
  exit 1
fi

# Create cron job entry
CRON_ENTRY="0 */6 * * * curl -X POST \"${SUPABASE_URL}/functions/v1/monitor-bat-seller\" -H \"Authorization: Bearer ${SERVICE_KEY}\" -H \"Content-Type: application/json\" -d '{\"sellerUsername\":\"${BAT_SELLER}\",\"organizationId\":\"${VIVA_ORG_ID}\"}' >> /tmp/bat-scrape.log 2>&1"

echo ""
echo "📋 Cron job entry:"
echo "$CRON_ENTRY"
echo ""

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "monitor-bat-seller"; then
  echo "⚠️  Cron job already exists. Removing old entry..."
  crontab -l 2>/dev/null | grep -v "monitor-bat-seller" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "✅ Cron job installed!"
echo ""
echo "📅 Schedule: Every 6 hours (at :00 and :30 past the hour)"
echo "📝 Logs: /tmp/bat-scrape.log"
echo ""
echo "To view cron jobs:"
echo "  crontab -l"
echo ""
echo "To remove cron job:"
echo "  crontab -l | grep -v monitor-bat-seller | crontab -"
echo ""
echo "To test immediately:"
echo "  curl -X POST \"${SUPABASE_URL}/functions/v1/monitor-bat-seller\" \\"
echo "    -H \"Authorization: Bearer ${SERVICE_KEY}\" \\"
echo "    -H \"Content-Type: application/json\" \\"
echo "    -d '{\"sellerUsername\":\"${BAT_SELLER}\",\"organizationId\":\"${VIVA_ORG_ID}\"}'"

