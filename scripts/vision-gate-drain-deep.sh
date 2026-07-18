#!/usr/bin/env bash
# vision-gate-drain-deep.sh — same as vision-gate-drain.sh but --limit 10000.
# For vehicles whose first pass (limit=2000) didn't fully drain.
set -u
LABEL="$1"; shift
LOG="/Users/skylar/nuke/logs/vision-gate-drain-deep-${LABEL}-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$(dirname "$LOG")"
GHOSTS=("e08bf694-970f-4cbe-8a74-8715158a0f2e" "5a1deb95-4b67-4cc3-9575-23bb5b180693" "d6a01df2-dc78-4fe9-9559-2c4cf6124a7a")
is_ghost() { local vid="$1"; for g in "${GHOSTS[@]}"; do [[ "$vid" == "$g" ]] && return 0; done; return 1; }

cd /Users/skylar/nuke
echo "[$(date +%H:%M:%S)] deep chunk=$LABEL count=$# starting" | tee -a "$LOG"
TOTAL_APPROVED=0; TOTAL_REJECTED=0; TOTAL_REVIEW=0
for VID in "$@"; do
  if is_ghost "$VID"; then
    echo "[$(date +%H:%M:%S)] $VID  GHOST" | tee -a "$LOG"; continue
  fi
  for pass in 1 2 3; do
    OUT=$(dotenvx run --quiet -- node scripts/vision-gate-classify.mjs \
          --vehicle-id "$VID" --include-null --limit 1500 2>&1 | tail -8)
    STATUS=$?
    FETCHED=$(echo "$OUT" | grep -E "^fetched " | awk '{print $2}')
    if [ -z "$FETCHED" ] || [ "$FETCHED" -lt 1 ]; then break; fi
    A=$(echo "$OUT" | awk '/^  approved:/ {print $2}')
    R=$(echo "$OUT" | awk '/^  rejected_personal:/ {print $2}')
    V=$(echo "$OUT" | awk '/^  review_needed:/ {print $2}')
    echo "[$(date +%H:%M:%S)] $VID p$pass  approved=${A:-0} rejected=${R:-0} review=${V:-0} fetched=$FETCHED" | tee -a "$LOG"
    TOTAL_APPROVED=$((TOTAL_APPROVED + ${A:-0}))
    TOTAL_REJECTED=$((TOTAL_REJECTED + ${R:-0}))
    TOTAL_REVIEW=$((TOTAL_REVIEW + ${V:-0}))
    if [ "$FETCHED" -lt 1500 ]; then break; fi
  done
done
echo "[$(date +%H:%M:%S)] deep chunk=$LABEL DONE  approved=$TOTAL_APPROVED rejected=$TOTAL_REJECTED review=$TOTAL_REVIEW" | tee -a "$LOG"
