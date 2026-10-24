set statement_timeout='50s';
create table if not exists public.agg_houselot_v1_20261024_house (hid uuid primary key, hvid uuid, house text, year int, mk text, md text,
  hsold timestamptz, hp numeric, source_url text, source_listing_id text);
alter table public.agg_houselot_v1_20261024_house enable row level security;
create index if not exists agg_houselot_v1_house_k on public.agg_houselot_v1_20261024_house (house, year, hsold);
insert into public.agg_houselot_v1_20261024_house
select he.id, he.vehicle_id, :'h', v.year, lower(btrim(regexp_replace(v.make,'[^A-Za-z0-9]+',' ','g'))), lower(btrim(regexp_replace(coalesce(v.model,''),'[^A-Za-z0-9]+',' ','g'))),
  he.sold_at, he.final_price, he.source_url, he.source_listing_id
from vehicle_events he join vehicles v on v.id=he.vehicle_id and v.deleted_at is null and v.status is distinct from 'merged' and v.merged_into_vehicle_id is null
where he.sold_at is not null and he.source_platform in ('mecum','barrettjackson','barrett-jackson','bonhams','rm-sothebys','rmsothebys')
  and he.source_url ilike :'pat' and he.source_url not like 'conceptcarz://%' and v.year is not null and v.make is not null
on conflict (hid) do nothing;
select :'h' h, count(*) from public.agg_houselot_v1_20261024_house where house=:'h';
