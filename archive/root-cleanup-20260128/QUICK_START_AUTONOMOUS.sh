#!/bin/bash
# Quick start script to kick off extraction before leaving

echo "🚀 Starting autonomous extraction..."
echo ""

# Get service role key
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY nuke_frontend/.env.local | cut -d '=' -f2)
BASE_URL="https://qkgaybvrernstplzjaam.supabase.co/functions/v1"

echo "1️⃣ Syncing all BaT live auctions (462 auctions)..."
curl -s -X POST "$BASE_URL/sync-active-auctions" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 500}' | jq '.success, .synced'

echo ""
echo "2️⃣ Extracting Cars & Bids active auctions..."
curl -s -X POST "$BASE_URL/extract-premium-auction" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://carsandbids.com/auctions", "site_type": "carsandbids", "max_vehicles": 50}' &
C_AND_B_PID=$!

echo ""
echo "3️⃣ Starting aggressive queue processing..."
curl -s -X POST "$BASE_URL/process-import-queue" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 100, "max_batches": 20, "fast_mode": true}' &
QUEUE_PID=$!

echo ""
echo "⏳ Background jobs started..."
echo "   - Cars & Bids extraction (PID: $C_AND_B_PID)"
echo "   - Queue processor (PID: $QUEUE_PID)"
echo ""
echo "✅ Initial extraction started!"
echo "📊 Crons will continue every 1-15 minutes while you're away"
echo ""
echo "To monitor progress:"
echo "  npx supabase db remote exec \"\$(cat scripts/monitor-autonomous-extraction.sql)\""
echo ""
echo "🎯 You can leave now - the cloud is grinding!"
