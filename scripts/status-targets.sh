#!/bin/bash
# Print current extraction state vs defined targets. Run this before starting
# long-running extraction or cron so we're not "just turning on tools."
#
# Usage: ./scripts/status-targets.sh
#   or:  npm run status:targets

set -e
cd /Users/skylar/nuke

echo "=== Extraction targets (see docs/EXTRACTION_TARGETS.md) ==="
echo ""

# Prefer org-extraction-coverage edge function (has bat_listings + queue_pending + target)
dotenvx run --quiet -- bash -c '
  resp=$(curl -s "$VITE_SUPABASE_URL/functions/v1/org-extraction-coverage?all=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" 2>/dev/null)
  if echo "$resp" | jq -e ".sources" >/dev/null 2>&1; then
    echo "$resp" | jq -r ".sources[] | \"\(.label): extracted=\(.extracted // 0) pending=\(.queue_pending // 0) target=\(.target // \"-\")\""
    echo ""
    echo "Run verified extraction when BaT (or verified sources) pending > 0."
    exit 0
  fi
  # Fallback: no edge function, show note
  echo "org-extraction-coverage not available. Pending/complete from import_queue (sample):"
  curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?select=status&limit=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range || true
' 2>/dev/null || echo "Could not fetch (check .env and Supabase)."

echo ""
echo "Targets: BaT bat_listings = 222,000 (only BaT has a numeric target in code)."
