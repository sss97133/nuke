#!/usr/bin/env bash
# content-miner-batch.sh — one bounded run of the X content bank-builder.
#
# Mines new idea-dense material (recent Claude sessions + contemplations), drafts X post
# candidates via a BYOK model (Gemini, NOT Anthropic), runs them through the structural gate
# (no em-dashes, no commodity phrases, facts sourced + web-verified), and appends survivors
# to docs/content/X_BANK.md. Nothing is published. Skylar skims the bank and ❌'s duds.
#
# Runs in the login shell (NOT Claude Code's Bash sandbox) so the BYOK + citation-verify HTTP
# calls reach the network normally (see byok-image-batch.sh header for the sandbox gotcha).
#
# Exit codes from content-miner.mjs: 0 = candidates added · 3 = drained (no new material) · 1 = error.
# Usage:  content-miner-batch.sh [--selftest]
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

LOG_DIR="/Users/skylar/nuke/logs"
LOG="$LOG_DIR/content-miner.log"
LOCK="/tmp/content-miner.lock"
mkdir -p "$LOG_DIR"
log(){ echo "$(date '+%F %T') | $*" | tee -a "$LOG"; }

# One run at a time across all invocations (launchd + manual)
if [ -f "$LOCK" ]; then
  pid=$(cat "$LOCK" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then log "already running (PID $pid) — skip"; exit 0; fi
fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT

log "content-miner start ${1:-}"
dotenvx run -- node scripts/content-miner.mjs "$@" 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}
case "$RC" in
  0) log "done — candidates added to bank" ;;
  3) log "drained — no new material" ;;
  *) log "error (rc=$RC)" ;;
esac
exit "$RC"
