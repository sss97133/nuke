#!/bin/bash
# Subscription-funded RSI controller. The launchd entry point may pipe this file
# from origin/main, so load the controller from the same fetched revision.
set -euo pipefail
REPO=${NIGHT_RUN_REPO:-$HOME/nuke}
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/controller.py" ]; then
  exec python3 "$(dirname "${BASH_SOURCE[0]}")/controller.py" "$@"
fi
CONTROLLER=$(mktemp "${TMPDIR:-/tmp}/nuke-night-controller.XXXXXX")
trap 'rm -f "$CONTROLLER"' EXIT
git -C "$REPO" show origin/main:scripts/night-run/controller.py > "$CONTROLLER"
python3 "$CONTROLLER" "$@"
