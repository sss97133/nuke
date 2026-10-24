set statement_timeout='55s';
with c as materialized (
  select c.event_id, c.from_vehicle_id, c.title_year, s.price_usd, upper(regexp_replace(coalesce(s.vin,''),'[^A-Za-z0-9]','','g')) nv,
   (select count(*) from public.agg_houselot_v1_20261024_cand9 x where x.item_id=c.item_id and x.n9b=1) k
  from public.agg_houselot_v1_20261024_cand9 c join public.bj_results_stage_v1_20261024 s using(item_id) where c.n9b=1
), vm as (select c.event_id, count(*) filter (where v.deleted_at is null and v.status is distinct from 'merged' and v.merged_into_vehicle_id is null) nl,
   count(*) n from c join public.vehicles v on upper(trim(both from v.vin))=c.nv where length(c.nv)>=8 group by 1)
select case when b.event_id is not null then '0 attached'
  when c.k>1 then '1 lot claimed by >1 cc event'
  when length(c.nv)<8 then '2 lot has no usable VIN'
  when vm.n is null then '3 VIN matches no existing vehicle (stays staged)'
  when vm.nl=0 then '4 VIN vehicle deleted/merged'
  when vm.nl>1 then '5 VIN matches >1 live vehicle'
  when abs(e.final_price-c.price_usd)/c.price_usd>0.2 then '6 price >20% apart'
  else '7 other gate (year/flags/dup-price/engine)' end reason, count(*)
from c left join vm using(event_id) join public.vehicle_events e on e.id=c.event_id
left join public.backup_agg_houselot_v9_20261024 b on b.event_id=c.event_id group by 1 order by 1;
