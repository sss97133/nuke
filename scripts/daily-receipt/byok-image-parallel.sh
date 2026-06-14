#!/usr/bin/env bash
# byok-image-parallel.sh — drain a vehicle's whole deep-analysis backlog FAST.
#
# The launchd cron (com.nuke.byok-image-analysis) is a slow steady trickle
# (4 imgs / 15 min, ~5-6 days for the K5). This is the burst mode: W continuous
# workers, each owning a hash-shard of the pending images, running batches
# back-to-back with NO 15-min gap, until every shard is drained.
#
# Speed is ~linear in W. The only real floor is Opus inference (~2-4 min/image),
# so W workers ≈ total_images * 3min / W. The cost is the same total, just spent
# W× faster; high W can hit BYOK account rate limits.
#
# Usage:  byok-image-parallel.sh <vehicle-id> [workers] [batch_per_worker]
#   e.g.  byok-image-parallel.sh e08bf694-970f-4cbe-8a74-8715158a0f2e 5 4
set -u
cd "$(dirname "$0")/../.." || exit 1
HERE="$(dirname "$0")"
VEHICLE="${1:?usage: byok-image-parallel.sh <vehicle-id> [workers] [batch_per_worker]}"
W="${2:-5}"
BATCH="${3:-4}"
LOG="/Users/skylar/nuke/logs/byok-image-parallel.log"
mkdir -p /Users/skylar/nuke/logs
echo "$(date '+%F %T') | PARALLEL START vehicle=$VEHICLE workers=$W batch=$BATCH" | tee -a "$LOG"

# Pause the slow cron while burst mode runs, so they don't fight (best-effort).
launchctl unload ~/Library/LaunchAgents/com.nuke.byok-image-analysis.plist 2>/dev/null && \
  echo "$(date '+%F %T') | paused launchd cron for burst" | tee -a "$LOG"

pids=()
for i in $(seq 0 $((W-1))); do
  (
    while true; do
      bash "$HERE/byok-image-batch.sh" "$VEHICLE" "$BATCH" "$W" "$i"
      rc=$?
      if [ "$rc" -eq 3 ]; then
        echo "$(date '+%F %T') | worker $i: shard drained, exiting" | tee -a "$LOG"
        break
      fi
    done
  ) &
  pids+=($!)
  echo "$(date '+%F %T') | launched worker $i (shard $i/$W) pid $!" | tee -a "$LOG"
done

wait "${pids[@]}"
echo "$(date '+%F %T') | PARALLEL DONE — all $W shards drained for $VEHICLE" | tee -a "$LOG"

# Re-arm the slow cron to catch any future new uploads.
launchctl load -w ~/Library/LaunchAgents/com.nuke.byok-image-analysis.plist 2>/dev/null && \
  echo "$(date '+%F %T') | re-armed launchd cron" | tee -a "$LOG"
