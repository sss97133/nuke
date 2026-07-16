#!/usr/bin/env bash
# vision-gate-drain-fleet.sh — FLEET-WIDE vision-gate promoter (cheap layers only).
#
# The gap this closes: new owner photos land at vision_gate_status='pending'
# (the column default) and stay there. The live BYOK deep-analysis fleet
# (com.nuke.byok-image-analysis) only drains frames the gate has ALREADY
# advanced to 'approved'. With nothing running the gate, approved never grows
# and inflow stalls. scripts/vision-gate-classify.mjs is the promoter but had
# no scheduler — this wrapper is what the launchd plist
# (com.nuke.vision-gate-approver) fires every 15 min.
#
# SAFETY (cardinal no-mixed-data rule): CHEAP LAYERS ONLY. We never pass
# --call-vision. vision-gate-classify runs L0 caption/filename text, L1 source
# rules, L2 apple_ml labels, L3 explicit flags, and L0.5 sender-affinity — all
# evidence already in the DB. It approves clear-evidence frames and HOLDS
# ambiguous ones as review_needed. That hold is correct: review_needed frames
# wait for L4 (scripts/vision-gate-l4.mjs, agent-driven, human-in-loop) — they
# are NOT force-approved here. No unsupervised vision attribution at volume.
#
# Vehicle source: image_coverage_by_vehicle (the same bounded ~80-row counter
# byok-fleet-next.mjs reads — NEVER the 38.9M-row vehicle_images table). We
# pick vehicles with a real gate deficit (photos > gated_t0) or recent inflow
# (inflow_7d > 0). Per-vehicle classify is indexed on vehicle_id and fast.
#
# Idempotent + resumable: --include-null makes classify touch only NULL/pending
# rows (and, without --include-review, it leaves existing review_needed alone).
# Killing this mid-run loses nothing; the next fire re-derives work from the DB.
#
# Ghosts are skipped — they must be reattributed (unmerge_vehicle), not gated.
#
# Usage:  vision-gate-drain-fleet.sh [per_vehicle_limit] [max_vehicles]
#   per_vehicle_limit  rows classified per vehicle per fire (default 80)
#   max_vehicles       cap vehicles touched per fire (default 40)
set -u
cd "$(dirname "$0")/../.." || exit 1
export PATH="/Users/skylar/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

LIMIT="${1:-80}"
MAXV="${2:-40}"
LOG="/Users/skylar/nuke/logs/vision-gate-drain-fleet.log"
mkdir -p /Users/skylar/nuke/logs
log(){ echo "$(date '+%F %T') | vision-gate-fleet | $*" | tee -a "$LOG"; }

# Ghost vehicles — DO NOT GATE. Reattribution (unmerge_vehicle) must happen first.
# Kept in sync with scripts/vision-gate-drain.sh GHOSTS.
GHOSTS=(
  "e08bf694-970f-4cbe-8a74-8715158a0f2e"  # K5 ghost (GAA-43671 incident)
  "5a1deb95-4b67-4cc3-9575-23bb5b180693"  # K2500 NULL-VIN ghost candidate
  "d6a01df2-dc78-4fe9-9559-2c4cf6124a7a"  # K2500 NULL-VIN ghost candidate
)
is_ghost(){ local v="$1"; for g in "${GHOSTS[@]}"; do [[ "$v" == "$g" ]] && return 0; done; return 1; }

# Pull candidate vehicle_ids from the bounded coverage counter (not the big table).
# Deficit-first (photos beyond what's gated), then recent inflow. macOS bash 3.2
# has no mapfile, so word-split into an array (UUIDs have no spaces). psql errors
# go to the log; only UUIDs reach the array via the grep filter.
SQL="SELECT vehicle_id FROM image_coverage_by_vehicle \
WHERE photos > 0 AND (photos > COALESCE(gated_t0,0) OR COALESCE(inflow_7d,0) > 0) \
ORDER BY COALESCE(inflow_7d,0) DESC, (photos - COALESCE(gated_t0,0)) DESC LIMIT ${MAXV};"

# Pooler DSN; password from dotenvx (.env SUPABASE_DB_PASSWORD).
POOLER="host=aws-0-us-west-1.pooler.supabase.com port=6543 user=postgres.qkgaybvrernstplzjaam dbname=postgres sslmode=require"
CAND=( $(dotenvx run --quiet -- bash -c "PGPASSWORD=\"\$SUPABASE_DB_PASSWORD\" psql \"$POOLER\" -t -A -c \"$SQL\"" 2>>"$LOG" | grep -E '^[0-9a-f-]{36}$') )

if [ "${#CAND[@]}" -eq 0 ]; then log "no candidate vehicles with gate deficit — gate drained"; exit 0; fi
log "ranked ${#CAND[@]} candidate vehicles; head=${CAND[0]} (per-vehicle limit=$LIMIT)"

TOT_A=0; TOT_R=0; TOT_V=0; TOUCHED=0
for VID in "${CAND[@]}"; do
  [[ "$VID" =~ ^[0-9a-f-]{36}$ ]] || continue
  if is_ghost "$VID"; then log "$VID  GHOST — skipped (needs reattribution, not gating)"; continue; fi

  OUT=$(dotenvx run --quiet -- node scripts/vision-gate-classify.mjs \
        --vehicle-id "$VID" --limit "$LIMIT" --include-null 2>&1 | tail -10)
  A=$(echo "$OUT" | awk '/^  approved:/ {print $2}')
  R=$(echo "$OUT" | awk '/^  rejected_personal:/ {print $2}')
  V=$(echo "$OUT" | awk '/^  review_needed:/ {print $2}')
  log "$VID  approved=${A:-0} rejected_personal=${R:-0} review_needed=${V:-0}"
  TOT_A=$((TOT_A + ${A:-0})); TOT_R=$((TOT_R + ${R:-0})); TOT_V=$((TOT_V + ${V:-0}))
  TOUCHED=$((TOUCHED + 1))
done

log "DONE touched=$TOUCHED  approved=$TOT_A rejected_personal=$TOT_R review_needed=$TOT_V"
exit 0
