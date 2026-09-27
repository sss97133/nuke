#!/bin/bash
# export_batches.sh <out-dir> [batch_size] [where-clause]
# Exports work.duckdb `corrections` (built by gen_corrections.sql against LIVE rows) into
# batch_NNNN.json files, each a JSON array for correct_vehicle_sale_provenance_batch.
set -u
OUT=$1; SIZE=${2:-200}; WHERE=${3:-1=1}
mkdir -p "$OUT"; rm -f "$OUT"/batch_*.json "$OUT"/batch_*.json.done
duckdb ${BATW:-scripts/data/bat-corrections}/work.duckdb \
  "COPY (SELECT row_json FROM corrections WHERE $WHERE ORDER BY vehicle_id) TO '$OUT/rows.jsonl' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '')" >/dev/null
split -l "$SIZE" -a 4 "$OUT/rows.jsonl" "$OUT/part_"
i=0
for f in "$OUT"/part_*; do
  i=$((i+1))
  # a key whose spec is JSON null means "no proposal" — it must not reach the function (a null spec clears the column)
  jq -c -s '[.[] | .corrections |= with_entries(select(.value != null))] | map(select(.corrections != {}))' "$f" > "$OUT/batch_$(printf '%04d' $i).json" && rm -f "$f"
done
echo "batches: $i, vehicles: $(wc -l < "$OUT/rows.jsonl")"
