#!/bin/bash
#
# LIVE AUCTION PRIORITY
# Runs every HOUR to catch active/ending auctions
# These get priority 10 (highest) in the queue
#

cd /Users/skylar/nuke
export $(dotenvx run -- env 2>/dev/null | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | xargs)

echo "[$(date)] Checking live auctions..."

# Cars & Bids - ending soon
curl -sf "$VITE_SUPABASE_URL/functions/v1/extract-cars-and-bids-core" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"discover_live","priority":10}' --max-time 60 2>/dev/null || true

# RM Sotheby's - check for live/sealed auctions
curl -sf "$VITE_SUPABASE_URL/functions/v1/extract-rmsothebys" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"check_live","save_to_db":true}' --max-time 60 2>/dev/null || true

# Collecting Cars - live auctions
curl -sf "$VITE_SUPABASE_URL/functions/v1/extract-collecting-cars-simple" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"live_only":true,"batch_size":50}' --max-time 60 2>/dev/null || true

echo "[$(date)] Live auction check complete"
