set statement_timeout='55s';
create table if not exists public.agg_houseroute_v10_20261024_nowin as
with d as (select distinct run_datetime::date d from public.bj_results_stage_v1_20261024 where run_datetime is not null)
select c.event_id, c.from_vehicle_id, c.title, c.title_year, c.win_lo, c.win_hi, e.source_url, e.source_platform, e.sold_at, e.final_price,
  split_part(e.source_url,'/',4) ccev, now() computed_at
from public.agg_houselot_v1_20261024_cand9 c join public.vehicle_events e on e.id=c.event_id
where c.n9a=0 and not exists (select 1 from d where d.d between c.win_lo and c.win_hi);
select x.source_platform, (x.source_url like 'conceptcarz://event/%') cc, count(*) from public.agg_houseroute_v10_20261024_nowin x group by 1,2;
