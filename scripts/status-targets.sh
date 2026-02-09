#!/bin/bash
# Print current extraction state vs defined targets. Run this before starting
# long-running extraction or cron so we're not "just turning on tools."
#
# Usage: ./scripts/status-targets.sh
#   or:  npm run status:targets

set -e
cd /Users/skylar/nuke

BAT_TARGET=222000

echo "=== Extraction targets (see docs/EXTRACTION_TARGETS.md) ==="
echo ""

dotenvx run --quiet -- bash -c '
  # BaT: bat_listings count (need RPC or vehicles count by discovery_source; fallback to import_queue complete for BaT)
  # We use import_queue counts: pending + complete for bringatrailer
  pending=$(curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?listing_url=ilike.%bringatrailer%&status=eq.pending&select=id" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed -n "s/.*\///p" | tr -d "\r\n")
  complete=$(curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?listing_url=ilike.%bringatrailer%&status=eq.complete&select=id" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed -n "s/.*\///p" | tr -d "\r\n")
  echo "BaT (bringatrailer):"
  echo "  queue pending:  ${pending:-?}"
  echo "  queue complete: ${complete:-?}"
  echo "  target (bat_listings): '"$BAT_TARGET"' (see org-extraction-coverage for live bat_listings count)"
  echo ""
  # Other sources: pending only
  for src in carsandbids pcarmarket collectingcars hagerty ksl; do
    pattern="%${src}%"
    count=$(curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?listing_url=ilike.${pattern}&status=eq.pending&select=id" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed -n "s/.*\///p" | tr -d "\r\n")
    echo "  ${src} pending: ${count:-0}"
  done
' 2>/dev/null || echo "Could not fetch (check .env and Supabase)."

echo ""
echo "Targets: BaT bat_listings = 222,000 (only BaT has a numeric target)."
echo "Run verified extraction when BaT (or verified sources) pending > 0."
