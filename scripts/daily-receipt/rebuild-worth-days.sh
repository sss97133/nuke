#!/usr/bin/env bash
# rebuild-worth-days.sh — one-time fleet sweep that re-derives EVERY stored work_session
# with the current build-day logic so historical worth-proofs become defensible:
#   • labor-minutes = true temporal burst clustering (not span × 0.7) — kills inflation
#   • intent-gated (only intent=labor frames at conf>=0.6 — the $410 guard)
#   • stale phantom sessions (days whose frames no longer qualify) get their labor zeroed
# Idempotent: build-day overwrites; owner-confirmed/signed cost is preserved untouched.
# Going forward the byok cron runs build-day per-day, so NEW days stay accurate; this sweep
# corrects the BACKLOG of pre-fix sessions. Env is injected ONCE for the whole sweep (not
# per build-day call), so launch it UNDER dotenvx, detached:
#   nohup dotenvx run -- bash scripts/daily-receipt/rebuild-worth-days.sh >/tmp/rebuild-worth.out 2>&1 &
set -u
cd "$(dirname "$0")/../.." || exit 1
export PATH="/Users/skylar/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export PGPASSWORD="RbzKq32A0uhqvJMQ"
CONN="host=aws-0-us-west-1.pooler.supabase.com port=6543 user=postgres.qkgaybvrernstplzjaam dbname=postgres sslmode=require"
LOG=/Users/skylar/nuke/logs/rebuild-worth.log
log(){ echo "$(date '+%F %T') | $*" | tee -a "$LOG"; }

log "=== rebuild-worth-days START ==="
# every vehicle with work_sessions, most-sessions-first (so the biggest corrections land first)
VEH=$(psql "$CONN" -t -A -c "select vehicle_id from work_sessions where vehicle_id is not null group by vehicle_id order by count(*) desc")
total=0
for vid in $VEH; do
  [[ "$vid" =~ ^[0-9a-f-]{36}$ ]] || continue
  DAYS=$(psql "$CONN" -t -A -c "select distinct session_date from work_sessions where vehicle_id='$vid' order by session_date")
  n=0
  for d in $DAYS; do
    [ -n "$d" ] || continue
    node scripts/daily-receipt/build-day.mjs --vehicle-id "$vid" --date "$d" >>"$LOG" 2>&1
    n=$((n+1)); total=$((total+1))
  done
  log "vehicle ${vid:0:8}: re-derived $n days (running total $total)"
done
log "=== rebuild-worth-days DONE: $total day-sessions re-derived ==="
