#!/usr/bin/env bash
# byok-cloud-drain.sh — laptop-free BYOK analysis drain (runs in CI, not on a Mac).
#
# The launchd drain (byok-image-drain.sh) ties analysis to Skylar's laptop being on.
# That is not a product. This is the same detective, run in a cloud GitHub Actions
# runner instead: a TIME-BOUNDED burn across the user's vehicles using the same proven
# byok-image-batch unit. Stateless — no cursor needed, because prepare only pulls
# frames still lacking a verdict, so each scheduled run simply continues where the
# last one stopped.
#
# Network here is a normal runner (no Claude Code Bash sandbox), so all steps reach
# Supabase fine. The vision step uses `claude --print`, authenticated by the Claude
# SUBSCRIPTION via CLAUDE_CODE_OAUTH_TOKEN (set in the workflow) — not a pay-per-token
# API key. Default model is Sonnet, which the batch notes is "fast + accurate enough
# for the bulk drain" and is easier on subscription rate limits than Opus.
#
# Usage: byok-cloud-drain.sh <user-id> [batch_size] [minutes]
set -u
cd "$(dirname "$0")/../.." || exit 1
HERE="$(dirname "$0")"

USER_ID="${1:?usage: byok-cloud-drain.sh <user-id> [batch_size] [minutes]}"
BATCH="${2:-12}"
MINUTES="${3:-45}"
DEADLINE=$(( $(date +%s) + MINUTES * 60 ))
log(){ echo "$(date -u '+%F %T') | cloud-drain | $*"; }

# Vehicles with approved frames, most-first (cheap; prepare skips drained ones instantly).
VEH=()
while IFS= read -r line; do
  [[ "$line" =~ ^[0-9a-f-]{36}$ ]] && VEH+=("$line")
done < <(dotenvx run -- node scripts/deep-image-analysis-byok.mjs queue --user-id "$USER_ID" 2>&1)

if [ "${#VEH[@]}" -eq 0 ]; then
  log "vehicle queue empty or query failed — abort (NOT a drain)"; exit 1
fi
log "queue: ${#VEH[@]} vehicles; time budget ${MINUTES}m, batch ${BATCH}, model ${BYOK_MODEL:-claude-sonnet-4-6}"

did=0
for vid in "${VEH[@]}"; do
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    bash "$HERE/byok-image-batch.sh" "$vid" "$BATCH"; rc=$?
    case "$rc" in
      3) break ;;                                   # vehicle drained → next vehicle
      1) log "transient on ${vid:0:8} — backoff 10s, retry"; sleep 10 ;;   # network blip; never skip
      *) did=$((did + 1)) ;;                         # did real work; keep going on this vehicle
    esac
  done
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    log "time budget reached — stopping (next scheduled run resumes; analysis is idempotent)"; break
  fi
done
log "done: $did batches analyzed this run"
