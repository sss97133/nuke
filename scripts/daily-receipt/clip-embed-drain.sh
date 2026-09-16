#!/bin/bash
# clip-embed-drain.sh — scheduled drainer for image_observations.embedding_clip_vitb32.
#
# Closes the audit's Phase-4(c) gap: the engine rows (Tier 2 PLACED) exist but ~94% lack a
# CLIP embedding, so visual search/convergence is dark. The embedder (clip-embed-image-
# observations.py, local CLIP ViT-B/32 on MPS, zero API cost) only ever ran once by hand.
# This wraps it for launchd: --all drains every null-embedding active row, then exits; the
# launchd StartInterval re-fires it so newly-PLACED rows (from the BYOK deep writer's
# ingest_image_observation call) get embedded as coverage deepens.
#
# Runs in the login shell (NOT Claude Code's Bash sandbox) so it reaches Supabase + MPS.
# mkdir-lock (macOS has no flock) prevents overlapping fires from stacking GPU work.
set -uo pipefail
cd /Users/skylar/nuke || exit 1
LOCK=/tmp/com.nuke.clip-embed.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%H:%M:%S') clip-embed: previous drain still running ($LOCK) — skipping this fire"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
echo "=== $(date '+%Y-%m-%d %H:%M:%S') clip-embed-drain start ==="
/opt/homebrew/bin/dotenvx run -- /opt/homebrew/bin/python3 scripts/clip-embed-image-observations.py --all
rc=$?
echo "=== $(date '+%Y-%m-%d %H:%M:%S') clip-embed-drain done rc=$rc ==="
exit $rc
