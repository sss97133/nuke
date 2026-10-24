set statement_timeout='55s';
create table if not exists public.agg_houseroute_v10_20261024_ccev as
select split_part(e.source_url,'/',4) ccev, e.source_platform, count(*) n, min(e.sold_at)::date d_lo, max(e.sold_at)::date d_hi
from public.vehicle_events e where e.source_url >= 'conceptcarz' and e.source_url < 'conceptcarzz' and e.source_url like 'conceptcarz://event/%'
group by 1,2;
select count(distinct ccev), sum(n) from public.agg_houseroute_v10_20261024_ccev;
