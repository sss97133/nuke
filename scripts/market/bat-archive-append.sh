#!/bin/bash
# Daily: append the BaT lots that settled since the last run to the local BaT archive, so the model 31 band and the
# model 32 and 33 finish estimates (scripts/market/live-bands.mjs, live-finish.mjs, live-finish-33.py) price from current sales.
#
# Local only: BaT is the only network; no production reads or writes (bat-keep-fresh runs --no-db). Run from a
# checkout of origin/main (the lot-page parser imports the production parsers by relative path) against the data
# folder of the shared checkout (gitignored, about 10 GB): NUKE_DATA, default /Users/skylar/nuke/scripts/data.
# Launchd ag.nuke.bat-archive-append at 23:10 UTC: BaT closes fall 17:00-22:00 UTC, and the archive rebuild holds the
# file for about 25 s, clear of the hourly :40 (model 31) and :45 (model 32) reads.
#
# Measured 2026-10-15 (plan by the finish-estimate backtest): BaT completed 169 lots a day (151 cars) over the 30 days
# to 09-27; a day is about 8 feed pages and ~170 lot pages: ~180 requests, ~8 minutes. --catch-up pulls 70 feed pages
# and every missing lot page (the first run after 09-27: ~3,100 pages, ~85 minutes at 2 workers, 2 s apart).
set -euo pipefail
RUNNER="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="${NUKE_DATA:-/Users/skylar/nuke/scripts/data}"
PAGES=8; [ "${1:-}" = "--catch-up" ] && PAGES=70
LOCK="$DATA/.bat-archive-append.lock"
if ! mkdir "$LOCK" 2>/dev/null; then echo "$(date -u +%FT%TZ) another append is running ($LOCK)"; exit 0; fi
trap 'rmdir "$LOCK"' EXIT
stamp() { echo "[$(date -u +%FT%TZ)] $*"; }
rebuild() { (cd "$DATA/../.." && duckdb scripts/data/bat-archive.duckdb < "$RUNNER/scripts/bat-archive.sql"); }

stamp "feed: $PAGES pages"
node "$RUNNER/scripts/bat-keep-fresh.mjs" --no-db --save-dir "$DATA/bat-catalog" --max-pages "$PAGES" --caught-up 99 --delay-ms 1500 | tail -1
rebuild
duckdb -noheader -list "$DATA/bat-archive.duckdb" -c "SELECT url FROM sales WHERE slug NOT IN (SELECT slug FROM lots) ORDER BY end_ts DESC" > "$DATA/bat-lots/queue-append.txt"
stamp "lot pages to fetch: $(wc -l < "$DATA/bat-lots/queue-append.txt" | tr -d ' ')"
deno run -A "$RUNNER/scripts/bat-lots-local.ts" --urls "$DATA/bat-lots/queue-append.txt" --out "$DATA/bat-lots" --workers 2 --delay-ms 2000 | tail -1
rebuild
stamp "archive last close: $(duckdb -noheader -list "$DATA/bat-archive.duckdb" -c "SELECT max(end_ts)::date FROM sales")"
python3 "$RUNNER/scripts/market/live-finish.py" --build-cache --archive "$DATA/bat-archive.duckdb" \
  --cache "${LIVE_FINISH_CACHE:-$HOME/Library/Caches/nuke-market-live-finish}" | tail -1
# Model 33's archive history (its fitted artifacts stay in ~/Library/Caches/nuke-finish-33); a failure is logged, not fatal.
BAT_ARCHIVE="$DATA/bat-archive.duckdb" python3 "$RUNNER/scripts/market/live-finish-33.py" --build-cache 2>&1 | tail -1 \
  || echo "model 33 history rebuild failed"
stamp "done"
