#!/bin/bash
# drive_reader.sh <url-file> <log.jsonl> [max=100000] [pace_s=2]
# Feeds lot URLs to the DEPLOYED extract-bat-core v4 (the web reader writes the rows and links; the
# page is fetched by the function from BaT, never uploaded from here). Serial, paced; every 25 calls
# a REST probe — stop if it stays above 3 s. Each result line: url, http, success, created/updated ids,
# auction summary, ms. Re-runs skip URLs already logged as success.
set -u
URLS=$1; LOG=$2; MAX=${3:-100000}; PACE=${4:-2}
cd /Users/skylar/nuke
touch "$LOG"
probe() { dotenvx run -q -- bash -c 'curl -s -o /dev/null --max-time 15 -w "%{time_total}" "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"'; }
n=0; ok=0; fail=0; slow=0
while IFS= read -r url; do
  [ -z "$url" ] && continue
  grep -qF "\"url\":\"$url\",\"success\":true" "$LOG" && continue
  n=$((n+1)); [ "$n" -gt "$MAX" ] && break
  if [ $((n % 25)) -eq 1 ]; then
    t=$(probe)
    if [ "$(echo "$t > 3" | bc -l)" = "1" ]; then
      slow=$((slow+1)); echo "$(date -u +%FT%TZ) probe ${t}s > 3s (strike $slow); pausing 120s" >&2; sleep 120
      [ "$slow" -ge 5 ] && { echo "STOPPING: prod stayed slow" >&2; exit 2; }
    fi
  fi
  s=$(date +%s%N)
  res=$(dotenvx run -q -- bash -c 'curl -s --max-time 180 -X POST "$VITE_SUPABASE_URL/functions/v1/extract-bat-core" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "$1"' _ "{\"url\":\"$url\",\"prefer_snapshot\":true}")
  ms=$(( ($(date +%s%N) - s)/1000000 ))
  line=$(echo "$res" | jq -c --arg url "$url" --argjson ms "$ms" '{url: $url, success: (.success // false), http_error: (.error // null), created: (.created_vehicle_ids // []), updated: (.updated_vehicle_ids // []), snapshot: (.snapshot // null), auction: (.auction // null), vin_rejected: (.vin_rejected // null), supersession: (.sale_supersession // null), timings: (.timings // null), comments_written: (.comments_written // null), bids_written: (.bids_written // null), ms: $ms}' 2>/dev/null || echo "{\"url\":\"$url\",\"success\":false,\"raw\":$(echo "$res" | head -c 300 | jq -Rs .),\"ms\":$ms}")
  echo "$line" >> "$LOG"
  if echo "$line" | jq -e '.success' >/dev/null; then ok=$((ok+1)); else fail=$((fail+1)); echo "$(date -u +%FT%TZ) FAIL $url: $(echo "$line" | cut -c1-200)" >&2; fi
  [ $((n % 25)) -eq 0 ] && echo "$(date -u +%FT%TZ) $n called, $ok ok, $fail failed"
  sleep "$PACE"
done < "$URLS"
echo "$(date -u +%FT%TZ) done: $n called, $ok ok, $fail failed"
