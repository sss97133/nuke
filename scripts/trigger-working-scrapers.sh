#!/bin/bash
# Quick script to trigger scrapers that we KNOW work to fill queues

set -e

# Load env vars
if [ -f .env.local ]; then source .env.local; fi
if [ -f nuke_frontend/.env.local ]; then source nuke_frontend/.env.local; fi

SUPABASE_URL=${SUPABASE_URL:-${VITE_SUPABASE_URL}}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY}}

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

echo "🚀 Triggering Working Scrapers to Fill Queues"
echo "=============================================="
echo ""

# 1. BaT scraper (go-grinder) - adds to bat_extraction_queue
echo "1. Triggering BaT scraper (go-grinder)..."
curl -sS -X POST "${SUPABASE_URL%/}/functions/v1/go-grinder" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"do_seed": true, "chain_depth": 3, "bat_import_batch": 5, "max_listings": 50}' \
  --max-time 60 | jq -r '.message // "Success"' | head -c 200
echo ""
echo ""

# 2. process-bat-extraction-queue (if queue has items)
echo "2. Processing bat_extraction_queue..."
curl -sS -X POST "${SUPABASE_URL%/}/functions/v1/process-bat-extraction-queue" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 3}' \
  --max-time 30 | jq -r '.message // .success // "Response received"' | head -c 200
echo ""
echo ""

echo "✅ Done! Check Supabase logs or queue tables to see results."
echo ""
echo "To check queue status, run:"
echo "  psql -h your-db-host -U postgres -d postgres -c \"SELECT status, COUNT(*) FROM bat_extraction_queue GROUP BY status;\""

