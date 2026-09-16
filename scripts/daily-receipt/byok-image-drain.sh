#!/usr/bin/env bash
# byok-image-drain.sh — self-driving BYOK analysis drain (one bounded batch per fire).
#
# This is the launchd cron's body. The old plist hardcoded ONE vehicle (the K5 Blazer),
# so the always-on trickle only ever analyzed one car while the rest sat 'completed'
# but un-analyzed. This walks a persistent cursor across ALL of the user's vehicles
# (most-approved-frames first), runs ONE bounded byok-image-batch for the current
# vehicle each fire, and persists the cursor — so the 15-min trickle covers the whole
# fleet and RESUMES where it left off after the laptop sleeps.
#
# Network-blip safe (the 2026-06-02 lesson, where one blip silently skipped the fleet):
#   - a transient batch failure (exit 1) NEVER advances the cursor or marks drained;
#   - a failed vehicle-list refresh keeps the cached list rather than wiping it;
#   - only a genuine drain (byok-image-batch exit 3) advances the cursor.
# It self-drives across vehicles but never silently declares the fleet done on an error.
#
# Coexists with byok-burn-all.sh: that script unloads this cron before its relentless
# parallel run and re-arms it after, so the two never fight.
#
# Usage (and launchd ProgramArguments): byok-image-drain.sh <user-id> [batch_size]
set -u
cd "$(dirname "$0")/../.." || exit 1
HERE="$(dirname "$0")"
export PATH="/Users/skylar/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

USER_ID="${1:?usage: byok-image-drain.sh <user-id> [batch_size]}"
BATCH="${2:-15}"
REFRESH_AGE=3600        # re-query the vehicle list at least hourly (picks up new vehicles/uploads)

STATE_DIR="/Users/skylar/nuke/state"
TAG="${USER_ID:0:8}"
VLIST="$STATE_DIR/byok-drain-$TAG-vehicles.txt"
CURSOR="$STATE_DIR/byok-drain-$TAG-cursor.txt"
LOG="/Users/skylar/nuke/logs/byok-image-batch.log"
LOCK="/tmp/byok-image-drain-$TAG.lock"
mkdir -p "$STATE_DIR" "$(dirname "$LOG")"
log(){ echo "$(date '+%F %T') | drain | $*" | tee -a "$LOG"; }

# One fire at a time — don't overlap a slow prior fire or a manual burn-all.
if [ -f "$LOCK" ]; then
  pid=$(cat "$LOCK" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then log "already running (PID $pid) — skip"; exit 0; fi
fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT

# Refresh the vehicle list if missing or stale. A FAILED refresh must not wipe a good
# list or claim drained — keep the cache; abort only if there is nothing cached.
need_refresh=0
if [ ! -s "$VLIST" ]; then
  need_refresh=1
else
  age=$(( $(date +%s) - $(stat -f %m "$VLIST" 2>/dev/null || echo 0) ))
  [ "$age" -gt "$REFRESH_AGE" ] && need_refresh=1
fi
if [ "$need_refresh" -eq 1 ]; then
  TMP="$VLIST.tmp.$$"
  if dotenvx run -- node scripts/deep-image-analysis-byok.mjs queue --user-id "$USER_ID" 2>>"$LOG" \
       | grep -E '^[0-9a-f-]{36}$' > "$TMP" && [ -s "$TMP" ]; then
    mv "$TMP" "$VLIST"; echo 0 > "$CURSOR"
    log "refreshed vehicle list: $(wc -l < "$VLIST" | tr -d ' ') vehicles"
  else
    rm -f "$TMP"
    if [ ! -s "$VLIST" ]; then log "vehicle-list refresh failed and nothing cached — abort (NOT draining)"; exit 1; fi
    log "vehicle-list refresh failed (network?) — using existing cached list"
  fi
fi

# Load the list (bash 3.2: no mapfile/readarray).
VEH=(); while IFS= read -r line; do [ -n "$line" ] && VEH+=("$line"); done < "$VLIST"
TOTAL=${#VEH[@]}
[ "$TOTAL" -eq 0 ] && { log "empty vehicle list — abort"; exit 1; }

IDX=$(cat "$CURSOR" 2>/dev/null || echo 0); case "$IDX" in ''|*[!0-9]*) IDX=0;; esac
if [ "$IDX" -ge "$TOTAL" ]; then
  log "fleet fully drained ($TOTAL vehicles) — idle until next hourly refresh"
  exit 0
fi

# Walk forward, skipping already-drained vehicles, until we do ONE real batch.
checked=0
while [ "$IDX" -lt "$TOTAL" ] && [ "$checked" -lt "$TOTAL" ]; do
  vid="${VEH[$IDX]}"
  bash "$HERE/byok-image-batch.sh" "$vid" "$BATCH"; rc=$?
  checked=$((checked+1))
  case "$rc" in
    3) IDX=$((IDX+1)); echo "$IDX" > "$CURSOR"; log "drained $vid — cursor $IDX/$TOTAL"; continue;;
    1) echo "$IDX" > "$CURSOR"; log "transient on $vid (network?) — hold cursor $IDX, retry next fire"; exit 1;;
    *) echo "$IDX" > "$CURSOR"; log "batch ran on $vid (rc=$rc) — hold cursor, more frames next fire"; exit 0;;
  esac
done

echo "$TOTAL" > "$CURSOR"
log "reached end of fleet this fire — idle until next hourly refresh"
exit 0
