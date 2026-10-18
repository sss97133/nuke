#!/bin/bash
# lookup_raw.sh <ids-file> <out-ids-file> [chunk=2000]
# Which of these vehicle ids already hold an extraction_metadata row field_name='raw_listing_description'
# (idx_extraction_vehicle). Read-only.
set -u
IDS=$1; OUT=$2; CHUNK=${3:-2000}
Q=/Users/skylar/nuke/scripts/data/q.sh
: > "$OUT"; W=$(mktemp -d); split -l "$CHUNK" "$IDS" "$W/c_"; n=0
for f in "$W"/c_*; do
  n=$((n+1))
  arr=$(awk '{printf "%s'"'"'%s'"'"'", (NR>1?",":""), $1}' "$f")
  for attempt in 1 2 3; do
    res=$($Q "select distinct vehicle_id from extraction_metadata where field_name = 'raw_listing_description' and vehicle_id = any(array[$arr]::uuid[])")
    if echo "$res" | grep -q '^\['; then echo "$res" | jq -r '.[].vehicle_id' >> "$OUT"; break; fi
    echo "chunk $n attempt $attempt: $(echo "$res" | cut -c1-100)" >&2; sleep $((attempt*15)); res=""
  done
  [ -z "$res" ] && { echo "chunk $n failed" >&2; exit 1; }
  sleep 0.3
done
rm -rf "$W"; echo "ids with a raw description row: $(wc -l < "$OUT") of $(wc -l < "$IDS")"
