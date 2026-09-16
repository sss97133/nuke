#!/usr/bin/env bash
# vision-gate-redrain.sh — re-classify review_needed rows with the current lexicon.
# Same as vision-gate-drain.sh but uses --include-review to upgrade rows that
# now match expanded lexicon. Skips L4-claimed rows (script handles internally).
set -u
LABEL="$1"; shift
LOG="/Users/skylar/nuke/logs/vision-gate-redrain-${LABEL}-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$(dirname "$LOG")"

GHOSTS=(
  "e08bf694-970f-4cbe-8a74-8715158a0f2e"
  "5a1deb95-4b67-4cc3-9575-23bb5b180693"
  "d6a01df2-dc78-4fe9-9559-2c4cf6124a7a"
)
is_ghost() {
  local vid="$1"
  for g in "${GHOSTS[@]}"; do [[ "$vid" == "$g" ]] && return 0; done
  return 1
}

cd /Users/skylar/nuke
echo "[$(date +%H:%M:%S)] redrain chunk=$LABEL count=$# starting" | tee -a "$LOG"
TOTAL_APPROVED=0; TOTAL_REJECTED=0; TOTAL_REVIEW=0
for VID in "$@"; do
  if is_ghost "$VID"; then
    echo "[$(date +%H:%M:%S)] $VID  GHOST — skipped" | tee -a "$LOG"; continue
  fi
  OUT=$(dotenvx run --quiet -- node scripts/vision-gate-classify.mjs \
        --vehicle-id "$VID" --include-review --limit 2000 2>&1 | tail -10)
  TALLY=$(echo "$OUT" | grep -E "approved:|rejected_personal:|review_needed:|skipped" | tr '\n' ' ')
  echo "[$(date +%H:%M:%S)] $VID  $TALLY" | tee -a "$LOG"
  A=$(echo "$OUT" | awk '/^  approved:/ {print $2}')
  R=$(echo "$OUT" | awk '/^  rejected_personal:/ {print $2}')
  V=$(echo "$OUT" | awk '/^  review_needed:/ {print $2}')
  TOTAL_APPROVED=$((TOTAL_APPROVED + ${A:-0}))
  TOTAL_REJECTED=$((TOTAL_REJECTED + ${R:-0}))
  TOTAL_REVIEW=$((TOTAL_REVIEW + ${V:-0}))
done
echo "[$(date +%H:%M:%S)] redrain chunk=$LABEL DONE  approved=$TOTAL_APPROVED rejected=$TOTAL_REJECTED review=$TOTAL_REVIEW" | tee -a "$LOG"
