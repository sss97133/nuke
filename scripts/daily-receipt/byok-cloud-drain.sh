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

USER_ID="${1:?usage: byok-cloud-drain.sh <user-id> [batch_size] [minutes] [vehicle_id] [shard_count] [shard_index]}"
BATCH="${2:-12}"
MINUTES="${3:-45}"
ONLY_VEHICLE="${4:-}"
SHARD_COUNT="${5:-1}"   # parallel drain: split the fleet across N runners
SHARD_INDEX="${6:-0}"   # which slice THIS runner owns (0..N-1)
MAX_FAILURES="${BYOK_MAX_FAILURES:-3}"
if ! [[ "$MAX_FAILURES" =~ ^([1-9]|10)$ ]]; then
  echo 'cloud-drain | invalid failure budget (expected 1..10)' >&2; exit 1
fi
DEADLINE=$(( $(date +%s) + MINUTES * 60 ))
log(){ echo "$(date -u '+%F %T') | cloud-drain | $*"; }

# Broker: resolve THIS user's chosen compute from app Settings (user_analysis_settings)
# and load the right credential into the env. This is what lets a user pick their method
# in the UI instead of us hardcoding one GitHub secret. The resolver decrypts via a
# service-role-only RPC; we eval its output but never echo the secret.
RESOLVED="$(dotenvx run -- node scripts/deep-image-analysis-byok.mjs resolve --user-id "$USER_ID" 2>/dev/null)"
if [ "$?" -ne 0 ]; then
  log "credential resolution failed — abort (no fallback)"; exit 1
fi
if [ -n "$RESOLVED" ]; then
  # Export ONLY well-formed KEY=VALUE lines. dotenvx prints a human banner
  # ("⟐ injected env (N)") to stdout; exporting that line trips
  # "not a valid identifier" and pollutes the resolve output. Filter to shell
  # identifiers so the banner (or any stray line) is skipped, not exported.
  while IFS= read -r kv; do
    case "$kv" in
      [A-Za-z_]*=*) export "$kv" ;;
    esac
  done <<< "$RESOLVED"
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
  QUEUE="$(dotenvx run -- node scripts/deep-image-analysis-byok.mjs queue --user-id "$USER_ID" 2>/dev/null)"
  if [ "$?" -ne 0 ]; then
    log "vehicle queue query failed — abort (remaining unknown)"; exit 1
  fi
  while IFS= read -r line; do
    [[ "$line" =~ ^[0-9a-f-]{36}$ ]] && VEH+=("$line")
  done <<< "$QUEUE"
fi

if [ "${#VEH[@]}" -eq 0 ]; then
  log "vehicle queue query succeeded with no eligible vehicles"; exit 0
fi

# Vehicle-level sharding for a PARALLEL drain. A single serial run only reaches the head
# of a long least-analyzed-first queue inside its time budget, so the tail starved —
# zero-coverage vehicles sat at 0% (measured: 19 of the owner's vehicles, 961 frames,
# never analyzed) while the drain re-chewed the front. Splitting the queue across N
# parallel matrix shards (each a separate runner) lets pass-1 finish for EVERY vehicle.
# Each shard owns disjoint WHOLE vehicles (hash of id % N), so no frame is analyzed twice
# and byok-image-batch keeps its per-vehicle day cursor. Order (least-analyzed-first) is
# preserved within the shard. Targeted single-vehicle runs land on exactly one shard.
if [ "$SHARD_COUNT" -gt 1 ]; then
  SHARDED=()
  for vid in "${VEH[@]}"; do
    h=$(printf '%s' "$vid" | md5sum | cut -c1-8)
    [ $(( 0x$h % SHARD_COUNT )) -eq "$SHARD_INDEX" ] && SHARDED+=("$vid")
  done
  VEH=("${SHARDED[@]}")
  if [ "${#VEH[@]}" -eq 0 ]; then
    log "shard ${SHARD_INDEX}/${SHARD_COUNT}: no vehicles in this slice — nothing to do"; exit 0
  fi
  log "shard ${SHARD_INDEX}/${SHARD_COUNT}: ${#VEH[@]} of the fleet's vehicles"
fi
log "queue: ${#VEH[@]} vehicles; time budget ${MINUTES}m, batch ${BATCH}, model ${BYOK_MODEL:-claude-sonnet-4-6}"

# Round-robin across vehicles: ONE batch per vehicle per pass, cycling until the time
# budget runs out or every vehicle is drained. Biggest-first (drain each vehicle fully
# before the next) starved breadth — one big vehicle hogged whole runs while 100+ stayed
# at 0% and showed empty when browsed. Rotating one batch each spreads coverage fast.
did=0
failures=0
attempts=0
quota_deferred=0
# Space-delimited UUID set; works in both runner Bash and the Mac's Bash 3.
DRAINED=" "
is_drained(){ [[ "$DRAINED" == *" $1 "* ]]; }
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  progressed=0
  for vid in "${VEH[@]}"; do
    [ "$(date +%s)" -ge "$DEADLINE" ] && break
    is_drained "$vid" && continue
    attempts=$((attempts + 1))
    bash "$HERE/byok-image-batch.sh" "$vid" "$BATCH"; rc=$?
    case "$rc" in
      3) DRAINED="$DRAINED$vid " ;;                      # vehicle drained → drop from rotation
      0) did=$((did + 1)); progressed=1 ;;              # verified batch receipt
      4)
        quota_deferred=1
        log "compute quota unavailable — defer this shard without further batch attempts"
        break 2 ;;
      *)
        failures=$((failures + 1))
        log "batch failed: exit=$rc failures=$failures limit=$MAX_FAILURES"
        if [ "$failures" -ge "$MAX_FAILURES" ]; then
          log "failure budget exhausted — stopping"; break 2
        fi
        sleep 10 ;;
    esac
  done
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    log "time budget reached — stopping (next scheduled run resumes; analysis is idempotent)"; break
  fi
  # Stop early only when every vehicle is drained (no undrained left).
  if [ "$progressed" -eq 0 ]; then
    remaining=0
    for vid in "${VEH[@]}"; do is_drained "$vid" || remaining=$((remaining + 1)); done
    [ "$remaining" -eq 0 ] && { log "all vehicles drained this run"; break; }
  fi
done
log "done: $did batches analyzed this run (round-robin, breadth-first)"
remaining=0
for vid in "${VEH[@]}"; do is_drained "$vid" || remaining=$((remaining + 1)); done
outcome=complete
[ "$remaining" -gt 0 ] && outcome=incomplete
[ "$quota_deferred" -eq 1 ] && outcome=deferred_quota
[ "$failures" -gt 0 ] && outcome=failed
log "drain receipt: outcome=$outcome batches=$did failures=$failures attempts=$attempts remaining=$remaining"
if [ "$quota_deferred" -eq 1 ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '### BYOK analysis: %s\n\n' "$outcome"
    printf 'Compute quota is unavailable. Further batches stopped; analysis remains incomplete.\n\n'
    printf 'Verified batches: %s; failed attempts: %s; remaining vehicles in this shard: %s.\n' "$did" "$failures" "$remaining"
  } >> "$GITHUB_STEP_SUMMARY"
fi
[ "$failures" -eq 0 ] || exit 1
# Handled quota deferral is not a processing failure or a completion claim.
[ "$quota_deferred" -eq 0 ] || exit 0
[ "$remaining" -eq 0 ] || exit 2
