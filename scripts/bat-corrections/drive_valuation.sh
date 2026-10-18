#!/bin/bash
# drive_valuation.sh <ids-file> <log.jsonl> [batch=10] [max_calls=100000]
# Recompute nuke_estimates for exactly the vehicles listed (the 18,239 whose sold-comp cohort moved > 10 % in
# the BaT pass, 2026-09-27) by POSTing their ids to the deployed compute-vehicle-valuation in small batches,
# force=true so a fresh (non-stale) estimate is recomputed. Bounded: stops when the list is done. No cron
# toggles, no stale-mark. Gates (the lead's): hold while host load1 > 12 or REST > 1 s; a REST probe every 5
# calls; stop after 5 strikes. Re-runs skip ids already logged as computed.
set -u
IDS=$1; LOG=$2; BATCH=${3:-10}; MAX=${4:-100000}
cd /Users/skylar/nuke
touch "$LOG"
probe() { dotenvx run -q -- bash -c 'curl -s -o /dev/null --max-time 15 -w "%{time_total}" "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"'; }
load1() { dotenvx run -q -- bash -c 'curl -s --max-time 20 "$VITE_SUPABASE_URL/customer/v1/privileged/metrics" --user "service_role:$SUPABASE_SERVICE_ROLE_KEY"' | awk '/^node_load1[ {]/ {print $NF; exit}'; }
done_ids=$(python3 -c "
import json,sys
s=set()
for l in open('$LOG'):
    try: d=json.loads(l)
    except: continue
    if d.get('ok'): s.update(d.get('ids',[]))
print('\n'.join(s))")
calls=0; computed=0; errors=0; strikes=0; batch=()
flush() {
  [ ${#batch[@]} -eq 0 ] && return
  if [ $((calls % 5)) -eq 0 ]; then
    t=$(probe); l=$(load1)
    while [ "$(echo "${t:-0} > 1" | bc -l)" = "1" ] || [ "$(echo "${l:-0} > 12" | bc -l)" = "1" ]; do
      strikes=$((strikes+1)); echo "$(date -u +%FT%TZ) hold: rest ${t}s load1 ${l} (strike $strikes); 120 s" >&2
      [ "$strikes" -ge 5 ] && { echo "STOPPING: prod stayed loaded" >&2; exit 2; }
      sleep 120; t=$(probe); l=$(load1)
    done
  fi
  ids_json=$(printf '%s\n' "${batch[@]}" | jq -R . | jq -sc .)
  s=$(date +%s%N)
  res=$(dotenvx run -q -- bash -c 'curl -s --max-time 170 -X POST "$VITE_SUPABASE_URL/functions/v1/compute-vehicle-valuation" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "$0"' "{\"vehicle_ids\":$ids_json,\"force\":true}")
  ms=$(( ($(date +%s%N) - s) / 1000000 ))
  calls=$((calls+1))
  line=$(echo "$res" | jq -c --argjson ids "$ids_json" --argjson ms "$ms" '{ok: (.success // false), computed: (.computed // 0), errors: ((.errors // []) | if type=="array" then length else . end), cached: (.cached // 0), error: (.error // null), ids: $ids, ms: $ms}' 2>/dev/null || echo "{\"ok\":false,\"error\":\"unparseable: $(echo "$res" | head -c 160 | tr '"' "'")\",\"ids\":$ids_json,\"ms\":$ms}")
  echo "$line" >> "$LOG"
  c=$(echo "$line" | jq -r '.computed // 0'); e=$(echo "$line" | jq -r '.errors // 0'); computed=$((computed+c)); errors=$((errors+e))
  batch=()
  sleep 1
}
while IFS= read -r id; do
  [ -z "$id" ] && continue
  echo "$done_ids" | grep -qxF "$id" && continue
  batch+=("$id")
  if [ ${#batch[@]} -ge "$BATCH" ]; then flush; [ "$calls" -ge "$MAX" ] && break; fi
done < "$IDS"
[ "$calls" -lt "$MAX" ] && flush
echo "$(date -u +%FT%TZ) done: $calls calls, $computed computed, $errors errors" >> "$LOG"
