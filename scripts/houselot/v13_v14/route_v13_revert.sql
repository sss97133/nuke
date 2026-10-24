-- Revert agg_houseroute_v13_20261024 (no deletes; backup + map + gap tables kept).
set local statement_timeout='50s';
update public.vehicle_events e set source_platform=b.old_platform,
  metadata = case when b.old_house_route is null then e.metadata - 'house_route' else e.metadata || jsonb_build_object('house_route', b.old_house_route) end
from public.backup_agg_houseroute_v13_20261024 b
where e.id=b.event_id and e.metadata->'house_route'->>'run_id'='agg_houseroute_v13_20261024';
