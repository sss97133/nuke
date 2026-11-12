#!/usr/bin/env bash
# Rebuild every period font from its committed sources.
#   tools/type/build.sh            -> nuke_frontend/public/fonts/period/<family>/ (OTF, WOFF2, provenance JSON)
#   tools/type/build.sh --proofs D -> also writes source overlays and proofs to directory D
# Needs: python3.13 (uv), potrace 1.16 (brew install potrace).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
command -v potrace >/dev/null || { echo "potrace not found (brew install potrace)"; exit 1; }
if [ ! -x .venv/bin/python ]; then
  uv venv -q --python 3.13 .venv
  uv pip install -q --python .venv/bin/python -r requirements.txt
fi
exec .venv/bin/python build.py "$@"
