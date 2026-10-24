-- run agg_houseroute_v13_20261024: route held v10 events to the house named on their cited conceptcarz results page
-- (month inside sale window), incl. newly cited houses with native currency; correct v12 "Auctions America - Fall Carlisle" pages to auctions-america.
set local statement_timeout='50s';
update public.agg_houseroute_v13_20261024_map set native_currency='unknown' where page_title ~* '^bonhams (- motor cars|collectors motor cars)';
create table if not exists public.backup_agg_houseroute_v13_20261024 as
select e.id event_id, e.vehicle_id, e.source_platform old_platform, e.metadata->'house_route' old_house_route, m.house new_platform, m.native_currency, m.ccev, now() backed_at
from public.vehicle_events e join public.agg_houseroute_v10_20261024_cand c on c.event_id=e.id join public.agg_houseroute_v13_20261024_map m using(ccev)
where m.house is not null and to_date(m.event_month,'FMMonth YYYY') between date_trunc('month',c.win_lo) and c.win_hi
  and ((c.decision like 'held%' and e.source_platform in ('barrettjackson','barrett-jackson'))
    or (m.house='auctions-america' and e.source_platform='carlisle' and e.metadata->'house_route'->>'run_id'='agg_houseroute_v12_20261024'));
alter table public.backup_agg_houseroute_v13_20261024 enable row level security;
update public.vehicle_events e set source_platform=b.new_platform,
  metadata = e.metadata || jsonb_build_object('house_route', jsonb_build_object('run_id','agg_houseroute_v13_20261024','from',b.old_platform,'to',b.new_platform,
    'native_currency', b.native_currency,
    'rule','conceptcarz auction id '||m.ccev||' results page names "'||m.page_title||'", event date '||m.event_month||' inside sale window ['||c.win_lo||','||c.win_hi||']',
    'citations', jsonb_build_array(m.url), 'previous', b.old_house_route, 'at', now()))
from public.backup_agg_houseroute_v13_20261024 b join public.agg_houseroute_v10_20261024_cand c on c.event_id=b.event_id join public.agg_houseroute_v13_20261024_map m on m.ccev=b.ccev
where e.id=b.event_id and e.source_platform=b.old_platform;
-- B-J gap ledger (not filled)
create table if not exists public.agg_houseroute_v13_20261024_bjgap as
select m.ccev, m.page_title, m.event_month, m.url, count(*) events, 'B-J sale named on cited page but missing from B-J results staging; not filled' note
from public.agg_houseroute_v10_20261024_cand c join public.agg_houseroute_v12_20261024_ccpage m using(ccev)
where c.decision like 'held%' and m.house='barrettjackson' group by 1,2,3,4;
alter table public.agg_houseroute_v13_20261024_bjgap enable row level security;
select old_platform, new_platform, native_currency, count(*) from public.backup_agg_houseroute_v13_20261024 group by 1,2,3 order by 4 desc;
