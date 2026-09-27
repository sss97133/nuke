#!/bin/bash
# apply_batches.sh <batches-dir> <log.jsonl> [max_batches] [sleep_s=5] [max_waits=10]
# Calls correct_vehicle_sale_provenance_batch once per batch file (JSON array of vehicle rows),
# through the Management API (scripts/data/q.sh). Between batches: one REST probe; if it exceeds
# 3s, wait and re-probe before continuing. Every result (counts, stale, missing) is appended to the log.
set -u
cd /Users/skylar/nuke
DIR=$1; LOG=$2; MAX=${3:-100000}; SLEEP=${4:-5}; MAXWAIT=${5:-10}
probe() {
  dotenvx run -q -- bash -c 'curl -s -o /dev/null --max-time 15 -w "%{time_total}" "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"'
}
n=0
for f in "$DIR"/batch_*.json; do
  [ -f "$f" ] || continue
  [ -f "$f.done" ] && continue
  n=$((n+1)); [ "$n" -gt "$MAX" ] && break
  waits=0
  while :; do
    t=$(probe); ok=$(echo "$t < 3" | bc -l)
    [ "$ok" = "1" ] && break
    waits=$((waits+1)); [ "$waits" -ge "$MAXWAIT" ] && { echo "$(date -u +%FT%TZ) probe stayed > 3s for $waits checks; STOPPING before $f" >&2; exit 2; }
    echo "$(date -u +%FT%TZ) probe ${t}s > 3s; waiting 120s before $f" >&2; sleep 120
  done
  payload=$(jq -c . "$f")
  sql="select correct_vehicle_sale_provenance_batch(\$j\$${payload}\$j\$::jsonb, 'bat-archive-2026-09-27', 'BaT catalog + lot page truth (session cb179857)')"
  s0=$(date +%s%N); res=$(./scripts/data/q.sh "$sql"); rpc_ms=$(( ($(date +%s%N) - s0)/1000000 ))
  echo "{\"batch\":\"$(basename "$f")\",\"at\":\"$(date -u +%FT%TZ)\",\"probe_s\":$t,\"result\":$(echo "$res" | jq -c '.' 2>/dev/null || echo "\"$(echo "$res" | head -c 300 | tr '"' "'")\"")}" >> "$LOG"
  if echo "$res" | jq -e '.[0].correct_vehicle_sale_provenance_batch.ok == true' >/dev/null 2>&1; then
    touch "$f.done"
    echo "$(date -u +%FT%TZ) $(basename "$f"): $(echo "$res" | jq -c '.[0].correct_vehicle_sale_provenance_batch | {vehicles_corrected, fields_corrected, fields_noop, stale: (.stale|length), missing: (.missing|length)}') rpc_ms=$rpc_ms"
    # lock-waiter check after each batch (lead's rule): anyone waiting on a lock → pause before the next batch
    lw=$(./scripts/data/q.sh "select count(*) as n from pg_stat_activity where wait_event_type = 'Lock'" | jq -r '.[0].n // "?"')
    if [ "$lw" != "0" ]; then echo "$(date -u +%FT%TZ) lock waiters: $lw; pausing 60s" >&2; sleep 60; fi
  else
    echo "$(date -u +%FT%TZ) $(basename "$f") FAILED: $(echo "$res" | head -c 300)" >&2
    exit 1
  fi
  sleep "$SLEEP"
done
