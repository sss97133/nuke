set statement_timeout='55s';
drop table if exists public.agg_houseroute_v12_20261024_vinsib;
create table public.agg_houseroute_v12_20261024_vinsib as
with w as (select c.ccev, min(c.win_lo) lo, max(c.win_hi) hi from public.agg_houseroute_v10_20261024_cand c where c.decision='held: no cited sibling lot' group by 1),
s as (select s.ccev, s.sib_event_id, e.vehicle_id from public.agg_houseroute_v10_20261024_sib s join w using(ccev) join public.vehicle_events e on e.id=s.sib_event_id where s.kind='vin_match')
select s.ccev, s.sib_event_id, s.vehicle_id, h.id house_event_id, h.source_platform house, h.source_url house_url, coalesce(h.sold_at,h.ended_at)::date hd, h.final_price hp, h.lot_number, h.source_listing_id
from s join w using(ccev) join public.vehicle_events h on h.vehicle_id=s.vehicle_id and h.id<>s.sib_event_id
 and h.source_url ~* '^https?://' and coalesce(h.sold_at,h.ended_at)::date between w.lo and w.hi
 and coalesce(h.event_status,'')<>'cancelled';
select house, count(distinct ccev) ccevs, count(*) from public.agg_houseroute_v12_20261024_vinsib group by 1 order by 3 desc;
