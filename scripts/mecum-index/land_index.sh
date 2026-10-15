#!/bin/bash
# Land Mecum lots from the public lot index through extract-mecum action land_index_lots, one 100-lot batch at a time.
# usage: land_index.sh <batch dir> <log.jsonl> [max batches] [sleep s]
# Run it as dotenvx run -- land_index.sh ... (needs SUPABASE_URL and a service key in the environment; nothing is printed).
# Before every batch the three gates must pass: anon REST 200 in < 2 s, vehicle_completion_recompute_queue < QMAX, no lock
# waiters. A closed gate waits 60 s; 30 closed checks in a row stop the run (exit 2). A batch that returns errors in the
# response or a non-200 stops the run (exit 3). Resumable: a batch with a .done marker is skipped. No request goes to Mecum.
set -u
DIR=$1; LOG=$2; MAX=${3:-100000}; SLEEP=${4:-5}; QMAX=${QMAX:-2000}
U=${SUPABASE_URL:?}; KEY=${SUPABASE_SERVICE_ROLE_KEY:?}
ANON=${PUBKEY:-$(cat "$(dirname "$0")/.pubkey")}
HERE=$(cd "$(dirname "$0")/../.." && pwd)
q() { (cd "$HERE" && ./scripts/data/q.sh "$1"); }
log() { echo "$(date -u +%FT%TZ) $*" >&2; }
gate() {
  local waits=0
  while :; do
    local pr code t qd lw
    pr=$(curl -s -o /dev/null --max-time 10 -w "%{http_code} %{time_total}" "$U/rest/v1/vehicles?select=id&limit=1" -H "apikey: $ANON")
    code=${pr% *}; t=${pr#* }
    qd=$(q "set statement_timeout='5s'; select count(*) n from vehicle_completion_recompute_queue" | jq -r '.[0].n // "x"')
    lw=$(q "set statement_timeout='5s'; select count(*) n from pg_stat_activity where wait_event_type='Lock'" | jq -r '.[0].n // "x"')
    if [ "$code" = "200" ] && [ "$(echo "$t < 2" | bc -l)" = "1" ] && [ "$qd" != "x" ] && [ "$qd" -lt "$QMAX" ] && [ "$lw" = "0" ]; then return 0; fi
    waits=$((waits+1)); [ "$waits" -ge 30 ] && { log "gates closed 30 checks (rest $code ${t}s, queue $qd, lock waiters $lw); STOPPING"; exit 2; }
    log "gate closed: rest $code ${t}s, queue $qd, lock waiters $lw; waiting 60s"; sleep 60
  done
}
n=0
for f in "$DIR"/batch_*.json; do
  [ -f "$f" ] || continue; [ -f "$f.done" ] && continue
  n=$((n+1)); [ "$n" -gt "$MAX" ] && break
  gate
  s0=$(date +%s)
  out=$(curl -s --max-time 150 -w '\n%{http_code}' -X POST "$U/functions/v1/extract-mecum" -H "Authorization: Bearer $KEY" -H "apikey: $KEY" -H "Content-Type: application/json" -d "$(jq -c '{action: "land_index_lots", lots: .lots, pulled_at: .pulled_at}' "$f")")
  code=${out##*$'\n'}; resp=${out%$'\n'*}; ms=$(( ($(date +%s) - s0)*1000 ))
  if [ "$code" != "200" ] || [ "$(echo "$resp" | jq -r '.success // false')" != "true" ]; then
    log "batch $f failed: http $code ${resp:0:300}"; echo "{\"batch\":\"$(basename "$f")\",\"http\":\"$code\"}" >> "$LOG"; exit 3
  fi
  echo "$resp" | jq -c --arg b "$(basename "$f")" --arg at "$(date -u +%FT%TZ)" --argjson ms "$ms" '{batch:$b, at:$at, ms:$ms, received, already_landed, linked_to_existing_vehicle, vehicles_created, events_created, auction_events_created, observations, observation_errors, rejected_by_gate, skipped, errors}' >> "$LOG"
  if [ "$(echo "$resp" | jq '(.errors|length) + .observation_errors')" != "0" ]; then
    # A batch-level error (a lock timeout on the bulk insert) is handled by the action's row-by-row fallback. The batch is not
    # done until a second pass, which skips every landed lot, comes back clean; two bad passes in a row stop the run.
    log "batch $f returned errors: $(echo "$resp" | jq -c .errors); retrying once after 60 s"; echo "$resp" | jq -c --arg b "$(basename "$f")" '{retry_of: $b, errors}' >> "$LOG"
    sleep 60
    resp=$(curl -s --max-time 150 -X POST "$U/functions/v1/extract-mecum" -H "Authorization: Bearer $KEY" -H "apikey: $KEY" -H "Content-Type: application/json" -d "$(jq -c '{action: "land_index_lots", lots: .lots, pulled_at: .pulled_at}' "$f")")
    if [ "$(echo "$resp" | jq -r '.success // false')" != "true" ] || [ "$(echo "$resp" | jq '(.errors|length) + .observation_errors')" != "0" ]; then log "batch $f failed again: ${resp:0:300}"; exit 3; fi
  fi
  touch "$f.done"; log "$(tail -1 "$LOG")"; sleep "$SLEEP"
done
log "DONE through $n batches"
