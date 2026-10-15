#!/bin/bash
# run.sh [cut-date]   The whole exit test in one pass: pull Facebook listings with their family key and the fold's
# recorded-sale rows (bounded pages), build study2.csv, fit and print the four variants' held-out AUC.
# OUT (default ~/nuke-logs/classified-exit) keeps the pulls; set SKIP_LISTINGS=1 to reuse an earlier fbfam.jsonl.
# A variant goes into listing_exit_models only when its held-out AUC lower bound (AUC - 2 se) clears 0.55.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export OUT=${OUT:-$HOME/nuke-logs/classified-exit}; mkdir -p "$OUT"
CUT=${1:-2026-03-30}
[ "${SKIP_LISTINGS:-0}" = 1 ] && [ -s "$OUT/fbfam.jsonl" ] || "$HERE/pull.sh" listings >&2
"$HERE/pull.sh" fold >&2
( cd "$OUT" && duckdb study.duckdb < "$HERE/study.sql" ) 2>&1 | grep -v -i -E 'lambda|deprecat|^$|duckdb.org|revert' >&2 || true
python3 "$HERE/fit.py" "$OUT/study2.csv" "$CUT" | tee "$OUT/fit_$(date -u +%Y%m%dT%H%MZ).json" | python3 -c '
import json, sys
d = json.load(sys.stdin); print("rows", d["rows"], "exits", d["exits"], "cut", d["cut"])
for v in ("price_only", "sold", "asked", "both"):
    x = d.get(v, {}); a = x.get("auc_test")
    gate = (a[0] - 2 * a[1] > 0.55) if a else False
    print(f"{v:10s} n={x.get(\"n\")} test={x.get(\"test\")} exits={x.get(\"test_exits\")} auc={a} clears_gate={gate}")'
