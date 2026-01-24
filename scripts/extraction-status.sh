#!/bin/bash
# Quick status check for multi-source extraction system
cd /Users/skylar/nuke

echo "=== EXTRACTION SYSTEM STATUS ==="
echo "Time: $(date)"
echo ""

# Check if extractor is running
if pgrep -f "multi-source-extractor" > /dev/null; then
  echo "✓ Multi-source extractor: RUNNING"
else
  echo "✗ Multi-source extractor: STOPPED"
fi

# Check if Ralph is running
if pgrep -f "ralph-wiggum" > /dev/null; then
  echo "✓ Ralph loop: RUNNING"
else
  echo "✗ Ralph loop: STOPPED"
fi

echo ""
echo "=== QUEUE STATUS ==="
dotenvx run --quiet -- bash -c '
curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?select=status" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null | \
  jq -r 'group_by(.status) | map("\(.[0].status): \(length)") | .[]' 2>/dev/null || echo "Could not fetch queue"

echo ""
echo "=== RECENT EXTRACTIONS (last hour) ==="
dotenvx run --quiet -- bash -c '
curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?select=count&created_at=gte.now()-1hour" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact"' 2>/dev/null | jq -r '"Vehicles added: \(.[0].count // 0)"' 2>/dev/null

echo ""
echo "=== DATA QUALITY ==="
# Missing VINs (post-1981)
missing_vin=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?vin=is.null&year=gte.1981&bat_auction_url=not.is.null&select=count" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact"' 2>/dev/null | jq '.[0].count // 0')
echo "Missing VIN (post-1981 BaT): $missing_vin"

# Bad prices
bad_prices=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?sale_price=gt.0&sale_price=lt.100&bat_auction_url=not.is.null&select=count" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact"' 2>/dev/null | jq '.[0].count // 0')
echo "Suspicious prices (<$100): $bad_prices"

echo ""
echo "=== RECENT ERRORS ==="
dotenvx run --quiet -- bash -c '
curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.error&select=url,error_message&order=updated_at.desc&limit=3" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null | \
  jq -r '.[] | "  - \(.url | split("/")[-1]): \(.error_message | .[0:50])"' 2>/dev/null || echo "  None"

echo ""
echo "=== LOG TAILS ==="
echo "Multi-source (last 3 lines):"
tail -3 logs/multi-source-extractor.log 2>/dev/null | sed 's/^/  /'
echo ""
echo "Ralph (last 3 lines):"
tail -3 logs/ralph.log 2>/dev/null | sed 's/^/  /'
