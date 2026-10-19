#!/bin/bash
# select_hybrid_candidates.sh <out.jsonl> <family_id>[:<year_from>:<year_to>] ...
# Read-only. For each factory model family (mv_model_family_names.family_id), lists the recorded sales whose own page
# (listing_url, else discovery_url) names their model year but no phrase of the family: the same rule as
# mv_family_year_prices.conflicts (20261015130000). Each candidate is classed:
#   hybrid    the row's discovery_url is a Barrett-Jackson docket while its listing_url is another platform's lot
#             (a docket car's identity laid over a lot row; docs/proposals/2026-10-15-hybrid-identity-repair.md)
#   mislabel  any other conflict: the model is wrong and no foreign link is present
# One read per family through mv_treemap_outcomes (brand, model) and the matched rows' primary keys, 3 s apart, each
# under the 10 s cap. The output holds vehicle ids and links: write it under ~/nuke-logs, never the repo.
# A large family (Corvette, all years) runs past the cap: give a year range. The fold says where the conflicts are:
#   select family_id || ':' || year || ':' || year from mv_family_year_prices
#   where basis = 'sold' and conflicts > 0 and year_from = year_to   -- one model year per row; widened rows overlap
# Candidates are not verdicts: an alias the family lacks ("buick estate" for an Electra Estate Wagon) is a candidate
# too, so every row is read against its own lot before any correction.
set -u
cd "$(dirname "$0")/../.."
OUT=${1:?out.jsonl}; shift
for arg in "$@"; do
  fid=${arg%%:*}; y0=1885; y1=2100
  if [[ "$arg" == *:*:* ]]; then y0=$(echo "$arg" | cut -d: -f2); y1=$(echo "$arg" | cut -d: -f3); fi
  [[ "$fid" =~ ^[0-9a-f-]{36}$ && "$y0" =~ ^[0-9]{4}$ && "$y1" =~ ^[0-9]{4}$ ]] || { echo "skip $arg" >&2; continue; }
  sql="with n as (select distinct model_l, matched from mv_model_family_names where family_id = '$fid'),
b as (select distinct lower(make) brand_l from mv_model_family_names where family_id = '$fid' and make is not null),
w as (select array_agg(distinct x.w) words
      from canonical_models m0
      join canonical_models m on lower(m.canonical_model) = lower(m0.canonical_model)
        and regexp_replace(lower(m.make), '[^a-z0-9]', '', 'g') = regexp_replace(lower(m0.make), '[^a-z0-9]', '', 'g')
      cross join lateral unnest(array_append(coalesce(m.aliases, '{}'::text[]), m.canonical_model)) a(t)
      cross join lateral (select btrim(regexp_replace(lower(a.t), '[^a-z0-9]+', ' ', 'g')) w) x
      where m0.id = '$fid' and length(x.w) >= 3),
c as (select o.id, o.year, o.sold_amount, o.source_name, n.matched
      from mv_treemap_outcomes o join n on n.model_l = lower(coalesce(o.model, ''))
      where lower(o.brand_name) in (select brand_l from b) and o.sold_amount > 0 and o.year between $y0 and $y1),
p as (select c.*, v.make, v.model, v.vin, v.listing_url, v.discovery_url, v.auction_source,
        ' ' || btrim(regexp_replace(lower(regexp_replace(coalesce(v.listing_url, v.discovery_url), '^.*/([^/]+)/?\$', '\1')), '[^a-z0-9]+', ' ', 'g')) || ' ' slug
      from c join vehicles v on v.id = c.id)
select p.id vehicle_id, p.year, p.make, p.model, p.sold_amount, p.source_name, p.vin, p.listing_url, p.discovery_url,
       p.auction_source, btrim(p.slug) page_words,
       case when p.discovery_url ilike '%barrett-jackson%' and coalesce(p.listing_url, '') not ilike '%barrett-jackson%'
            then 'hybrid' else 'mislabel' end class
from p, w
where p.slug like '% ' || p.year || ' %'
  and not exists (select 1 from unnest(array_append(coalesce(w.words, '{}'::text[]), p.matched)) x
                  where position(' ' || x || ' ' in p.slug) > 0 or position(replace(x, ' ', '') in replace(p.slug, ' ', '')) > 0)"
  r=$(scripts/data/q.sh "$sql")
  if ! echo "$r" | jq -e 'type=="array"' >/dev/null 2>&1; then echo "$(date -u +%H:%M:%SZ) family $fid $y0-$y1: $(echo "$r" | head -c 200)" >&2; sleep 10; continue; fi
  echo "$r" | jq -c --arg f "$fid" '.[] | . + {family_id: $f}' >> "$OUT"
  echo "$(date -u +%H:%M:%SZ) family $fid $y0-$y1: $(echo "$r" | jq 'length') candidates ($(echo "$r" | jq '[.[]|select(.class=="hybrid")]|length') hybrid)" >&2
  sleep 3
done
