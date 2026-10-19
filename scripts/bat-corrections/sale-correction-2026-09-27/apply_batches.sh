#!/bin/bash
# WROTE PROD. Recovered 2026-10-15 from the untracked, gitignored ~/nuke/scripts/data/batwriter/; committed unchanged (this header excepted).
# What it did: applied BaT sale corrections to vehicles through the sanctioned chokepoint correct_vehicle_sale_provenance_batch
# (source 'bat-archive-2026-09-27', original values kept as citations), one batch file per call, REST-probe gated.
# When: 2026-09-27; the all-BaT correction finished 21:30:52Z (see the job-enable log line of that time). Session cb179857.
# The chain: fetch_live.sh (read prod) -> gen_corrections.sql (local duckdb) -> export_batches.sh -> this script. The batch files and
# the duckdb work files are not committed.
# apply_batches.sh <batches-dir> <log.jsonl> [max_batches]
# Calls correct_vehicle_sale_provenance_batch once per batch file (JSON array of vehicle rows),
# through the Management API (scripts/data/q.sh). Between batches: one REST probe; if it exceeds
# 3s, wait and re-probe before continuing. Every result (counts, stale, missing) is appended to the log.
set -u
cd /Users/skylar/nuke
DIR=$1; LOG=$2; MAX=${3:-100000}
probe() {
  dotenvx run -q -- bash -c 'curl -s -o /dev/null --max-time 15 -w "%{time_total}" "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"'
}
n=0
for f in "$DIR"/batch_*.json; do
  [ -f "$f" ] || continue
  [ -f "$f.done" ] && continue
  n=$((n+1)); [ "$n" -gt "$MAX" ] && break
  while :; do
    t=$(probe); ok=$(echo "$t < 3" | bc -l)
    [ "$ok" = "1" ] && break
    echo "$(date -u +%FT%TZ) probe ${t}s > 3s; waiting 120s before $f" >&2; sleep 120
  done
  payload=$(jq -c . "$f")
  sql="select correct_vehicle_sale_provenance_batch(\$j\$${payload}\$j\$::jsonb, 'bat-archive-2026-09-27', 'BaT catalog + lot page truth (session cb179857)')"
  res=$(./scripts/data/q.sh "$sql")
  echo "{\"batch\":\"$(basename "$f")\",\"at\":\"$(date -u +%FT%TZ)\",\"probe_s\":$t,\"result\":$(echo "$res" | jq -c '.' 2>/dev/null || echo "\"$(echo "$res" | head -c 300 | tr '"' "'")\"")}" >> "$LOG"
  if echo "$res" | jq -e '.[0].correct_vehicle_sale_provenance_batch.ok == true' >/dev/null 2>&1; then
    touch "$f.done"
    echo "$(date -u +%FT%TZ) $(basename "$f"): $(echo "$res" | jq -c '.[0].correct_vehicle_sale_provenance_batch | {vehicles_corrected, fields_corrected, fields_noop, stale: (.stale|length), missing: (.missing|length)}')"
  else
    echo "$(date -u +%FT%TZ) $(basename "$f") FAILED: $(echo "$res" | head -c 300)" >&2
    exit 1
  fi
  sleep 5
done
