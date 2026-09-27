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
  # call the chokepoint for a JSON array; on a statement timeout (57014, atomic rollback) split the array in
  # halves down to single vehicles, so one slow trigger cascade cannot stall the run; a single vehicle that
  # still times out is logged as skipped_timeout for a later pass.
  call_rows() { # $1 = json array
    local rows="$1" n r ms h left right
    n=$(echo "$rows" | jq 'length'); [ "$n" = "0" ] && { echo '{"ok":true,"vehicles_corrected":0,"fields_corrected":0,"fields_noop":0,"stale":[],"missing":[]}'; return 0; }
    local s0=$(date +%s%N); r=$(./scripts/data/q.sh "select correct_vehicle_sale_provenance_batch(\$j\$${rows}\$j\$::jsonb, 'bat-archive-2026-09-27', 'BaT catalog + lot page truth (session cb179857)')"); ms=$(( ($(date +%s%N) - s0)/1000000 ))
    if echo "$r" | grep -q '^\['; then echo "$r" | jq -c --argjson ms "$ms" '.[0].correct_vehicle_sale_provenance_batch + {rpc_ms: $ms}'; return 0; fi
    if echo "$r" | grep -q '57014'; then
      if [ "$n" -le 1 ]; then
        echo "$(date -u +%FT%TZ) skipped_timeout vehicle $(echo "$rows" | jq -r '.[0].vehicle_id')" >&2
        echo "{\"skipped_timeout\":$(echo "$rows" | jq -c '.[0].vehicle_id'),\"at\":\"$(date -u +%FT%TZ)\"}" >> "$LOG.skipped"
        echo '{"ok":true,"vehicles_corrected":0,"fields_corrected":0,"fields_noop":0,"stale":[],"missing":[],"skipped_timeout":1}'; return 0
      fi
      echo "$(date -u +%FT%TZ) statement timeout on $n vehicles; splitting" >&2; sleep 10
      h=$((n/2)); left=$(echo "$rows" | jq -c ".[0:$h]"); right=$(echo "$rows" | jq -c ".[$h:]")
      local a b; a=$(call_rows "$left") || return 1; b=$(call_rows "$right") || return 1
      jq -c -n --argjson a "$a" --argjson b "$b" '{ok: true, vehicles_corrected: ($a.vehicles_corrected + $b.vehicles_corrected), fields_corrected: ($a.fields_corrected + $b.fields_corrected), fields_noop: ($a.fields_noop + $b.fields_noop), stale: ($a.stale + $b.stale), missing: ($a.missing + $b.missing), skipped_timeout: (($a.skipped_timeout // 0) + ($b.skipped_timeout // 0)), rpc_ms: (($a.rpc_ms // 0) + ($b.rpc_ms // 0))}'
      return 0
    fi
    echo "$r"; return 1   # any other error: hand it back verbatim
  }
  payload=$(jq -c . "$f")
  s0=$(date +%s%N); out=$(call_rows "$payload"); rc=$?; rpc_ms=$(( ($(date +%s%N) - s0)/1000000 ))
  if [ $rc -ne 0 ]; then res="$out"; else res="[{\"correct_vehicle_sale_provenance_batch\":$out}]"; fi
  echo "{\"batch\":\"$(basename "$f")\",\"at\":\"$(date -u +%FT%TZ)\",\"probe_s\":$t,\"result\":$(echo "$res" | jq -c '.' 2>/dev/null || echo "\"$(echo "$res" | head -c 300 | tr '"' "'")\"")}" >> "$LOG"
  if echo "$res" | grep -qE '23514|55P03|42501'; then echo "$(date -u +%FT%TZ) $(basename "$f") STOP for the lead: $(echo "$res" | grep -oE '(23514|55P03|42501)[^\\]{0,160}' | head -1)" >&2; echo "{\"batch\":\"$(basename "$f")\",\"at\":\"$(date -u +%FT%TZ)\",\"stop\":$(echo "$res" | head -c 400 | jq -Rs .)}" >> "$LOG"; exit 3; fi
  if echo "$res" | jq -e '.[0].correct_vehicle_sale_provenance_batch.ok == true' >/dev/null 2>&1; then
    touch "$f.done"
    echo "$(date -u +%FT%TZ) $(basename "$f"): $(echo "$res" | jq -c '.[0].correct_vehicle_sale_provenance_batch | {vehicles_corrected, fields_corrected, fields_noop, stale: (.stale|length), missing: (.missing|length), skipped_timeout: (.skipped_timeout // 0)}') rpc_ms=$rpc_ms"
    # lock-waiter check after each batch (lead's rule): anyone waiting on a lock → pause before the next batch
    lw=$(./scripts/data/q.sh "select count(*) as n from pg_stat_activity where wait_event_type = 'Lock'" | jq -r '.[0].n // "?"')
    if [ "$lw" != "0" ]; then echo "$(date -u +%FT%TZ) lock waiters: $lw; pausing 60s" >&2; sleep 60; fi
  else
    echo "$(date -u +%FT%TZ) $(basename "$f") FAILED: $(echo "$res" | head -c 300)" >&2
    exit 1
  fi
  sleep "$SLEEP"
done
