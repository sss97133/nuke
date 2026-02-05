#!/bin/bash
#
# DAILY AUCTION DISCOVERY
# Runs every day to discover and queue NEW listings from ALL auction sources
#
# Sources covered:
# - Gooding & Company
# - RM Sotheby's (all active auctions)
# - Bonhams
# - Mecum
# - Barrett-Jackson
# - Collecting Cars
# - Cars & Bids
# - PCarMarket
# - Broad Arrow
# - Hagerty Marketplace
#
# Run via cron: 0 */4 * * * /Users/skylar/nuke/scripts/daily-auction-discovery.sh
#

set -euo pipefail
cd /Users/skylar/nuke

export $(dotenvx run -- env 2>/dev/null | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | xargs)

SUPABASE_URL="$VITE_SUPABASE_URL"
SUPABASE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
LOG="/Users/skylar/nuke/logs/daily-discovery-$(date +%Y%m%d).log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

call_extractor() {
  local name="$1"
  local payload="$2"
  local timeout="${3:-300}"

  log "  → $name"
  result=$(curl -sf -X POST "$SUPABASE_URL/functions/v1/$name" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --max-time "$timeout" 2>&1 || echo '{"error":"timeout or failed"}')

  # Extract count if available
  count=$(echo "$result" | jq -r '.total // .count // .processed // .vehicles | length // "?"' 2>/dev/null)
  log "    ✓ $count items"
}

log "═══════════════════════════════════════════════════════════"
log "  DAILY AUCTION DISCOVERY - $(date)"
log "═══════════════════════════════════════════════════════════"

# 1. GOODING - 9K+ historical lots
log ""
log "🏛️  GOODING & COMPANY"
call_extractor "extract-gooding" '{"action":"batch","limit":500,"save_to_db":true}' 600

# 2. RM SOTHEBY'S - All recent/upcoming auctions
log ""
log "🏛️  RM SOTHEBY'S"
# Get auction list first
auctions=$(curl -sf -X POST "$SUPABASE_URL/functions/v1/extract-rmsothebys" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"list"}' --max-time 30 2>/dev/null | jq -r '.auctions[].code' 2>/dev/null | head -10)

for auction in $auctions; do
  call_extractor "extract-rmsothebys" "{\"action\":\"process\",\"auction\":\"$auction\",\"save_to_db\":true}" 300
done

# 3. BONHAMS
log ""
log "🏛️  BONHAMS"
call_extractor "extract-bonhams" '{"action":"discover","save_to_db":true}' 300

# 4. COLLECTING CARS
log ""
log "🏛️  COLLECTING CARS"
call_extractor "extract-collecting-cars-simple" '{"batch_size":200}' 300

# 5. CARS & BIDS - Discover active auctions
log ""
log "🏎️  CARS & BIDS"
# Queue any C&B vehicles missing data for Playwright extraction
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
INSERT INTO import_queue (listing_url, listing_title, status, priority)
SELECT DISTINCT
    v.discovery_url,
    v.title,
    'pending',
    9  -- high priority for live auctions
FROM vehicles v
WHERE v.discovery_url LIKE '%carsandbids.com%'
  AND (v.vin IS NULL OR v.sale_price IS NULL)
  AND v.discovery_url NOT IN (SELECT listing_url FROM import_queue WHERE listing_url IS NOT NULL)
LIMIT 500
ON CONFLICT DO NOTHING;" 2>/dev/null
log "    ✓ Queued C&B for Playwright"

# 6. PCARMARKET
log ""
log "🏎️  PCARMARKET"
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
INSERT INTO import_queue (listing_url, listing_title, status, priority)
SELECT DISTINCT
    v.discovery_url,
    v.title,
    'pending',
    8
FROM vehicles v
WHERE v.discovery_url LIKE '%pcarmarket.com%'
  AND v.sale_price IS NULL
  AND v.discovery_url NOT IN (SELECT listing_url FROM import_queue WHERE listing_url IS NOT NULL)
LIMIT 500
ON CONFLICT DO NOTHING;" 2>/dev/null
log "    ✓ Queued PCarMarket"

# 7. MECUM - Crawl active auctions
log ""
log "🏛️  MECUM"
call_extractor "extract-vehicle-data-ai" '{"source":"mecum","discover":true,"limit":200}' 300 || log "    ⚠️  Mecum discovery needs setup"

# 8. HAGERTY MARKETPLACE
log ""
log "🏎️  HAGERTY MARKETPLACE"
call_extractor "extract-hagerty-listing" '{"action":"discover","limit":200}' 300 || log "    ⚠️  Hagerty needs Firecrawl"

# 9. BaT - Discover new listings (sitemap/archive)
log ""
log "🏎️  BRING A TRAILER (new listings)"
# BaT archive crawl for any we missed
call_extractor "extract-bat-core" '{"action":"discover_recent","limit":500}' 300 || true

# Summary
log ""
log "═══════════════════════════════════════════════════════════"
log "  DISCOVERY COMPLETE"
log "═══════════════════════════════════════════════════════════"

# Show queue status
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "
SELECT
    CASE
        WHEN listing_url LIKE '%bringatrailer%' THEN 'BaT'
        WHEN listing_url LIKE '%carsandbids%' THEN 'C&B'
        WHEN listing_url LIKE '%pcarmarket%' THEN 'PCar'
        WHEN listing_url LIKE '%goodingco%' THEN 'Gooding'
        WHEN listing_url LIKE '%rmsothebys%' THEN 'RMS'
        WHEN listing_url LIKE '%collectingcars%' THEN 'CC'
        ELSE 'Other'
    END as src,
    COUNT(*) FILTER (WHERE status='pending') as pending
FROM import_queue
GROUP BY src
HAVING COUNT(*) FILTER (WHERE status='pending') > 0
ORDER BY pending DESC;" 2>/dev/null | while read line; do
  log "  $line"
done

log ""
log "Next run: $(date -v+4H '+%Y-%m-%d %H:%M')"
