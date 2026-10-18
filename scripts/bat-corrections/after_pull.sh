#!/bin/zsh
# Waits for the full lot-page pull (PID $1), then: refresh feed → pull newly closed lots → rebuild archive
# → L0 stylometric profile for every user with 100+ comments → print invariants + harness. Local only; no prod writes.
set -u
cd /Users/skylar/nuke
while kill -0 "$1" 2>/dev/null; do sleep 60; done
echo "[$(date -u +%FT%TZ)] pull finished"
dotenvx run -q -- node scripts/bat-keep-fresh.mjs --no-db --max-pages 40 --caught-up 99 --delay-ms 1500 --save-dir scripts/data/bat-catalog | tail -1
duckdb scripts/data/bat-archive.duckdb < scripts/bat-archive.sql
duckdb -noheader -list scripts/data/bat-archive.duckdb -c "SELECT url FROM sales WHERE slug NOT IN (SELECT slug FROM lots) ORDER BY end_ts DESC" > scripts/data/bat-lots/queue-tail.txt
echo "[$(date -u +%FT%TZ)] tail queue: $(wc -l < scripts/data/bat-lots/queue-tail.txt)"
deno run -A scripts/bat-lots-local.ts --urls scripts/data/bat-lots/queue-tail.txt --out scripts/data/bat-lots --workers 5 --delay-ms 2000 | tail -1
duckdb scripts/data/bat-archive.duckdb < scripts/bat-archive.sql
echo "[$(date -u +%FT%TZ)] archive rebuilt; profiling users"
node scripts/user-stylometric-analyzer.mjs --archive scripts/data/bat-archive.duckdb --top 40000 --eras --quiet --save --out scripts/data/bat-personas.jsonl --skip-existing | tail -2
duckdb -box scripts/data/bat-archive.duckdb -c "SELECT * FROM v_integrity" -c "SELECT * FROM v_test_cbt" -c "SELECT * FROM v_test_comments"
echo "[$(date -u +%FT%TZ)] chain done; personas: $(wc -l < scripts/data/bat-personas.jsonl)"
