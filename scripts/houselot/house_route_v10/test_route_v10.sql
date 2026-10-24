begin;
-- run agg_houseroute_v10_20261024: relabel cc events whose own conceptcarz auction is cited (>=2 sibling same_lot attaches, one house, in window) to that house.
-- No vehicles touched; vehicle_id unchanged. Backup first.
set local statement_timeout='55s';
create table if not exists public.backup_agg_houseroute_v10_20261024 as
select e.id event_id, e.vehicle_id, e.source_platform old_platform, e.metadata->'house_route' old_house_route, c.house new_platform, now() backed_at
from public.vehicle_events e join public.agg_houseroute_v10_20261024_cand c on c.event_id=e.id where c.decision='route';
update public.vehicle_events e set source_platform=b.new_platform,
  metadata = e.metadata || jsonb_build_object('house_route', jsonb_build_object('run_id','agg_houseroute_v10_20261024','from',b.old_platform,'to',b.new_platform,
    'rule','conceptcarz auction id '||c.ccev||': no Barrett-Jackson auction in window ['||c.win_lo||','||c.win_hi||'] (B-J results API); '||c.ncited||' sibling sales from the same conceptcarz auction are attached same_lot to '||c.house||' lots dated in that window; no sibling cites another house',
    'citations', to_jsonb(c.cites), 'at', now()))
from public.backup_agg_houseroute_v10_20261024 b join public.agg_houseroute_v10_20261024_cand c on c.event_id=b.event_id
where e.id=b.event_id and e.source_platform=b.old_platform;
select (select count(*) from public.vehicle_events where metadata->'house_route'->>'run_id'='agg_houseroute_v10_20261024') routed, (select count(*) from public.vehicle_events where metadata->'house_route'->>'run_id'='agg_houseroute_v10_20261024' and vehicle_id is distinct from (select vehicle_id from public.backup_agg_houseroute_v10_20261024 b where b.event_id=id)) moved;
update public.vehicle_events e set source_platform=b.old_platform,
  metadata = case when b.old_house_route is null then e.metadata - 'house_route' else e.metadata || jsonb_build_object('house_route', b.old_house_route) end
from public.backup_agg_houseroute_v10_20261024 b
where e.id=b.event_id and e.metadata->'house_route'->>'run_id'='agg_houseroute_v10_20261024';
select (select count(*) from public.vehicle_events where metadata->'house_route'->>'run_id'='agg_houseroute_v10_20261024') after_revert, (select count(*) from public.backup_agg_houseroute_v10_20261024) backup;
rollback;
