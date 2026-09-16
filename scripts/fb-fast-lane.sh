#!/usr/bin/env bash
# fb-fast-lane.sh — one pass of the local deal catcher. Runs in the login shell (network OK).
# Pulls Skylar's metro FB vehicle feed via working GraphQL, filters to flip targets, fires
# instant Telegram on new matches. Built for a tight launchd cadence (every ~10 min).
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
LOG="/Users/skylar/nuke/logs/fb-fast-lane.log"; mkdir -p "$(dirname "$LOG")"
LOCK="/tmp/fb-fast-lane.lock"
log(){ echo "$(date '+%F %T') | $*" | tee -a "$LOG"; }
if [ -f "$LOCK" ]; then pid=$(cat "$LOCK" 2>/dev/null); if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then log "already running ($pid) — skip"; exit 0; fi; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
dotenvx run -- node scripts/fb-fast-lane.mjs "$@" 2>&1 | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
