begin; set local statement_timeout='50s'; set local lock_timeout='5s';
create table if not exists public.agg_houselot_v1_20261024_bjlive as
select he.id hid, he.vehicle_id hvid, he.sold_at, ' '||lower(regexp_replace(substring(he.source_url from '(?i)/vehicle/([^/?#]+)'),'[^A-Za-z0-9]+',' ','g'))||' ' slug
from public.vehicle_events he where he.source_platform in ('barrettjackson','barrett-jackson') and he.event_status='sold' and he.sold_at is not null and he.source_url ~* '/vehicle/';
alter table public.agg_houselot_v1_20261024_bjlive enable row level security;
create index if not exists agg_hl_bjlive_sold on public.agg_houselot_v1_20261024_bjlive (sold_at);
commit;
select count(*) from public.agg_houselot_v1_20261024_bjlive;
