#!/usr/bin/env bash
# byok-burn-all.sh — relentless, continuous burn through ALL of Skylar's user-upload
# images across ALL his vehicles. W parallel workers per vehicle (shard by day), no
# 15-min gap, no babysitting. Drains one vehicle, moves to the next, until everything
# is analyzed. Run detached and walk away:
#   nohup bash scripts/daily-receipt/byok-burn-all.sh 8 15 >/tmp/burn-all.out 2>&1 &
set -u
cd "$(dirname "$0")/../.." || exit 1
HERE="$(dirname "$0")"
export PATH="/Users/skylar/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
W="${1:-3}"        # parallel workers per vehicle (was 8 — 8 storms the port table)
BATCH="${2:-15}"   # frames per day-chunk
LOG="/Users/skylar/nuke/logs/byok-burn-all.log"
mkdir -p /Users/skylar/nuke/logs
log(){ echo "$(date '+%F %T') | $*" | tee -a "$LOG"; }

log "===== BURN-ALL START — $W workers/vehicle, $BATCH/day-chunk ====="
# pause the slow cron once for the whole run
launchctl unload ~/Library/LaunchAgents/com.nuke.byok-image-analysis.plist 2>/dev/null && log "paused launchd cron"

# His vehicles with user-upload images, most-first. NO jsonb filter (that scan times
# out) — prepare skips already-analyzed frames per vehicle, so a done vehicle just
# returns drained instantly. Cheap, fast, reliable.
# Vehicle list comes from a file (3rd arg), pre-computed by the caller in a context
# where the query is reliable. Falls back to a live query if no file given.
VLIST="${3:-}"
VEH=()
if [ -n "$VLIST" ] && [ -f "$VLIST" ]; then
  VEH=($(grep -E '^[0-9a-f-]{36}$' "$VLIST"))
else
  VEH=($(PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
    -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -c \
    "SELECT vi.vehicle_id FROM vehicle_images vi WHERE vi.source='user_upload' AND vi.vision_gate_status='approved' GROUP BY vi.vehicle_id ORDER BY count(*) DESC;" 2>>"$LOG" | grep -E '^[0-9a-f-]{36}$'))
fi
log "vehicle queue: ${#VEH[@]} vehicles with user-upload images"
if [ "${#VEH[@]}" -eq 0 ]; then log "vehicle query returned nothing (timeout?) — abort, not draining"; exit 1; fi

for vid in "${VEH[@]}"; do
  log "--- burning vehicle $vid ($W workers) ---"
  pids=()
  for i in $(seq 0 $((W-1))); do
    ( while true; do
        bash "$HERE/byok-image-batch.sh" "$vid" "$BATCH" "$W" "$i"
        [ "$?" -eq 3 ] && break   # shard drained
      done ) &
    pids+=($!)
  done
  wait "${pids[@]}"
  log "--- vehicle $vid drained ---"
done

launchctl load -w ~/Library/LaunchAgents/com.nuke.byok-image-analysis.plist 2>/dev/null && log "re-armed launchd cron"
log "===== BURN-ALL COMPLETE ====="
