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
# Usage: byok-cloud-drain.sh <user-id> [batch_size] [minutes] [vehicle_id]
#   vehicle_id (optional): drain ONLY that one vehicle (the per-image "Analyze" button
#   in the app targets the image's vehicle). Omitted → drain the whole fleet, most-first.
set -u
cd "$(dirname "$0")/../.." || exit 1
HERE="$(dirname "$0")"

USER_ID="${1:?usage: byok-cloud-drain.sh <user-id> [batch_size] [minutes] [vehicle_id]}"
BATCH="${2:-12}"
MINUTES="${3:-45}"
ONLY_VEHICLE="${4:-}"
DEADLINE=$(( $(date +%s) + MINUTES * 60 ))
log(){ echo "$(date -u '+%F %T') | cloud-drain | $*"; }

# Broker: resolve THIS user's chosen compute from app Settings (user_analysis_settings)
# and load the right credential into the env. This is what lets a user pick their method
# in the UI instead of us hardcoding one GitHub secret. The resolver decrypts via a
# service-role-only RPC; we eval its output but never echo the secret.
RESOLVED="$(dotenvx run -- node scripts/deep-image-analysis-byok.mjs resolve --user-id "$USER_ID" 2>/dev/null)"
if [ -n "$RESOLVED" ]; then
  while IFS= read -r kv; do [ -n "$kv" ] && export "$kv"; done <<< "$RESOLVED"
fi
METHOD="${NUKE_ANALYSIS_METHOD:-nuke_hosted}"
if [ "${NUKE_ANALYSIS_ENABLED:-1}" = "0" ]; then
  log "user has analysis DISABLED in settings — nothing to do"; exit 0
fi
# An API-key method must not silently fall through to the subscription token. If the
# user picked byo_api_key, the subscription token would take a back seat to the API key
# we just exported; if they picked byo_subscription, drop any stray API key so it wins.
if [ "$METHOD" = "byo_subscription" ]; then unset ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_API_KEY; fi
log "compute method: $METHOD (model ${BYOK_MODEL:-claude-sonnet-4-6})"

# Vision can't run without SOME credential. For nuke_hosted / byo_subscription that's the
# OAuth token (repo secret or the user's vault); for byo_api_key it's the provider key the
# broker exported. Fail loud here rather than burning a run that produces no verdicts.
case "$METHOD" in
  byo_api_key)
    if [ -z "${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}${GOOGLE_API_KEY:-}" ]; then
      log "method byo_api_key but no provider key resolved — abort"; exit 1
    fi ;;
  *)
    if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
      log "no CLAUDE_CODE_OAUTH_TOKEN (subscription) available — set it in Settings or as a repo secret — abort"; exit 1
    fi ;;
esac

# Build the work list. Single-vehicle when targeted from the app; otherwise the whole
# fleet, most-first (cheap; prepare skips drained ones instantly).
VEH=()
if [[ "$ONLY_VEHICLE" =~ ^[0-9a-f-]{36}$ ]]; then
  VEH=("$ONLY_VEHICLE")
  log "targeted run: single vehicle ${ONLY_VEHICLE:0:8}"
else
  while IFS= read -r line; do
    [[ "$line" =~ ^[0-9a-f-]{36}$ ]] && VEH+=("$line")
  done < <(dotenvx run -- node scripts/deep-image-analysis-byok.mjs queue --user-id "$USER_ID" 2>&1)
fi

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
