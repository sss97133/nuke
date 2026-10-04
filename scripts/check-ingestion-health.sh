#!/bin/bash
# Quick ingestion health check script
# Run: bash scripts/check-ingestion-health.sh

# Bounded C17 mode uses the existing read-only Management API path. It never
# invokes a consumer, model or intake writer. Other legacy modes stay separate.
if [ "${1:-}" = "--image-observations" ]; then
    shift
    exec node "$(dirname "$0")/check-image-observation-health.mjs" "$@"
fi

echo "🔍 INGESTION HEALTH CHECK"
echo "========================="
echo ""

# Check if we have Supabase CLI
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Install it first."
    exit 1
fi

echo "📊 Checking import_queue status..."
supabase db execute "
SELECT 
  status,
  COUNT(*) as count,
  COUNT(DISTINCT source_id) as sources
FROM import_queue
GROUP BY status;
"

echo ""
echo "📈 Recent vehicle creations (last 24h)..."
supabase db execute "
SELECT 
  discovery_source,
  COUNT(*) as vehicles
FROM vehicles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY discovery_source
ORDER BY vehicles DESC;
"

echo ""
echo "⚠️ Failed items (last 10)..."
supabase db execute "
SELECT 
  listing_url,
  error_message,
  attempts,
  created_at
FROM import_queue
WHERE status = 'failed'
ORDER BY processed_at DESC
LIMIT 10;
"

echo ""
echo "✅ Source health..."
supabase db execute "
SELECT 
  domain,
  last_scraped_at,
  last_successful_scrape,
  total_listings_found,
  is_active
FROM scrape_sources
WHERE is_active = true
ORDER BY last_scraped_at DESC NULLS LAST
LIMIT 10;
"

echo ""
echo "🔄 Cron job status..."
supabase db execute "
SELECT 
  jobname,
  active,
  schedule,
  last_run_status
FROM cron.job
WHERE jobname LIKE '%import%' OR jobname LIKE '%queue%';
"
