set statement_timeout='55s';
create table if not exists public.agg_houseroute_v10_20261024_sib as
select split_part(e.source_url,'/',4) ccev, e.id sib_event_id, e.source_platform,
  e.metadata->'attach_basis'->>'kind' kind, e.metadata->'attach_basis'->>'citation' citation,
  (e.metadata->'attach_basis'->>'cited_event_id')::uuid cited_event_id, e.metadata->'attach_basis'->>'run_id' ab_run
from public.vehicle_events e
where e.source_url >= 'conceptcarz' and e.source_url < 'conceptcarzz' and e.source_url like 'conceptcarz://event/%'
  and e.metadata ? 'attach_basis' and coalesce(e.event_status,'') <> 'cancelled'
  and split_part(e.source_url,'/',4) in (select ccev from public.agg_houseroute_v10_20261024_nowin);
alter table public.agg_houseroute_v10_20261024_sib add column if not exists house_url text, add column if not exists house_platform text, add column if not exists house_sold date;
update public.agg_houseroute_v10_20261024_sib s set house_url=h.source_url, house_platform=h.source_platform, house_sold=coalesce(h.sold_at,h.ended_at)::date from public.vehicle_events h where h.id=s.cited_event_id;
select kind, house_platform, count(*) from public.agg_houseroute_v10_20261024_sib group by 1,2 order by 3 desc;
