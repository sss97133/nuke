#!/bin/bash
# clip-embed-drain.sh — scheduled drainer for image_observations.embedding_clip_vitb32.
#
# The embedder (clip-embed-image-observations.py, local CLIP ViT-B/32 on MPS, zero API cost) fills the embedding of
# every active image_observations row that has none, newest photo first. Those embeddings are the visual leg of
# capture_sets_score: a phone photo is filed to a vehicle only when its set carries evidence read from the photos, and
# in practice that is this leg (measured 2026-11-20: all of the last 12 sets that filed carried it and every photo in
# them was embedded; the last embedding before that day was written 2026-11-09 and nothing has filed since).
#
# Why it stopped, so it does not stop the same way again:
#   * it ran `python3`, and Homebrew moved python3 to 3.15, which has neither torch nor open_clip (they are installed
#     for 3.14). The interpreter is now the first one found that can import the model's libraries.
#   * it ran the scripts of ~/nuke, a checkout parked on another branch. It now runs the origin/main checkout the
#     subscription reader keeps fresh (~/.worktrees/nuke-main), and falls back to ~/nuke only if that is missing.
#   * a row whose bytes are gone stayed at the head of the batch on every fire. The embedder now remembers such rows
#     for a day (logs/clip-embed-dead.json) and loads the model only when there is a row to embed.
#
# Runs in the login shell (launchd), not Claude Code's sandbox. Secrets come from ~/nuke/.env via dotenvx and are
# never printed. mkdir-lock (macOS has no flock) keeps fires from overlapping.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
ENV_FILE="$HOME/nuke/.env"
MAIN="$HOME/.worktrees/nuke-main"
[ -f "$MAIN/scripts/clip-embed-image-observations.py" ] || MAIN="$HOME/nuke"
LOCK=/tmp/com.nuke.clip-embed.lock
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$STAMP clip-embed: previous drain still running ($LOCK); skipping this fire"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# The first interpreter that can import what the embedder needs. NUKE_CLIP_PYTHON names one outright.
PY=""
for c in "${NUKE_CLIP_PYTHON:-}" /opt/homebrew/bin/python3.14 /opt/homebrew/bin/python3 /opt/homebrew/bin/python3.13 \
         /opt/homebrew/bin/python3.12 "$HOME/nuke/yono/.venv/bin/python" /usr/local/bin/python3; do
  [ -n "$c" ] && [ -x "$c" ] || continue
  if "$c" -c 'import importlib.util as u, sys; sys.exit(0 if all(u.find_spec(m) for m in ("torch", "open_clip", "numpy", "requests", "PIL")) else 1)' >/dev/null 2>&1; then
    PY="$c"; break
  fi
done
if [ -z "$PY" ]; then
  echo "$STAMP clip-embed: no python here has torch and open_clip; nothing embedded this fire (set NUKE_CLIP_PYTHON)"
  exit 3
fi

cd "$HOME/nuke" || exit 1   # dotenvx reads the encrypted .env from here
echo "=== $STAMP clip-embed-drain start ($PY, scripts from $MAIN) ==="
dotenvx run -q -f "$ENV_FILE" -- "$PY" "$MAIN/scripts/clip-embed-image-observations.py" --all
rc=$?
echo "=== $(date '+%Y-%m-%d %H:%M:%S') clip-embed-drain done rc=$rc ==="
exit $rc
