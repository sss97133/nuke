#!/bin/bash
# export_live_by_slugs.sh <slug-file> <out.jsonl> [chunk=1000]
# Live prod vehicles rows for every BaT slug, via ONE indexed OR-lookup per chunk (bat_auction_url /
# listing_url / discovery_url, 4 URL variants each). Read-only; ~2.4 s per 1,000 slugs measured 15:35Z.
set -u
SLUGS=$1; OUT=$2; CHUNK=${3:-1000}
Q=/Users/skylar/nuke/scripts/data/q.sh
: > "$OUT"
W=$(mktemp -d); split -l "$CHUNK" -a 4 "$SLUGS" "$W/c_"
n=0; rows=0
for f in "$W"/c_*; do
  n=$((n+1))
  arr=$(awk '{printf "%s'"'"'http://bringatrailer.com/listing/%s'"'"','"'"'https://bringatrailer.com/listing/%s'"'"','"'"'http://bringatrailer.com/listing/%s/'"'"','"'"'https://bringatrailer.com/listing/%s/'"'"'", (NR>1?",":""), $1,$1,$1,$1}' "$f")
  for attempt in 1 2 3 4; do
    res=$($Q "select id, bat_auction_url, listing_url, discovery_url, vin, year, make, model, sale_price, sold_price, bat_sold_price, winning_bid, high_bid, canonical_sold_price, canonical_outcome, auction_outcome, reserve_status, sale_status, sale_date, bat_sale_date, auction_end_date, bat_buyer, bat_seller, merged_into_vehicle_id, deleted_at, is_public, status, updated_at, description_source, length(description) as description_len, (provenance_metadata ? 'sale_provenance_corrections') as has_corr from vehicles where bat_auction_url = any(array[$arr]) or listing_url = any(array[$arr]) or discovery_url = any(array[$arr])")
    # a whole JSON array or retry: a timed-out call (curl exit 28) can hand back a partial body that still
    # starts with "[" — on 2026-09-28 two such chunks passed a '^\[' check and silently lost 1,498 rows
    if echo "$res" | jq -e 'type == "array"' >/dev/null 2>&1; then break; fi
    echo "$(date -u +%FT%TZ) chunk $n attempt $attempt: $(echo "$res" | cut -c1-120)" >&2
    sleep $((attempt * 20)); res=""
  done
  [ -z "$res" ] && { echo "chunk $n failed for good" >&2; exit 1; }
  c=$(echo "$res" | jq 'length'); rows=$((rows+c))
  echo "$res" | jq -c '.[]' >> "$OUT"
  [ $((n % 20)) -eq 0 ] && echo "$(date -u +%FT%TZ) chunk $n: $rows rows so far"
  sleep 0.5
done
jq -c -s 'unique_by(.id)[]' "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
rm -rf "$W"
echo "$(date -u +%FT%TZ) done: $(wc -l < "$OUT") unique rows from $n chunks"
