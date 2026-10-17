#!/bin/bash
# Run the vision-gate classifier (scripts/vision-gate-classify.mjs, cheap layers only, no --call-vision) over a list of
# vehicle ids, one per line, 80 rows each, 1 s apart. On 2026-10-15 (lane-live-market) it was run over every Craigslist
# vehicle created since 2026-10-13 19:00Z that still had pending images, 40 vehicles (about 500 images) per batch, hour
# by hour newest first: about 9,261 images approved, 0 rejected, 0 held. Usage (from the repo root):
#   dotenvx run -q -- scripts/data/q.sh "select id from vehicles where source='craigslist' and created_at>='<from>' and created_at<'<to>' limit 40" \
#     | python3 -c "import json,sys;[print(r['id']) for r in json.load(sys.stdin)]" > ids.txt
#   scripts/craigslist/gate-vehicles.sh ids.txt
set -u
A=0; R=0; V=0; N=0
while read -r VID; do
  OUT=$(dotenvx run -q -- node scripts/vision-gate-classify.mjs --vehicle-id "$VID" --limit 80 --include-null 2>&1 | tail -8)
  a=$(echo "$OUT" | awk '/^  approved:/ {print $2}'); r=$(echo "$OUT" | awk '/^  rejected_personal:/ {print $2}'); v=$(echo "$OUT" | awk '/^  review_needed:/ {print $2}')
  A=$((A+${a:-0})); R=$((R+${r:-0})); V=$((V+${v:-0})); N=$((N+1))
  sleep 1
done < "$1"
echo "vehicles=$N approved=$A rejected_personal=$R review_needed=$V"
