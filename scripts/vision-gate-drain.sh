#!/usr/bin/env bash
# vision-gate-drain.sh — runs vision-gate-classify across a chunk of vehicle IDs.
# Cheap-layer only (no --call-vision). Idempotent — only touches NULL/pending rows.
#
# Usage:
#   vision-gate-drain.sh <chunk_label> <vehicle_id> [vehicle_id ...]
#   echo "uuid1 uuid2 ..." | xargs -n 20 -P 5 vision-gate-drain.sh chunk
#
# Skips known ghost vehicles (must be reattributed via unmerge_vehicle, not gated).

set -u
LABEL="$1"; shift
LOG="/Users/skylar/nuke/logs/vision-gate-drain-${LABEL}-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$(dirname "$LOG")"

# Ghost vehicles — DO NOT DRAIN. Reattribution must happen first.
GHOSTS=(
  "e08bf694-970f-4cbe-8a74-8715158a0f2e"  # K5 ghost (GAA-43671 incident)
  "5a1deb95-4b67-4cc3-9575-23bb5b180693"  # K2500 NULL-VIN ghost candidate
  "d6a01df2-dc78-4fe9-9559-2c4cf6124a7a"  # K2500 NULL-VIN ghost candidate
)

is_ghost() {
  local vid="$1"
  for g in "${GHOSTS[@]}"; do [[ "$vid" == "$g" ]] && return 0; done
  return 1
}

cd /Users/skylar/nuke

echo "[$(date +%H:%M:%S)] chunk=$LABEL count=$# starting" | tee -a "$LOG"
TOTAL_APPROVED=0; TOTAL_REJECTED=0; TOTAL_REVIEW=0

for VID in "$@"; do
  if is_ghost "$VID"; then
    echo "[$(date +%H:%M:%S)] $VID  GHOST — skipped" | tee -a "$LOG"
    continue
  fi
  OUT=$(dotenvx run --quiet -- node scripts/vision-gate-classify.mjs \
        --vehicle-id "$VID" --include-null --limit 2000 2>&1 | tail -8)
  TALLY=$(echo "$OUT" | grep -E "approved:|rejected_personal:|review_needed:" | tr '\n' ' ')
  echo "[$(date +%H:%M:%S)] $VID  $TALLY" | tee -a "$LOG"

  A=$(echo "$OUT" | awk '/^  approved:/ {print $2}')
  R=$(echo "$OUT" | awk '/^  rejected_personal:/ {print $2}')
  V=$(echo "$OUT" | awk '/^  review_needed:/ {print $2}')
  TOTAL_APPROVED=$((TOTAL_APPROVED + ${A:-0}))
  TOTAL_REJECTED=$((TOTAL_REJECTED + ${R:-0}))
  TOTAL_REVIEW=$((TOTAL_REVIEW + ${V:-0}))
done

echo "[$(date +%H:%M:%S)] chunk=$LABEL DONE  approved=$TOTAL_APPROVED rejected=$TOTAL_REJECTED review=$TOTAL_REVIEW" | tee -a "$LOG"
