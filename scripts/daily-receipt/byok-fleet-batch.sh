#!/usr/bin/env bash
# byok-fleet-batch.sh — the FLEET-WIDE, self-advancing entrypoint for the BYOK deep
# image-analysis cron. This is what the launchd plist calls now (no hardcoded vehicle).
#
# Before: the plist pinned byok-image-batch.sh to ONE vehicle (a drained K5), so every
# 5-minute fire logged "drained" forever and the rest of the fleet was never touched
# autonomously (wound W1). Now each fire asks the coordinator for the highest-priority
# vehicle with real pending work and drains one bounded batch of it.
#
# Each fire:
#   1. byok-fleet-next.mjs ranks candidate vehicles (inflow-first, then biggest backlog)
#      from the coverage counter table — never a 38.9M-row scan.
#   2. We run ONE bounded byok-image-batch.sh on the first candidate that has real work.
#   3. A candidate that prepare() reports drained (rc=3) is reconciled in the counter
#      (--refresh) so it won't be re-picked, and we advance to the next candidate.
# Idempotent + resumable: state lives in the DB (the counter + prepare's live queue),
# never in memory — killing this mid-fire loses nothing; the next fire re-derives work.
#
# Usage:  byok-fleet-batch.sh [batch_size]
set -u
cd "$(dirname "$0")/../.." || exit 1
export PATH="/Users/skylar/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
BATCH="${1:-15}"
HERE="$(dirname "$0")"
LOG="/Users/skylar/nuke/logs/byok-image-batch.log"
mkdir -p /Users/skylar/nuke/logs
log(){ echo "$(date '+%F %T') | fleet | $*" | tee -a "$LOG"; }

# Coordinator emits ranked candidate vehicle_ids (highest priority first), one per line.
# macOS /bin/bash is 3.2 (no `mapfile`); word-split into an array — UUIDs have no spaces.
# dotenvx's banner goes to stderr (→ log); only the UUIDs reach stdout (→ the array).
CAND=( $(dotenvx run -- node "$HERE/byok-fleet-next.mjs" --limit 30 2>>"$LOG" | grep -E '^[0-9a-f-]{36}$') )
if [ "${#CAND[@]}" -eq 0 ]; then log "coordinator returned no candidates — fleet drained"; exit 3; fi
log "coordinator ranked ${#CAND[@]} candidate vehicles; head=${CAND[0]}"

for vid in "${CAND[@]}"; do
  [[ "$vid" =~ ^[0-9a-f-]{36}$ ]] || continue
  bash "$HERE/byok-image-batch.sh" "$vid" "$BATCH"
  rc=$?
  if [ "$rc" -eq 3 ]; then
    # Counter said this vehicle had work but prepare found its approved days drained:
    # reconcile the counter so it isn't re-picked, then advance to the next candidate.
    dotenvx run -- node "$HERE/byok-fleet-next.mjs" --refresh "$vid" >>"$LOG" 2>&1 || true
    log "candidate $vid drained — counter reconciled, advancing to next"
    continue
  fi
  # rc 0 (analyzed a batch) or 1 (transient/network backoff) — ONE bounded batch per
  # fire; refresh this vehicle's counter so progress is visible, then stop.
  dotenvx run -- node "$HERE/byok-fleet-next.mjs" --refresh "$vid" >>"$LOG" 2>&1 || true
  log "candidate $vid handled (rc=$rc) — one batch this fire, counter refreshed"
  exit "$rc"
done
log "all ${#CAND[@]} ranked candidates drained this fire"
exit 3
