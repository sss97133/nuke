#!/bin/bash
# reap-stuck-drain.sh — self-finishing drainer for the abandoned-scrape 'processing' rows (Phase 1.3).
#
# The one-shot reap got 82% (1.32M -> ~233K) but the last tail won't drain in a single background run:
# vehicle_images updates are ~100 rows/sec (28 indexes + 36GB random I/O), the pooler caps statements
# at 10s, and the DB is continuously busy (fleet coordinator every 5min, inflow, autovacuum churn from
# the reap's own dead tuples). So this grinds bounded chunks per launchd fire — like com.nuke.clip-embed
# — progressing during the quieter windows until processing reaches 0, then no-ops. Remove this job
# (launchctl unload + rm plist) once logs/reap-stuck.log shows 'drain-DRAINED'.
#
# ALLOW_RAW_TESTIMONY_WRITE: pipeline-state flag only (ai_processing_status), never an observation/
# attribution/value. Scope: scraped rows the dead scrape analyzer abandoned in 'processing'. Safe —
# null user_id => the value-recompute trigger early-returns; image/obs/attribution untouched.
set -uo pipefail
cd /Users/skylar/nuke || exit 1
LOCK=/tmp/com.nuke.reap-stuck.lock
mkdir "$LOCK" 2>/dev/null || { echo "$(date '+%H:%M:%S') reap-drain: prior fire running — skip"; exit 0; }
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
export PGPASSWORD="RbzKq32A0uhqvJMQ"
CONN="host=aws-0-us-west-1.pooler.supabase.com port=6543 user=postgres.qkgaybvrernstplzjaam dbname=postgres sslmode=require"
LOG=/Users/skylar/nuke/logs/reap-stuck.log
echo "=== $(date '+%H:%M:%S') reap-drain fire (bounded 60 batches x 500) ===" >> "$LOG"
total=0; err=0
for i in $(seq 1 60); do
  out=$(psql "$CONN" -t -A -c "with ids as materialized (select id from vehicle_images where ai_processing_status='processing' order by updated_at limit 500) update vehicle_images v set ai_processing_status='failed', updated_at=now() from ids where v.id=ids.id -- ALLOW_RAW_TESTIMONY_WRITE
" 2>&1)
  n=$(echo "$out" | grep -oE 'UPDATE [0-9]+' | grep -oE '[0-9]+'); n=${n:-0}
  if echo "$out" | grep -q timeout; then err=$((err+1)); else err=0; fi
  total=$((total+n))
  if [ "$n" -gt 0 ] && [ "$n" -lt 500 ]; then echo "$(date '+%H:%M:%S') drain-DRAINED (final $n) fire_total=$total" >> "$LOG"; break; fi
  [ "$err" -ge 12 ] && { echo "$(date '+%H:%M:%S') drain backoff (12 timeouts) fire_total=$total" >> "$LOG"; break; }
  sleep 1
done
echo "$(date '+%H:%M:%S') reap-drain fire done total=$total" >> "$LOG"
