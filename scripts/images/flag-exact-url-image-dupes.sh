#!/bin/bash
# WRITES PROD (through mark_as_duplicate). Moved here 2026-10-15 from ~/nuke-logs/image-url-dupes/run.sh, which launchd still runs
# (agent ag.nuke.image-url-dupes; state, logs and not_before live in ~/nuke-logs/image-url-dupes/ and are not committed).
# First ran 2026-10-15 08:41Z: 10,320 rows flagged on vehicle 65074605 by 10:22Z, then paused for the Mecum walk.
# Gates now: REST probe, lock waits, active sessions, longest active client query, and IO waiters (DataFileRead).
# flag-exact-url-image-dupes.sh [batch=120] [min_images=1000]
#
# vehicle_images has no unique key on (vehicle_id, image_url), and writers that inserted without looking added the same
# URL again on every run (one Porsche 911: 9,972 rows for 719 URLs). vehicles.image_count counts the rows, search
# "Relevance" sorts by it and the cards print it. This job flags every repeat of a URL the same vehicle already holds:
# is_duplicate = true, duplicate_of = the keeper, through the existing mark_as_duplicate(image_id, original_id). It never
# deletes. The keeper is the vehicle's primary row for that URL if there is one, else the earliest (created_at, id).
# trg_vehicle_images_count recomputes vehicles.image_count (distinct non-duplicate, non-superseded rows) per flagged row,
# so the count is corrected in the same statement.
#
# Resumable: state lives in $W (cursor, candidates.tsv, done.txt); run it again and it continues.
# Single instance: a lock directory with the pid; a second copy exits. Run it under launchd (ag.nuke.image-url-dupes).
# IO gate: skip while more than 3 client queries wait on IO/DataFileRead (the Mecum walk runs back to back from 03:00Z).
# Load gate before every batch (10-15 night, disk-read-bound): REST probe under 3 s, 0 lock waits, fewer than 25 active sessions, no active client query older than 10 s.
# on a lock (2-9 are waiting at most hours on this box), fewer than 25 active sessions. Batch default 120 rows: each flagged row fires the count and primary-image
# triggers, which read the vehicle's rows (about 0.1 s per row on a 10,000-row vehicle, 6.5 s for 50 rows measured).
# Order: vehicles with the most image rows first.
set -u
BATCH=${1:-30}; MIN=${2:-1000}; MINB=5   # BATCH adapts: halves when a batch takes over 5 s or fails, doubles (to 120) under 2 s
W=${DUPW:-$HOME/nuke-logs/image-url-dupes}; mkdir -p "$W"
Q=/Users/skylar/nuke/scripts/data/q.sh
LOG=$W/job.log
cd /Users/skylar/nuke || exit 1

# single instance
if ! mkdir "$W/lock" 2>/dev/null; then
  if kill -0 "$(cat "$W/lock/pid" 2>/dev/null)" 2>/dev/null; then echo "already running" >&2; exit 0; fi
  rm -rf "$W/lock"; mkdir "$W/lock" || exit 1
fi
echo $$ > "$W/lock/pid"; trap 'rm -rf "$W/lock"' EXIT

log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
probe() { dotenvx run -q -- bash -c 'curl -s -o /dev/null --max-time 15 -w "%{time_total}" "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"'; }
slow=0
gate() {
  while :; do
    local t; t=$(probe)
    if [ "$(echo "${t:-99} > 3" | bc -l)" = "1" ]; then
      slow=$((slow+1)); log "probe ${t}s slow ($slow); pausing 120s"; [ "$slow" -ge 5 ] && { log "STOP: prod slow"; exit 2; }; sleep 120; continue
    fi
    local g; g=$($Q "set statement_timeout='6s'; select count(*) filter (where wait_event_type='Lock') lockw, count(*) filter (where state='active' and wait_event_type='IO' and wait_event='DataFileRead' and backend_type='client backend' and pid <> pg_backend_pid()) iow, count(*) filter (where state='active' and pid <> pg_backend_pid()) act, coalesce(max(extract(epoch from now()-query_start)) filter (where state='active' and pid <> pg_backend_pid() and backend_type='client backend' and query !~ 'pg_stat_activity'),0)::int longest from pg_stat_activity where datname=current_database()")
    local lw act lg iow; iow=$(echo "$g" | jq -r '.[0].iow // 99' 2>/dev/null); lw=$(echo "$g" | jq -r '.[0].lockw // 99' 2>/dev/null); act=$(echo "$g" | jq -r '.[0].act // 99' 2>/dev/null); lg=$(echo "$g" | jq -r '.[0].longest // 999' 2>/dev/null)
    # Disk-read-bound nights: run only with no lock waits, fewer than 25 active sessions, and no active client query older than 10 s.
    if [ "${lw:-99}" -ge 1 ] || [ "${act:-99}" -ge 25 ] || [ "${lg:-999}" -ge 10 ] || [ "${iow:-99}" -gt 3 ]; then log "gate: lock waits=$lw active=$act longest=${lg}s io_waiters=$iow; pausing 60s"; sleep 60; continue; fi
    return 0
  done
}

# intake first: do nothing before $W/not_before (an ISO time; the Mecum walk ends about 17:00Z on 2026-10-15)
NB=$(cat "$W/not_before" 2>/dev/null || echo 0)
while [ "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \< "$NB" ]; do sleep 300; done

# 1. discovery: walk vehicles by primary key, 4,000 rows a chunk, collecting those with more than MIN image rows
CUR=$(cat "$W/cursor" 2>/dev/null || echo "00000000-0000-0000-0000-000000000000")
if [ ! -f "$W/discovered" ]; then
  while :; do
    gate
    r=$($Q "set statement_timeout='20s'; with c as (select id, image_count from vehicles where id > '$CUR'::uuid order by id limit 4000) select (select id::text from c order by id desc limit 1) mx, (select count(*) from c) n, coalesce((select json_agg(json_build_object('id',id,'n',image_count)) from c where image_count > $MIN),'[]'::json) hits")
    mx=$(echo "$r" | jq -r '.[0].mx // empty' 2>/dev/null)
    if [ -z "$mx" ]; then if echo "$r" | jq -e '.[0].n == 0' >/dev/null 2>&1; then touch "$W/discovered"; log "discovery complete"; break; fi; log "discovery chunk failed: $(echo "$r" | head -c 200)"; sleep 90; continue; fi
    echo "$r" | jq -r '.[0].hits[] | "\(.n)\t\(.id)"' >> "$W/candidates.tsv"
    CUR=$mx; echo "$CUR" > "$W/cursor"
  done
fi

# 2. worst vehicles first
sort -t$'\t' -k1,1nr -u "$W/candidates.tsv" > "$W/queue.tsv"
touch "$W/done.txt"; total=0
log "start: $(wc -l < "$W/queue.tsv") candidate vehicles, batch $BATCH"
while IFS=$'\t' read -r n v; do
  grep -qx "$v" "$W/done.txt" && continue
  before=$n
  while :; do
    gate
    s0=$(date +%s)
    res=$($Q "set statement_timeout='15s'; select count(*) flagged from (select mark_as_duplicate(x.id, x.keeper) from (select id, first_value(id) over w keeper, row_number() over w rn from vehicle_images where vehicle_id='$v' and image_url is not null and is_duplicate is not true and is_superseded is not true window w as (partition by image_url order by (is_primary is true) desc, created_at, id)) x where x.rn>1 limit $BATCH) y")
    f=$(echo "$res" | jq -r '.[0].flagged // empty' 2>/dev/null)
    if [ -z "$f" ]; then BATCH=$(( BATCH / 2 )); [ "$BATCH" -lt "$MINB" ] && BATCH=$MINB; log "vehicle $v batch FAILED (batch now $BATCH): $(echo "$res" | head -c 160)"; sleep 90; continue; fi
    el=$(( $(date +%s) - s0 ))
    total=$((total+f)); log "vehicle $v: flagged $f in ${el}s, batch $BATCH (job total $total)"
    if [ "$el" -gt 5 ]; then BATCH=$(( BATCH / 2 )); [ "$BATCH" -lt "$MINB" ] && BATCH=$MINB; elif [ "$el" -lt 2 ] && [ "$BATCH" -lt 120 ]; then BATCH=$(( BATCH * 2 )); fi
    [ "$f" = "0" ] && break
    sleep 3
  done
  ic=$($Q "set statement_timeout='6s'; select image_count from vehicles where id='$v'" | jq -r '.[0].image_count // empty')
  log "vehicle $v done: image_count $before -> $ic"
  echo "$v" >> "$W/done.txt"
done < "$W/queue.tsv"
log "complete: $total rows flagged"
