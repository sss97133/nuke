begin;
-- run agg_houseroute_v12_20261024: route held (v10) events whose conceptcarz auction results page names Leake, Kruse or Carlisle,
-- with the page's event month inside the event's sale window. Relabel source_platform + metadata.house_route; no vehicle changes.
set local statement_timeout='50s';
create table if not exists public.backup_agg_houseroute_v12_20261024 as
select e.id event_id, e.vehicle_id, e.source_platform old_platform, e.metadata->'house_route' old_house_route, p.house new_platform, now() backed_at
from public.vehicle_events e join public.agg_houseroute_v10_20261024_cand c on c.event_id=e.id join public.agg_houseroute_v12_20261024_ccpage p using(ccev)
where c.decision like 'held%' and p.house in ('leake','kruse','carlisle') and to_date(p.event_month,'FMMonth YYYY') between date_trunc('month',c.win_lo) and c.win_hi
  and e.source_platform in ('barrettjackson','barrett-jackson');
alter table public.backup_agg_houseroute_v12_20261024 enable row level security;
update public.vehicle_events e set source_platform=b.new_platform,
  metadata = e.metadata || jsonb_build_object('house_route', jsonb_build_object('run_id','agg_houseroute_v12_20261024','from',b.old_platform,'to',b.new_platform,
    'rule','conceptcarz auction id '||p.ccev||' results page names "'||p.page_title||'", event date '||p.event_month||' inside sale window ['||c.win_lo||','||c.win_hi||']; no Barrett-Jackson auction in that window (B-J results API)',
    'citations', jsonb_build_array(p.url), 'at', now()))
from public.backup_agg_houseroute_v12_20261024 b join public.agg_houseroute_v10_20261024_cand c on c.event_id=b.event_id join public.agg_houseroute_v12_20261024_ccpage p using(ccev)
where e.id=b.event_id and e.source_platform=b.old_platform;
create temp table t_n as select (select count(*) from public.vehicle_events e join public.backup_agg_houseroute_v12_20261024 b on b.event_id=e.id where e.metadata->'house_route'->>'run_id'='agg_houseroute_v12_20261024') n;
-- Revert agg_houseroute_v12_20261024 (no deletes; backup kept).
set local statement_timeout='50s';
update public.vehicle_events e set source_platform=b.old_platform,
  metadata = case when b.old_house_route is null then e.metadata - 'house_route' else e.metadata || jsonb_build_object('house_route', b.old_house_route) end
from public.backup_agg_houseroute_v12_20261024 b
where e.id=b.event_id and e.metadata->'house_route'->>'run_id'='agg_houseroute_v12_20261024';
select (select n from t_n) routed, (select count(*) from public.vehicle_events e join public.backup_agg_houseroute_v12_20261024 b on b.event_id=e.id where e.metadata->'house_route'->>'run_id'='agg_houseroute_v12_20261024') after_revert;
rollback;
