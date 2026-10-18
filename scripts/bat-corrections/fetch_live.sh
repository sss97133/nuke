#!/bin/bash
# fetch_live.sh <slug-file> <out.jsonl> [chunk]
# Re-reads the LIVE prod vehicles rows for a list of BaT slugs, in small indexed chunks
# (bat_auction_url / listing_url / discovery_url each have an index). Read-only. Sleeps between chunks.
set -u
cd /Users/skylar/nuke
SLUGS=$1; OUT=$2; CHUNK=${3:-150}
: > "$OUT"
W=$(mktemp -d)
split -l "$CHUNK" "$SLUGS" "$W/c_"
n=0
for f in "$W"/c_*; do
  n=$((n+1))
  arr=$(awk '{printf "%s'"'"'http://bringatrailer.com/listing/%s'"'"','"'"'https://bringatrailer.com/listing/%s'"'"','"'"'http://bringatrailer.com/listing/%s/'"'"','"'"'https://bringatrailer.com/listing/%s/'"'"'", (NR>1?",":""), $1,$1,$1,$1}' "$f")
  for col in bat_auction_url listing_url discovery_url; do
    for attempt in 1 2 3; do
      res=$(./scripts/data/q.sh "select id, bat_auction_url, listing_url, discovery_url, vin, year, make, model, sale_price, sold_price, bat_sold_price, winning_bid, high_bid, canonical_sold_price, canonical_outcome, auction_outcome, reserve_status, sale_status, sale_date, auction_end_date, bat_buyer, bat_seller, merged_into_vehicle_id, deleted_at, is_public, status, updated_at, (provenance_metadata ? 'sale_provenance_corrections') as has_corr from vehicles where $col = any(array[$arr])")
      if echo "$res" | grep -q '^\['; then echo "$res" | jq -c '.[]' >> "$OUT"; break; fi
      echo "chunk $n $col attempt $attempt: $(echo "$res" | cut -c1-120)" >&2
      sleep 20
    done
    sleep 2
  done
  sleep 3
done
# dedupe rows by id
sort -u "$OUT" -o "$OUT.tmp" && jq -c -s 'unique_by(.id)[]' "$OUT.tmp" > "$OUT" && rm -f "$OUT.tmp"
rm -rf "$W"
echo "rows: $(wc -l < "$OUT")"
