#!/bin/bash
# Land Mecum lots from the public lot index through extract-mecum action land_index_lots, one 100-lot batch at a time.
# usage: land_index.sh <batch dir> <log.jsonl> [max batches] [sleep s]
# Run it as dotenvx run -- land_index.sh ... (needs SUPABASE_URL and a service key in the environment; nothing is printed).
# Before every batch the gate checks REST (200, under 2 s), vehicle_completion_recompute_queue (under QMAX) and lock waiters. It
# closes only when REST does not answer, or lock waiters show on two checks 15 s apart together with a slow REST or a queue
# over QMAX. A closed gate waits 60 s; 30 closed checks in a row stop the run (exit 2). A batch that returns errors is retried once;
# if the retry also errs (or the call fails) the batch moves to held/ and the run goes on, stopping (exit 3) only after 3 held in a row. Resumable: a batch with a .done marker is skipped. No request goes to Mecum.
set -u
DIR=$1; LOG=$2; MAX=${3:-100000}; SLEEP=${4:-5}; QMAX=${QMAX:-2000}
U=${SUPABASE_URL:?}; KEY=${SUPABASE_SERVICE_ROLE_KEY:?}
ANON=${PUBKEY:-$(cat "$(dirname "$0")/.pubkey")}
HERE=$(cd "$(dirname "$0")/../.." && pwd)
q() { (cd "$HERE" && ./scripts/data/q.sh "$1"); }
log() { echo "$(date -u +%FT%TZ) $*" >&2; }
gate() {
  # Closed only when REST is not answering, or when lock waiters show on two checks 15 s apart AND (REST is slow OR the
  # completion queue is over the ceiling). A single brief lock waiter, mostly another writer's, does not close it.
  local waits=0
  while :; do
    local pr code t qd lw lw2 slow=0 over=0 closed=0 why=""
    pr=$(curl -s -o /dev/null --max-time 10 -w "%{http_code} %{time_total}" "$U/rest/v1/vehicles?select=id&limit=1" -H "apikey: $ANON")
    code=${pr% *}; t=${pr#* }
    qd=$(q "set statement_timeout='5s'; select count(*) n from vehicle_completion_recompute_queue" | jq -r 'if type=="array" then (.[0].n // "x") else "x" end')
    lw=$(q "set statement_timeout='5s'; select count(*) n from pg_stat_activity where wait_event_type='Lock'" | jq -r 'if type=="array" then (.[0].n // "x") else "x" end')
    [ "$(echo "$t >= 2" | bc -l)" = "1" ] && slow=1
    { [ "$qd" = "x" ] || [ "$qd" -ge "$QMAX" ]; } && over=1
    if [ "$code" != "200" ]; then closed=1; why="rest $code"
    elif [ "$lw" = "x" ]; then closed=1; why="lock waiters unreadable"
    elif [ "$lw" != "0" ] && { [ "$slow" = "1" ] || [ "$over" = "1" ]; }; then
      sleep 15
      lw2=$(q "set statement_timeout='5s'; select count(*) n from pg_stat_activity where wait_event_type='Lock'" | jq -r 'if type=="array" then (.[0].n // "x") else "x" end')
      if [ "$lw2" != "0" ]; then closed=1; why="lock waiters $lw then $lw2 with rest ${t}s / queue $qd"; fi
    fi
    [ "$closed" = "0" ] && return 0
    waits=$((waits+1)); [ "$waits" -ge 30 ] && { log "gates closed 30 checks ($why); STOPPING"; exit 2; }
    log "gate closed: $why; waiting 60s"; sleep 60
  done
}

# The service key goes to curl through a 0600 header file, never argv (ps shows argv).
HDR=$(mktemp); chmod 600 "$HDR"; trap 'rm -f "$HDR"' EXIT
printf 'Authorization: Bearer %s\napikey: %s\n' "$KEY" "$KEY" > "$HDR"
n=0; held=0
for f in "$DIR"/batch_*.json; do
  [ -f "$f" ] || continue; [ -f "$f.done" ] && continue
  n=$((n+1)); [ "$n" -gt "$MAX" ] && break
  gate
  s0=$(date +%s)
  out=$(curl -s --max-time 150 -w '\n%{http_code}' -X POST "$U/functions/v1/extract-mecum" -H @"$HDR" -H "Content-Type: application/json" -d "$(jq -c '{action: "land_index_lots", lots: .lots, pulled_at: .pulled_at}' "$f")")
  code=${out##*$'\n'}; resp=${out%$'\n'*}; ms=$(( ($(date +%s) - s0)*1000 ))
  if [ "$code" != "200" ] || [ "$(echo "$resp" | jq -r '.success // false')" != "true" ]; then
    mkdir -p "$DIR/held"; mv "$f" "$DIR/held/"; held=$((held+1))
    echo "{\"held\":\"$(basename "$f")\",\"http\":\"$code\"}" >> "$LOG"; log "batch $f HELD: http $code ${resp:0:300}"
    [ "$held" -ge 3 ] && { log "3 batches held in a row; STOPPING"; exit 3; }
    sleep 30; continue
  fi
  echo "$resp" | jq -c --arg b "$(basename "$f")" --arg at "$(date -u +%FT%TZ)" --argjson ms "$ms" '{batch:$b, at:$at, ms:$ms, received, already_landed, linked_to_existing_vehicle, vehicles_created, events_created, auction_events_created, observations, observation_errors, rejected_by_gate, skipped, errors}' >> "$LOG"
  if [ "$(echo "$resp" | jq '(.errors|length) + .observation_errors')" != "0" ]; then
    # A batch-level error (a lock timeout on the bulk insert) is handled by the action's row-by-row fallback. The batch is not
    # done until a second pass, which skips every landed lot, comes back clean; two bad passes in a row stop the run.
    log "batch $f returned errors: $(echo "$resp" | jq -c .errors); retrying once after 60 s"; echo "$resp" | jq -c --arg b "$(basename "$f")" '{retry_of: $b, errors}' >> "$LOG"
    sleep 60
    resp=$(curl -s --max-time 150 -X POST "$U/functions/v1/extract-mecum" -H @"$HDR" -H "Content-Type: application/json" -d "$(jq -c '{action: "land_index_lots", lots: .lots, pulled_at: .pulled_at}' "$f")")
    if [ "$(echo "$resp" | jq -r '.success // false')" != "true" ] || [ "$(echo "$resp" | jq '(.errors|length) + .observation_errors')" != "0" ]; then
      # One bad batch never stops the line: hold it (moved to held/, logged) and go on; stop only after 3 held in a row.
      mkdir -p "$DIR/held"; mv "$f" "$DIR/held/"; held=$((held+1))
      echo "{\"held\":\"$(basename "$f")\",\"errors\":$(echo "$resp" | jq -c '.errors // .error // "no response"')}" >> "$LOG"
      log "batch $f HELD (second pass also returned errors): ${resp:0:300}"
      [ "$held" -ge 3 ] && { log "3 batches held in a row; STOPPING"; exit 3; }
      sleep "$SLEEP"; continue
    fi
  fi
  held=0
  touch "$f.done"; log "$(tail -1 "$LOG")"; sleep "$SLEEP"
done
log "DONE through $n batches"
