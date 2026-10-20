#!/bin/bash
# Subscription-funded RSI controller. The launchd entry point may pipe this file
# from origin/main, so load the controller from the same fetched revision.
set -euo pipefail
REPO=${NIGHT_RUN_REPO:-$HOME/nuke}
# The market editor's critique (scripts/market-critique.mjs, 2026-10-19) runs first, from origin/main's files, and
# writes its report under ~/nuke-logs/market-critique/; each violation there is a candidate objective for the night.
# Read-only (anon key, public readers); a failure never stops the run.
CRITIQUE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nuke-market-critique.XXXXXX")
if git -C "$REPO" archive origin/main scripts/market-critique.mjs nuke_frontend/src/pages/market/mapScale.ts \
     nuke_frontend/src/pages/market/critique.ts nuke_frontend/src/pages/market/scopeMatch.ts 2>/dev/null | tar -x -C "$CRITIQUE_DIR" \
   && [ -d "$REPO/nuke_frontend/node_modules" ]; then
  ln -s "$REPO/nuke_frontend/node_modules" "$CRITIQUE_DIR/nuke_frontend/node_modules"
  mkdir -p "$HOME/nuke-logs/market-critique"
  CRITIQUE_OUT="$HOME/nuke-logs/market-critique/$(date +%F).txt"
  for scope in "" "make=Lexus&family_name=LC"; do
    (cd "$CRITIQUE_DIR" && /opt/homebrew/bin/dotenvx run -q -f "$REPO/.env" -- node scripts/market-critique.mjs --scope "$scope") >> "$CRITIQUE_OUT" 2>&1 || true
  done
fi
rm -rf "$CRITIQUE_DIR"
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/controller.py" ]; then
  exec python3 "$(dirname "${BASH_SOURCE[0]}")/controller.py" "$@"
fi
CONTROLLER=$(mktemp "${TMPDIR:-/tmp}/nuke-night-controller.XXXXXX")
trap 'rm -f "$CONTROLLER"' EXIT
git -C "$REPO" show origin/main:scripts/night-run/controller.py > "$CONTROLLER"
python3 "$CONTROLLER" "$@"
