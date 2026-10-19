#!/bin/bash
# Part of the 2026-09-27 BaT sale-correction chain (see apply_batches.sh, which is the script that wrote prod). Recovered 2026-10-15 from
# the untracked ~/nuke/scripts/data/batwriter/; this script itself does not write prod.
# export_batches.sh <out-dir> [batch_size] [where-clause]
# Exports work.duckdb `corrections` (built by gen_corrections.sql against LIVE rows) into
# batch_NNNN.json files, each a JSON array for correct_vehicle_sale_provenance_batch.
set -u
OUT=$1; SIZE=${2:-200}; WHERE=${3:-1=1}
mkdir -p "$OUT"; rm -f "$OUT"/batch_*.json "$OUT"/batch_*.json.done
duckdb /private/tmp/claude-501/-Users-skylar/cb179857-844e-47f9-99c5-4faa3bd1d836/scratchpad/work.duckdb \
  "COPY (SELECT row_json FROM corrections WHERE $WHERE ORDER BY vehicle_id) TO '$OUT/rows.jsonl' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '')" >/dev/null
split -l "$SIZE" -a 4 "$OUT/rows.jsonl" "$OUT/part_"
i=0
for f in "$OUT"/part_*; do
  i=$((i+1))
  jq -c -s '.' "$f" > "$OUT/batch_$(printf '%04d' $i).json" && rm -f "$f"
done
echo "batches: $i, vehicles: $(wc -l < "$OUT/rows.jsonl")"
