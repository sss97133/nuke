#!/bin/bash
# Bounded keyset pulls for the classified exit study (read-only; 1,000-row pages, 1.5 s apart; nano-instance safe).
#   pull.sh listings   Facebook listings with their family key -> $OUT/fbfam.jsonl
#   pull.sh fold       mv_family_year_prices sold rows        -> $OUT/fold.jsonl
# OUT defaults to ~/nuke-logs/classified-exit. Never commit the output: it holds listing and vehicle ids.
set -uo pipefail
cd "$(dirname "$0")/../../.."
OUT=${OUT:-$HOME/nuke-logs/classified-exit}; mkdir -p "$OUT"
kind=${1:?listings or fold}; n=0
if [ "$kind" = listings ]; then last='00000000-0000-0000-0000-000000000000'; out=$OUT/fbfam.jsonl
else lf='00000000-0000-0000-0000-000000000000'; ly=0; out=$OUT/fold.jsonl; fi
: > "$out"
while :; do
  if [ "$kind" = listings ]; then
    sql="select m.id, m.vehicle_id vid, m.price, m.status st, m.first_seen_at fs, m.last_seen_at ls, m.removed_at ra, upper(substring(m.location from ',\s*([A-Za-z]{2})\s*$')) rg, v.year vy, n.family_id fid, n.year_start ys, n.year_end ye from (select id, vehicle_id, price, status, first_seen_at, last_seen_at, removed_at, location from marketplace_listings where id > '$last' order by id limit 1000) m left join vehicles v on v.id = m.vehicle_id left join mv_model_family_names n on n.make_l = lower(v.make) and n.model_l = lower(coalesce(v.model, '')) order by m.id"
  else
    # (family_id, year, basis) is the fold's unique index: a range read per page, never a sort of the whole fold.
    sql="select family_id, year, n, offered, thin, p50, prices from mv_family_year_prices where (family_id, year) > ('$lf'::uuid, $ly) and basis = 'sold' order by family_id, year limit 1000"
  fi
  r=$(scripts/data/q.sh "$sql")
  if ! echo "$r" | jq -e 'type=="array"' >/dev/null 2>&1; then echo "ERR at $last: $(echo "$r" | head -c 200)"; sleep 10; continue; fi
  k=$(echo "$r" | jq 'length'); [ "$k" = 0 ] && break
  echo "$r" | jq -c '.[]' >> "$out"; n=$((n + k))
  if [ "$kind" = listings ]; then last=$(echo "$r" | jq -r '.[-1].id'); else lf=$(echo "$r" | jq -r '.[-1].family_id'); ly=$(echo "$r" | jq -r '.[-1].year'); fi
  echo "$(date -u +%H:%M:%S) $kind $n"
  [ "$k" -lt 1000 ] && break
  sleep 1.5
done
echo "DONE $kind $n -> $out"
