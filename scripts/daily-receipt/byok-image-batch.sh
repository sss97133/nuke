#!/usr/bin/env bash
# Existing BYOK engine, bounded foreground entry. Unattended callers must migrate
# deliberately; never silently reuse their former raw-write/permission bypass.
set -euo pipefail
if [ "${1:-}" != --reviewed ]; then
  echo 'Use --reviewed --vehicle-id UUID --limit 1..8 --out-dir PATH [--apply]. Legacy raw batch retired; no model or writes started.' >&2
  exit 2
fi
shift
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec deno run --cached-only --node-modules-dir=none --allow-read --allow-write --allow-env --allow-net --allow-run \
  "$ROOT/scripts/daily-receipt/reviewed-image-batch.ts" "$@"
